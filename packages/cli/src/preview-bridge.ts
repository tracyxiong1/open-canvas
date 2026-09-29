import { randomBytes, timingSafeEqual } from "node:crypto";
import { createWriteStream } from "node:fs";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { createServer, type IncomingMessage, type Server } from "node:http";
import { basename, dirname, join } from "node:path";
import { Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { serveStudio, streamFile } from "./studio-assets.js";
import { importCanvasMedia, MAX_IMPORT_BYTES } from "./media-import.js";
import { packProject, unpackProject } from "./project-archive.js";
import { renderProject, type RenderOptions } from "./render.js";

import {
  loadProject,
  parseCanvasDocument,
  saveProjectAtomic,
  type CanvasDocument,
} from "@open-canvas/core";

const MAX_DOCUMENT_BYTES = 4 * 1024 * 1024;

export interface PreviewBridgeOptions {
  projectDirectory: string;
  token?: string;
  port?: number;
  serveStudio?: boolean;
  generate?: (input: { nodeId: string; draftId: string; baseRevision: number }) => Promise<unknown>;
  openProject?: (directory: string) => Promise<unknown>;
}

export interface PreviewBridge {
  bridgeUrl: string;
  token: string;
  close(): Promise<void>;
}

function sendJson(response: import("node:http").ServerResponse, status: number, value: unknown): void {
  const body = JSON.stringify(value);
  response.writeHead(status, {
    "access-control-allow-headers": "content-type",
    "access-control-allow-methods": "GET, PUT, POST, OPTIONS, DELETE",
    "access-control-allow-origin": "*",
    "cache-control": "no-store",
    "content-length": Buffer.byteLength(body),
    "content-type": "application/json; charset=utf-8",
  });
  response.end(body);
}

function sendEmpty(response: import("node:http").ServerResponse, status = 204): void {
  response.writeHead(status, {
    "access-control-allow-headers": "content-type",
    "access-control-allow-methods": "GET, PUT, POST, OPTIONS, DELETE",
    "access-control-allow-origin": "*",
    "cache-control": "no-store",
  });
  response.end();
}

function authorized(url: URL, token: string): boolean {
  const supplied = url.searchParams.get("token");
  if (!supplied) return false;
  const actual = Buffer.from(supplied);
  const expected = Buffer.from(token);
  if (actual.length !== expected.length) return false;
  return timingSafeEqual(actual, expected);
}

function sameAssetIndex(current: CanvasDocument, candidate: CanvasDocument): boolean {
  const currentAssets = new Map(current.assets.map((asset) => [asset.id, asset]));
  return candidate.assets.every((asset) => {
    const original = currentAssets.get(asset.id);
    if (!original) return false;
    return asset.path === original.path
      && asset.kind === original.kind
      && asset.mediaType === original.mediaType
      && asset.byteLength === original.byteLength
      && asset.checksumSha256 === original.checksumSha256;
  });
}

async function readBody(request: IncomingMessage, limit = MAX_DOCUMENT_BYTES): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let length = 0;
  for await (const chunk of request) {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    length += bytes.length;
    if (length > limit) throw new Error("Request payload is too large");
    chunks.push(bytes);
  }
  if (length === 0) throw new Error("Missing project document payload");
  return Buffer.concat(chunks);
}

async function readJson(request: IncomingMessage): Promise<unknown> { return JSON.parse((await readBody(request)).toString("utf8")); }

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

async function closeServer(server: Server): Promise<void> {
  await new Promise<void>((resolveClose, rejectClose) => {
    server.close((error) => error ? rejectClose(error) : resolveClose());
  });
}

/**
 * A deliberately tiny localhost-only bridge between a CLI project directory
 * and a browser Studio. It exposes one validated project document and its
 * declared assets; it never exposes a directory listing, credentials, or an
 * arbitrary filesystem path.
 */
