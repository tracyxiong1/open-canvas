import { createReadStream } from "node:fs";
import { realpath, stat } from "node:fs/promises";
import type { IncomingMessage, ServerResponse } from "node:http";
import { extname, resolve, sep } from "node:path";
import { pipeline } from "node:stream/promises";

export const studioDirectory = resolve(import.meta.dirname, "../dist/studio");

const contentTypes: Record<string, string> = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8", ".svg": "image/svg+xml", ".png": "image/png",
  ".webp": "image/webp", ".ico": "image/x-icon", ".woff2": "font/woff2",
};

export async function streamFile(request: IncomingMessage, response: ServerResponse, path: string, mediaType: string, downloadName?: string): Promise<void> {
  const info = await stat(path);
  const headers: Record<string, string | number> = {
    "content-type": mediaType, "cache-control": "no-store", "accept-ranges": "bytes",
    "access-control-allow-origin": "*", "x-content-type-options": "nosniff",
    "referrer-policy": "no-referrer",
  };
  if (downloadName) headers["content-disposition"] = `attachment; filename*=UTF-8''${encodeURIComponent(downloadName)}`;
  let start = 0;
  let end = info.size - 1;
  const range = request.headers.range;
  if (range) {
    const match = /^bytes=(\d*)-(\d*)$/.exec(range);
    if (!match || (!match[1] && !match[2])) {
      response.writeHead(416, { "content-range": `bytes */${info.size}` }); response.end(); return;
    }
    if (!match[1]) start = Math.max(0, info.size - Number(match[2]));
    else { start = Number(match[1]); if (match[2]) end = Math.min(end, Number(match[2])); }
    if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start > end || start >= info.size) {
      response.writeHead(416, { "content-range": `bytes */${info.size}` }); response.end(); return;
    }
    headers["content-range"] = `bytes ${start}-${end}/${info.size}`;
  }
  headers["content-length"] = Math.max(0, end - start + 1);
  response.writeHead(range ? 206 : 200, headers);
  if (request.method === "HEAD" || info.size === 0) { response.end(); return; }
  await pipeline(createReadStream(path, { start, end }), response);
}

export async function serveStudio(request: IncomingMessage, response: ServerResponse, pathname: string): Promise<boolean> {
  if (!["GET", "HEAD"].includes(request.method ?? "")) return false;
  if (pathname !== "/" && pathname !== "/index.html" && !pathname.startsWith("/assets/")) return false;
  const root = await realpath(studioDirectory);
  const path = await realpath(resolve(root, pathname === "/" ? "index.html" : `.${decodeURIComponent(pathname)}`)).catch(() => null);
  if (!path || !path.startsWith(root + sep) || !(await stat(path)).isFile()) {
    response.writeHead(404); response.end(); return true;
  }
  await streamFile(request, response, path, contentTypes[extname(path)] ?? "application/octet-stream");
  return true;
}
