import { cp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { createRequire } from "node:module";
import { build } from "esbuild";

const root = resolve(import.meta.dirname, "..");
await rm(resolve(root, "dist"), { recursive: true, force: true });
const result = await build({
  absWorkingDir: root,
  entryPoints: [resolve(root, "src/main.ts")],
  outfile: resolve(root, "dist/main.js"),
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node22",
  external: ["@ffmpeg-installer/ffmpeg", "@ffprobe-installer/ffprobe"],
  // Bundled CommonJS dependencies can still require Node built-ins.
  banner: { js: 'import { createRequire as __bundleCreateRequire } from "node:module"; const require = __bundleCreateRequire(import.meta.url);' },
  legalComments: "eof",
  metafile: true,
});
// Retain license texts for dependencies included in the standalone bundle.
const dependencies = new Set(Object.keys(result.metafile.inputs).flatMap((file) => {
  const match = file.match(/^(.*node_modules\/(?:@[^/]+\/)?[^/]+)\//);
  return match ? [resolve(root, match[1])] : [];
}));
// Studio ships browser chunks too. Retain licenses for its runtime dependency tree.
const preview = resolve(root, "../preview");
const previewPackage = JSON.parse(await readFile(resolve(preview, "package.json"), "utf8"));
const pending = Object.keys(previewPackage.dependencies).filter((name) => !["@open-canvas/core", "vite", "@vitejs/plugin-react"].includes(name)).map((name) => ({ name, from: preview }));
while (pending.length) {
  const { name, from } = pending.pop();
  let directory;
  let metadata;
  // Asset-only packages can have no exported JS entrypoint. Resolve their
  // package directory using Node's lookup paths, independently of exports.
  for (const lookup of createRequire(resolve(from, "package.json")).resolve.paths(name) ?? []) {
    const candidate = resolve(lookup, name);
    const value = await readFile(resolve(candidate, "package.json"), "utf8").then(JSON.parse).catch(() => null);
    if (value?.name === name) { directory = candidate; metadata = value; break; }
  }
  if (!directory) throw new Error(`Missing license metadata for ${name}`);
  if (dependencies.has(directory)) continue;
  dependencies.add(directory);
  for (const child of Object.keys(metadata.dependencies ?? {}).filter((name) => !name.startsWith("@types/"))) pending.push({ name: child, from: directory });
}
const notices = [];
for (const directory of [...dependencies].sort()) {
  const metadata = JSON.parse(await readFile(resolve(directory, "package.json"), "utf8"));
  const licenses = (await readdir(directory)).filter((name) => /^licen[sc]e(?:$|[.-])/i.test(name));
  notices.push(`${metadata.name}@${metadata.version} (${metadata.license ?? "see license"})`);
  for (const name of licenses.sort()) notices.push(await readFile(resolve(directory, name), "utf8"));
}
await writeFile(resolve(root, "dist/THIRD_PARTY_NOTICES.txt"), notices.join("\n\n"));
await cp(resolve(root, "../../skills/open-canvas"), resolve(root, "dist/skill"), { recursive: true });
await cp(resolve(root, "../preview/dist/client"), resolve(root, "dist/studio"), { recursive: true });
