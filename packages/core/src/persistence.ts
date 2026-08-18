import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { access, link, mkdir, open, readFile, rename, unlink } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";

import type { OpenCanvasDraftBasedProjectDocumentV1 as CanvasDocument } from "./canvas-document.generated.js";
import { parseCanvasDocument } from "./validation.js";

export interface SaveHooks {
  beforeRename?: () => void | Promise<void>;
  expectedCurrentRevision?: number;
  createOnly?: boolean;
}

export async function loadProject(projectDirectory: string): Promise<CanvasDocument> {
  const raw = await readFile(join(projectDirectory, "project.json"), "utf8");
  return parseCanvasDocument(JSON.parse(raw));
}

export async function saveProjectAtomic(
  projectDirectory: string,
  input: CanvasDocument,
  hooks: SaveHooks = {},
): Promise<void> {
  const document = parseCanvasDocument(input);
  const stateDirectory = join(projectDirectory, ".open-canvas");
  const tempDirectory = join(stateDirectory, "tmp");
  const lockPath = join(stateDirectory, "lock");
  await mkdir(tempDirectory, { recursive: true });
  const lock = await open(lockPath, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY, 0o600).catch((error: NodeJS.ErrnoException) => {
    if (error.code === "EEXIST") throw new Error(`Project is locked: ${projectDirectory}`);
    throw error;
  });
  const tempPath = join(tempDirectory, `project-${randomUUID()}.json`);
  try {
    await lock.writeFile(`${process.pid}\n`, "utf8");
    await lock.sync();
    if (hooks.createOnly) {
      await access(join(projectDirectory, "project.json")).then(
        () => {
          throw new Error(`Project already exists: ${projectDirectory}`);
        },
        (error: NodeJS.ErrnoException) => {
          if (error.code !== "ENOENT") throw error;
        },
      );
    }
    if (hooks.expectedCurrentRevision !== undefined) {
      const current = await loadProject(projectDirectory);
      if (current.revision !== hooks.expectedCurrentRevision) {
        throw new Error(
          `project revision conflict: expected ${hooks.expectedCurrentRevision}, found ${current.revision}`,
        );
      }
    }
    const temp = await open(tempPath, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY, 0o600);
    try {
      await temp.writeFile(`${JSON.stringify(document, null, 2)}\n`, "utf8");
      await temp.sync();
    } finally {
      await temp.close();
    }
    await hooks.beforeRename?.();
    await rename(tempPath, join(projectDirectory, "project.json"));
    const directory = await open(projectDirectory, constants.O_RDONLY);
    try {
      await directory.sync();
    } finally {
      await directory.close();
    }
  } finally {
    await lock.close();
    await unlink(lockPath).catch(() => undefined);
    await unlink(tempPath).catch(() => undefined);
  }
}

export async function writeAssetBytes(
  projectDirectory: string,
  assetPath: string,
  bytes: Uint8Array,
): Promise<void> {
  if (!/^assets\/sha256\/[0-9a-f]{64}$/.test(assetPath)) {
    throw new Error(`Invalid asset path: ${assetPath}`);
  }
  const digest = assetPath.slice("assets/sha256/".length);
  const buffer = Buffer.from(bytes);
  if (createHash("sha256").update(buffer).digest("hex") !== digest) {
    throw new Error("Asset bytes do not match content-addressed path");
  }
  const directory = join(projectDirectory, "assets", "sha256");
  const path = join(directory, digest);
  const tempDirectory = join(projectDirectory, ".open-canvas", "tmp");
  const tempPath = join(tempDirectory, `asset-${randomUUID()}`);
  await mkdir(directory, { recursive: true });
  await mkdir(tempDirectory, { recursive: true });
  const file = await open(tempPath, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY, 0o600);
  try {
    await file.writeFile(buffer);
    await file.sync();
  } finally {
    await file.close();
  }
  try {
    await link(tempPath, path);
    const assetDirectory = await open(directory, constants.O_RDONLY);
    try {
      await assetDirectory.sync();
    } finally {
      await assetDirectory.close();
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    const existing = await readFile(path);
    if (!existing.equals(buffer)) throw new Error(`Asset collision at ${assetPath}`);
  } finally {
    await unlink(tempPath).catch(() => undefined);
  }
}
