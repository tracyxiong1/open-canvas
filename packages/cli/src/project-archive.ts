import { createHash, randomUUID } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { link, lstat, mkdir, mkdtemp, rename, rm, rmdir } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import { Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { createGunzip, createGzip } from "node:zlib";
import tar from "tar-stream";
import { loadProject, parseCanvasDocument, saveProjectAtomic, type CanvasDocument, type Asset } from "@open-canvas/core";

const MAX_DOCUMENT_BYTES = 4 * 1024 * 1024;
const MAX_PROJECT_BYTES = 4 * 1024 * 1024 * 1024;

export function verifyAssetStream(asset: Asset): Transform {
  const hash = createHash("sha256"); let size = 0;
  return new Transform({
    transform(chunk: Buffer, _encoding, next) {
      size += chunk.length;
      if (size > asset.byteLength) { next(new Error("Asset size mismatch")); return; }
      hash.update(chunk); next(null, chunk);
    },
    flush(next) {
      next(size === asset.byteLength && `sha256:${hash.digest("hex")}` === asset.checksumSha256
        ? null : new Error("Asset integrity check failed"));
    },
  });
}

/** Contains only the canonical document and its declared media; never local config or credentials. */
export async function packProject(directory: string, output: string): Promise<{ output: string; assetCount: number }> {
  const document = await loadProject(directory);
  if (document.assets.reduce((sum, asset) => sum + asset.byteLength, 0) > MAX_PROJECT_BYTES) throw new Error("Project exceeds the 4 GiB package limit");
  const json = Buffer.from(JSON.stringify(document));
  if (json.length > MAX_DOCUMENT_BYTES) throw new Error("Project document is too large to package");
  const target = resolve(output);
  await mkdir(dirname(target), { recursive: true });
  const temporary = `${target}.${randomUUID()}.tmp`;
  const pack = tar.pack();
  const writing = pipeline(pack, createGzip(), createWriteStream(temporary, { flags: "wx", mode: 0o600 }));
  // Attach rejection handling immediately while entries are still being produced.
  void writing.catch(() => undefined);
  try {
    await new Promise<void>((done, reject) => pack.entry({ name: "project.json", size: json.length, mode: 0o600 }, json, (error) => error ? reject(error) : done()));
    for (const asset of document.assets) {
      const path = join(directory, asset.path);
      if (!(await lstat(path)).isFile()) throw new Error("Project assets must be regular files");
      await pipeline(createReadStream(path), verifyAssetStream(asset), pack.entry({ name: asset.path, size: asset.byteLength, mode: 0o600 }));
    }
    pack.finalize(); await writing;
    await link(temporary, target); // Do not overwrite an existing export.
    return { output: target, assetCount: document.assets.length };
  } catch (error) {
    pack.destroy(error instanceof Error ? error : new Error("Archive failed"));
    await writing.catch(() => undefined); throw error;
  } finally { await rm(temporary, { force: true }); }
}

/** Validate every entry into a private staging directory before exposing a restored project. */
export async function unpackProject(archive: string, destination: string): Promise<{ projectDirectory: string; document: CanvasDocument }> {
  const target = resolve(destination);
  if (await lstat(target).catch((error: NodeJS.ErrnoException) => { if (error.code !== "ENOENT") throw error; return null; })) {
    throw new Error("Restore destination already exists; choose a new directory");
  }
  await mkdir(dirname(target), { recursive: true });
  const staging = await mkdtemp(join(dirname(target), `.${basename(target)}-restore-`));
  const extract = tar.extract();
  let document: CanvasDocument | undefined;
  const seen = new Set<string>();
  let expandedBytes = 0;
  let reserved = false;
  extract.on("entry", (header, stream, next) => {
    // Rejected headers can fail before pipeline/iteration attaches an error listener.
    // The extractor carries the failure to the outer pipeline in every case.
    stream.on("error", () => undefined);
    void (async () => {
      if (header.type !== "file" || seen.has(header.name)) throw new Error("Unsupported or duplicate archive entry");
      seen.add(header.name);
      if (!document) {
        if (header.name !== "project.json" || (header.size ?? 0) > MAX_DOCUMENT_BYTES) throw new Error("Archive must begin with a project document");
        const chunks: Buffer[] = [];
        for await (const chunk of stream) chunks.push(Buffer.from(chunk as Uint8Array));
        document = parseCanvasDocument(JSON.parse(Buffer.concat(chunks).toString("utf8")));
        if (document.assets.reduce((sum, asset) => sum + asset.byteLength, 0) > MAX_PROJECT_BYTES) throw new Error("Project exceeds the 4 GiB restore limit");
      } else {
        const asset = document.assets.find((item) => item.path === header.name);
        if (!asset || header.size !== asset.byteLength) throw new Error("Archive contains an undeclared or invalid asset");
        await mkdir(join(staging, "assets/sha256"), { recursive: true });
        await pipeline(stream, verifyAssetStream(asset), createWriteStream(join(staging, asset.path), { flags: "wx", mode: 0o600 }));
      }
    })().then(() => next(), (error: Error) => { stream.destroy(error); extract.destroy(error); });
  });
  try {
    await pipeline(createReadStream(archive), createGunzip(), new Transform({
      transform(chunk: Buffer, _encoding, next) {
        expandedBytes += chunk.length;
        next(expandedBytes > MAX_PROJECT_BYTES + 16 * 1024 * 1024 ? new Error("Archive exceeds the restore limit") : null, chunk);
      },
    }), extract);
    if (!document || document.assets.some((asset) => !seen.has(asset.path))) throw new Error("Project archive is missing media");
    await saveProjectAtomic(staging, document, { createOnly: true });
    await mkdir(target); reserved = true;
    await rename(staging, target); reserved = false;
    return { projectDirectory: target, document };
  } finally {
    await rm(staging, { recursive: true, force: true });
    if (reserved) await rmdir(target).catch(() => undefined);
  }
}
