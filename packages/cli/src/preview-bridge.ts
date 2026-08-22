import { randomBytes, timingSafeEqual } from "node:crypto";
import { readFile } from "node:fs/promises";
import { createServer, type IncomingMessage, type Server } from "node:http";

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
    "access-control-allow-methods": "GET, PUT, OPTIONS, DELETE",
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
    "access-control-allow-methods": "GET, PUT, OPTIONS, DELETE",
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

async function readJson(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let length = 0;
  for await (const chunk of request) {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    length += bytes.length;
    if (length > MAX_DOCUMENT_BYTES) throw new Error("Project document payload is too large");
    chunks.push(bytes);
  }
  if (length === 0) throw new Error("Missing project document payload");
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

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

  const requestHandler = async (request: IncomingMessage, response: import("node:http").ServerResponse): Promise<void> => {
    const requestUrl = new URL(request.url ?? "/", "http://127.0.0.1");
    if (!authorized(requestUrl, token)) {
      sendJson(response, 404, { error: "Not found" });
      return;
    }
    if (request.method === "OPTIONS") {
      sendEmpty(response);
      return;
    }

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
        const bytes = await readFile(`${options.projectDirectory}/${asset.path}`);
        response.writeHead(200, {
          "access-control-allow-origin": "*",
          "cache-control": "no-store",
          "content-length": bytes.length,
          "content-type": asset.mediaType,
        });
        response.end(bytes);
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
      sendJson(response, 500, { error: error instanceof Error ? error.message : "Preview bridge failed" });
    }
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
