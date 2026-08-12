import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { compile } from "json-schema-to-typescript";

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const sourcePath = resolve(packageRoot, "../../docs/schema/canvas-document-v1.schema.json");
const schemaDir = resolve(packageRoot, "schema");
const schemaPath = resolve(schemaDir, "canvas-document-v1.schema.json");
const typesPath = resolve(packageRoot, "src/canvas-document.generated.ts");
const schemaText = await readFile(sourcePath, "utf8");
const schema = JSON.parse(schemaText);
const types = await compile(schema, "CanvasDocument", {
  bannerComment: "/* Generated from docs/schema/canvas-document-v1.schema.json. Do not edit. */",
  style: { singleQuote: false },
});

await mkdir(schemaDir, { recursive: true });
await mkdir(dirname(typesPath), { recursive: true });
await writeFile(schemaPath, `${JSON.stringify(schema, null, 2)}\n`, "utf8");
await writeFile(typesPath, types, "utf8");
