import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile, access } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { createGzip } from "node:zlib";
import { createWriteStream } from "node:fs";
import { pipeline } from "node:stream/promises";
import tar from "tar-stream";
import { createProject, loadProject, saveProjectAtomic } from "@open-canvas/core";
import { importCanvasMedia } from "../src/media-import.ts";
import { packProject, unpackProject } from "../src/project-archive.ts";
import { mediaExecutable, renderProject, runMediaProcess } from "../src/render.ts";
import { startPreviewBridge } from "../src/preview-bridge.ts";

async function project(t: { after: (fn: () => Promise<void>) => void }) {
  const root = await mkdtemp(join(tmpdir(), "canvas-local-workflows-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const directory = join(root, "project");
  await saveProjectAtomic(directory, createProject({ title: "Portable project" }), { createOnly: true });
  return { root, directory };
}

test("media import preserves results on a node and enforces media kind and revision", async (t) => {
  const { directory } = await project(t);
  const first = await importCanvasMedia(directory, Buffer.from("first image"), { filename: "one.png", x: 200, y: 100 });
  const second = await importCanvasMedia(directory, Buffer.from("second image"), { filename: "two.png", nodeId: first.nodeId, baseRevision: first.document.revision });
  assert.equal(second.document.drafts[0]!.nodes.length, 1);
  assert.equal(second.document.drafts[0]!.jobs.filter((job) => job.status === "succeeded").length, 2);
  assert.equal(second.document.assets.length, 2);
  assert.deepEqual(second.document.drafts[0]!.nodes[0]!.position, { x: 200, y: 100 });
  await assert.rejects(importCanvasMedia(directory, Buffer.from("voice"), { filename: "voice.wav", nodeId: first.nodeId }), /same media type/);
  await assert.rejects(importCanvasMedia(directory, Buffer.from("stale"), { filename: "stale.png", baseRevision: first.document.revision }), /revision conflict/);
  assert.equal((await loadProject(directory)).revision, second.document.revision);
});

test("project package round-trips media and excludes private local files", async (t) => {
  const { root, directory } = await project(t);
  const imported = await importCanvasMedia(directory, Buffer.from("portable image"), { filename: "image.png" });
  await writeFile(join(directory, ".env"), "SYNTHETIC_SECRET=must-not-export");
  const archive = join(root, "complete.ocanvas");
  await packProject(directory, archive);
  await assert.rejects(packProject(directory, archive), /EEXIST/);
  const restored = await unpackProject(archive, join(root, "restored"));
  assert.deepEqual(restored.document, imported.document);
  const asset = restored.document.assets[0]!;
  assert.equal((await readFile(join(restored.projectDirectory, asset.path))).toString(), "portable image");
  await assert.rejects(access(join(restored.projectDirectory, ".env")));
  await assert.rejects(unpackProject(archive, restored.projectDirectory), /already exists/);
  await writeFile(join(directory, asset.path), "corrupt");
  await assert.rejects(packProject(directory, join(root, "corrupt.ocanvas")), /integrity|size mismatch/);
});

async function makeArchive(path: string, entries: { name: string; bytes: Buffer }[]) {
  const pack = tar.pack(); const writing = pipeline(pack, createGzip(), createWriteStream(path));
  for (const entry of entries) pack.entry({ name: entry.name, size: entry.bytes.length }, entry.bytes);
  pack.finalize(); await writing;
}

test("restore rejects missing, corrupt and path-traversal media without exposing a partial project", async (t) => {
  const { root, directory } = await project(t);
  const imported = await importCanvasMedia(directory, Buffer.from("valid"), { filename: "one.png" });
  const header = { name: "project.json", bytes: Buffer.from(JSON.stringify(imported.document)) };
  for (const [index, entries] of [
    [header],
    [header, { name: imported.document.assets[0]!.path, bytes: Buffer.from("wrong") }],
    [header, { name: "../escape", bytes: Buffer.from("bad") }],
    [header, header],
  ].entries()) {
    const archive = join(root, `invalid-${index}.ocanvas`);
    await makeArchive(archive, entries);
    const destination = join(root, `restored-${index}`);
    await assert.rejects(unpackProject(archive, destination), /missing|integrity|undeclared|duplicate/);
    await assert.rejects(access(destination));
  }
  await assert.rejects(access(join(root, "escape")));
});

test("local bridge imports media, streams ranges and requires authorization", async (t) => {
  const { directory } = await project(t);
  const bridge = await startPreviewBridge({ projectDirectory: directory, serveStudio: true });
  t.after(() => bridge.close());
  const endpoint = (path: string) => `${bridge.bridgeUrl}${path}${path.includes("?") ? "&" : "?"}token=${bridge.token}`;
  const before = await loadProject(directory);
  const unauthenticated = await fetch(`${bridge.bridgeUrl}/media`, { method: "POST", body: "bad" });
  assert.equal(unauthenticated.status, 404);
  const result = await fetch(endpoint(`/media?filename=test.mp4&revision=${before.revision}`), { method: "POST", body: "0123456789" });
  assert.equal(result.status, 201);
  const imported = await result.json() as { document: { assets: { id: string }[] } };
  const assetUrl = endpoint(`/asset?id=${imported.document.assets[0]!.id}`);
  const range = await fetch(assetUrl, { headers: { range: "bytes=2-5" } });
  assert.equal(range.status, 206); assert.equal(await range.text(), "2345");
  assert.equal(range.headers.get("content-range"), "bytes 2-5/10");
  const invalid = await fetch(assetUrl, { headers: { range: "bytes=99-" } });
  assert.equal(invalid.status, 416);
  const wrongRevision = await fetch(endpoint(`/media?filename=other.png&revision=${before.revision}`), { method: "POST", body: "bad" });
  assert.equal(wrongRevision.status, 400);
  assert.equal((await fetch(`${bridge.bridgeUrl}/assets/%2e%2e%2f%2e%2e%2fpackage.json`)).status, 404);
  const html = await (await fetch(bridge.bridgeUrl)).text(); assert.match(html, /<div id="root">/);
});

test("render orders real clips, normalizes dimensions and mixes narration into a decodable MP4", { timeout: 60_000 }, async (t) => {
  const { root, directory } = await project(t);
  const nodeIds: string[] = [];
  for (const color of ["red", "blue"]) {
    const file = join(root, `${color}.mp4`);
    await runMediaProcess("ffmpeg", ["-loglevel", "error", "-f", "lavfi", "-i", `color=c=${color}:s=128x96:r=30:d=0.5`, "-c:v", "libx264", "-pix_fmt", "yuv420p", file]);
    nodeIds.push((await importCanvasMedia(directory, await readFile(file), { filename: `${color}.mp4` })).nodeId);
  }
  const voice = join(root, "narration.wav");
  await runMediaProcess("ffmpeg", ["-loglevel", "error", "-f", "lavfi", "-i", "sine=frequency=440:duration=2", voice]);
  const audio = await importCanvasMedia(directory, await readFile(voice), { filename: "narration.wav" });
  const before = await readFile(join(directory, "project.json"));
  const output = join(root, "film.mp4");
  const rendered = await renderProject(directory, { nodeIds: [...nodeIds].reverse(), audioNodeId: audio.nodeId, aspectRatio: "1:1", originalVolume: 0 }, output);
  assert.ok(Math.abs(rendered.durationSeconds - 1) < 0.1);
  const info = JSON.parse(await runMediaProcess("ffprobe", ["-v", "error", "-show_streams", "-show_format", "-of", "json", output]));
  assert.ok(Math.abs(Number(info.format.duration) - 1) < 0.1);
  assert.equal(info.streams.find((s: any) => s.codec_type === "video").width, 720);
  assert.equal(info.streams.find((s: any) => s.codec_type === "video").height, 720);
  assert.equal(info.streams.find((s: any) => s.codec_type === "audio").codec_name, "aac");
  const pixel = (time: string) => execFileSync(mediaExecutable("ffmpeg"), ["-loglevel", "error", "-ss", time, "-i", output, "-frames:v", "1", "-vf", "crop=2:2:360:360,scale=1:1", "-f", "rawvideo", "-pix_fmt", "rgb24", "pipe:1"]);
  const blue = pixel("0.2"); const red = pixel("0.8");
  assert.ok(blue[2]! > blue[0]! + 100); assert.ok(red[0]! > red[2]! + 100);
  const pcm = execFileSync(mediaExecutable("ffmpeg"), ["-loglevel", "error", "-i", output, "-vn", "-f", "s16le", "pipe:1"]);
  assert.ok(pcm.some((byte) => byte !== 0), "narration must produce audible samples");
  assert.deepEqual(await readFile(join(directory, "project.json")), before);
  await assert.rejects(renderProject(directory, { nodeIds }, output), /already exists/);
  await assert.rejects(renderProject(directory, { nodeIds: [audio.nodeId] }, join(root, "bad.mp4")), /no usable result/);
});
