import { cp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
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
  // Bundled CommonJS dependencies can still require Node built-ins.
  banner: { js: 'import { createRequire } from "node:module"; const require = createRequire(import.meta.url);' },
  legalComments: "eof",
  metafile: true,
});
// Retain license texts for dependencies included in the standalone bundle.
const dependencies = new Set(Object.keys(result.metafile.inputs).flatMap((file) => {
  const match = file.match(/^(.*node_modules\/(?:@[^/]+\/)?[^/]+)\//);
  return match ? [resolve(root, match[1])] : [];
}));
const notices = [];
for (const directory of [...dependencies].sort()) {
  const metadata = JSON.parse(await readFile(resolve(directory, "package.json"), "utf8"));
  const licenses = (await readdir(directory)).filter((name) => /^licen[sc]e(?:$|[.-])/i.test(name));
  notices.push(`${metadata.name}@${metadata.version} (${metadata.license ?? "see license"})`);
  for (const name of licenses.sort()) notices.push(await readFile(resolve(directory, name), "utf8"));
}
await writeFile(resolve(root, "dist/THIRD_PARTY_NOTICES.txt"), notices.join("\n\n"));
await cp(resolve(root, "../../skills/open-canvas"), resolve(root, "dist/skill"), { recursive: true });
