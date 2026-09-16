import { cp, lstat, mkdir, mkdtemp, readFile, readdir, rename, rm } from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

const packageRoot = resolve(import.meta.dirname, "..");

export async function cliVersion(): Promise<string> {
  return (JSON.parse(await readFile(join(packageRoot, "package.json"), "utf8")) as { version: string }).version;
}

async function files(directory: string): Promise<Map<string, Buffer>> {
  const entries = new Map<string, Buffer>();
  async function visit(path: string) {
    for (const entry of await readdir(join(directory, path), { withFileTypes: true })) {
      const relative = join(path, entry.name);
      if (entry.isDirectory()) await visit(relative);
      else if (entry.isFile()) entries.set(relative, await readFile(join(directory, relative)));
      else throw new Error("Skill contains unsupported file entries");
    }
  }
  await visit("");
  return entries;
}

export async function installSkill(directory?: string): Promise<unknown> {
  const source = join(packageRoot, "dist/skill");
  const parent = resolve(directory ?? join(process.env.CODEX_HOME || join(homedir(), ".codex"), "skills"));
  const destination = join(parent, "open-canvas");
  const expected = await files(source);
  const existing = await lstat(destination).catch((error: NodeJS.ErrnoException) => {
    if (error.code !== "ENOENT") throw error;
    return undefined;
  });
  if (existing) {
    const actual = await files(destination).catch(() => new Map<string, Buffer>());
    if (actual.size === expected.size && [...expected].every(([name, bytes]) => actual.get(name)?.equals(bytes))) {
      return { skill: "open-canvas", path: destination, status: "unchanged" };
    }
    throw new Error(`Skill already exists at ${destination}; preserved existing files. Choose another --dir or move the existing skill before installing.`);
  }
  await mkdir(parent, { recursive: true });
  const staging = await mkdtemp(join(parent, ".open-canvas-"));
  try {
    await cp(source, staging, { recursive: true });
    await rename(staging, destination);
  } finally {
    await rm(staging, { recursive: true, force: true });
  }
  return { skill: "open-canvas", path: destination, status: "installed" };
}