export async function startPreviewBridge(options: PreviewBridgeOptions): Promise<PreviewBridge> {
  const token = options.token ?? randomBytes(24).toString("base64url");
  let server: Server;
  let closing = false;
  let busy = false;

  const requestHandler = async (request: IncomingMessage, response: import("node:http").ServerResponse): Promise<void> => {
    const requestUrl = new URL(request.url ?? "/", "http://127.0.0.1");
    if (options.serveStudio) {
      try { if (await serveStudio(request, response, requestUrl.pathname)) return; }
      catch { response.writeHead(404); response.end("Studio assets unavailable. Reinstall open-canvas-cli."); return; }
    }
    if (!authorized(requestUrl, token)) {
      sendJson(response, 404, { error: "Not found" });
      return;
    }
    if (request.method === "OPTIONS") {
      sendEmpty(response);
      return;
    }

    const mutation = request.method === "PUT" || request.method === "POST";
    if (mutation && busy) { sendJson(response, 409, { error: "Another project operation is still running" }); return; }
    if (mutation) busy = true;
    try {
      if (request.method === "GET" && requestUrl.pathname === "/project.json") {
        const document = await loadProject(options.projectDirectory);
        // Studio polls this local bridge with the last durable project
        // revision. A 204 keeps ordinary polling cheap while still making
        // every externally-applied CLI mutation observable without a page
        // reload. The document itself remains the only source of truth.
        if (requestUrl.searchParams.get("revision") === String(document.revision)) {
          sendEmpty(response);
          return;
        }
        sendJson(response, 200, document);
        return;
      }

      if (request.method === "PUT" && requestUrl.pathname === "/project.json") {
        const payload = await readJson(request);
        if (!isRecord(payload) || !Number.isInteger(payload.baseRevision) || !("document" in payload)) {
          sendJson(response, 400, { error: "Invalid project save payload" });
          return;
        }
        const current = await loadProject(options.projectDirectory);
        if (current.revision !== payload.baseRevision) {
          sendJson(response, 409, { error: "project_revision_conflict", currentRevision: current.revision });
          return;
        }
        const next = parseCanvasDocument(payload.document);
        if (next.project.id !== current.project.id) {
          sendJson(response, 422, { error: "Project identity cannot change" });
          return;
        }
        if (next.revision <= current.revision) {
          sendJson(response, 422, { error: "Project revision must advance before saving" });
          return;
        }
        if (!sameAssetIndex(current, next)) {
          sendJson(response, 422, { error: "New project assets must be imported through the CLI" });
          return;
        }
        await saveProjectAtomic(options.projectDirectory, next, { expectedCurrentRevision: current.revision });
        sendJson(response, 200, { revision: next.revision });
        return;
      }

      if (request.method === "GET" && requestUrl.pathname === "/asset") {
        const assetId = requestUrl.searchParams.get("id");
        const document = await loadProject(options.projectDirectory);
        const asset = assetId ? document.assets.find((candidate) => candidate.id === assetId) : undefined;
        if (!asset) {
          sendJson(response, 404, { error: "Asset not found" });
          return;
        }
        await streamFile(request, response, join(options.projectDirectory, asset.path), asset.mediaType);
        return;
      }

      if (request.method === "POST" && requestUrl.pathname === "/media") {
        const query = requestUrl.searchParams;
        const baseRevision = Number(query.get("revision"));
        if (!query.has("revision") || !Number.isInteger(baseRevision)) throw new Error("A project revision is required");
        const result = await importCanvasMedia(options.projectDirectory, await readBody(request, MAX_IMPORT_BYTES), {
          filename: query.get("filename") ?? "", baseRevision,
          ...(query.get("draft") ? { draftId: query.get("draft")! } : {}),
          ...(query.get("node") ? { nodeId: query.get("node")! } : {}),
          ...(query.has("x") ? { x: Number(query.get("x")) } : {}),
          ...(query.has("y") ? { y: Number(query.get("y")) } : {}),
        });
        sendJson(response, 201, result); return;
      }

      if (request.method === "POST" && requestUrl.pathname === "/generate" && options.generate) {
        const input = await readJson(request);
        if (!isRecord(input) || typeof input.nodeId !== "string" || typeof input.draftId !== "string" || !Number.isInteger(input.baseRevision)) throw new Error("Invalid generation request");
        const result = await options.generate({ nodeId: input.nodeId, draftId: input.draftId, baseRevision: input.baseRevision as number });
        sendJson(response, 200, { result, document: await loadProject(options.projectDirectory) }); return;
      }

      if ((request.method === "GET" && requestUrl.pathname === "/project/archive")
        || (request.method === "POST" && ["/project/restore", "/render"].includes(requestUrl.pathname))) {
        const tempRoot = join(options.projectDirectory, ".open-canvas/tmp");
        await mkdir(tempRoot, { recursive: true });
        const temporary = await mkdtemp(join(tempRoot, "transfer-"));
        try {
          if (requestUrl.pathname === "/project/archive") {
            const path = join(temporary, "project.ocanvas");
            await packProject(options.projectDirectory, path);
            await streamFile(request, response, path, "application/gzip", `${basename(options.projectDirectory)}.ocanvas`);
          } else if (requestUrl.pathname === "/project/restore") {
            if (!options.openProject) throw new Error("Project restore is unavailable in this session");
            const path = join(temporary, "upload.ocanvas"); let size = 0;
            await pipeline(request, new Transform({ transform(chunk: Buffer, _encoding, next) {
              size += chunk.length; next(size > 1024 * 1024 * 1024 ? new Error("Project package exceeds 1 GiB") : null, chunk);
            } }), createWriteStream(path, { flags: "wx", mode: 0o600 }));
            const destination = join(dirname(options.projectDirectory), `${basename(options.projectDirectory)}-restored-${Date.now()}`);
            const restored = await unpackProject(path, destination);
            sendJson(response, 201, { ...(await options.openProject(restored.projectDirectory) as object), projectDirectory: restored.projectDirectory });
          } else {
            const input = await readJson(request);
            if (!isRecord(input) || !Array.isArray(input.nodeIds) || input.nodeIds.some((id) => typeof id !== "string")
              || (input.audioNodeId !== undefined && typeof input.audioNodeId !== "string")
              || (input.draftId !== undefined && typeof input.draftId !== "string")
              || !Number.isInteger(input.baseRevision)) throw new Error("Invalid video export request");
            const path = join(temporary, "film.mp4");
            await renderProject(options.projectDirectory, input as unknown as RenderOptions, path);
            await streamFile(request, response, path, "video/mp4", "open-canvas-film.mp4");
          }
        } finally { await rm(temporary, { recursive: true, force: true }); }
        return;
      }

      if (request.method === "DELETE" && requestUrl.pathname === "/bridge") {
        sendEmpty(response);
        if (!closing) {
          closing = true;
          queueMicrotask(() => void closeServer(server));
        }
        return;
      }

      sendJson(response, 404, { error: "Not found" });
    } catch (error) {
      if (response.headersSent) response.destroy();
      else sendJson(response, 400, { error: error instanceof Error ? error.message : "Preview bridge failed" });
    } finally { if (mutation) busy = false; }
  };

  server = createServer((request, response) => {
    void requestHandler(request, response);
  });
  await new Promise<void>((resolveListen, rejectListen) => {
    server.once("error", rejectListen);
    server.listen(options.port ?? 0, "127.0.0.1", () => {
      server.off("error", rejectListen);
      resolveListen();
    });
  });
  const address = server.address();
  if (!address || typeof address === "string") {
    await closeServer(server);
    throw new Error("Preview bridge did not bind a local TCP port");
  }
  return {
    bridgeUrl: `http://127.0.0.1:${address.port}`,
    token,
    close: async () => {
      if (closing) return;
      closing = true;
      await closeServer(server);
    },
  };
}
