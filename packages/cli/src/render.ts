import { spawn } from "node:child_process";
import { accessSync, chmodSync, constants, createReadStream } from "node:fs";
import { access, link, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { Writable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { effectiveOutputAssetIds, loadProject, type Asset } from "@open-canvas/core";
import { verifyAssetStream } from "./project-archive.js";

const require = createRequire(import.meta.url);
export function mediaExecutable(name: "ffmpeg" | "ffprobe"): string {
  const override = process.env[`OPEN_CANVAS_${name.toUpperCase()}`];
  if (override) return override;
  const path = (require(name === "ffmpeg" ? "@ffmpeg-installer/ffmpeg" : "@ffprobe-installer/ffprobe") as { path: string }).path;
  // npm can disable dependency install scripts. These packages use theirs only
  // to set the shipped executable bit; prepare that owned binary on first use.
  if (process.platform !== "win32") {
    try { accessSync(path, constants.X_OK); } catch { chmodSync(path, 0o755); }
  }
  return path;
}

export async function runMediaProcess(name: "ffmpeg" | "ffprobe", args: string[]): Promise<string> {
  const executable = mediaExecutable(name);
  return new Promise((done, reject) => {
    const child = spawn(executable, args, { stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
    let stdout = ""; let stderr = "";
    const timer = setTimeout(() => { child.kill("SIGKILL"); }, 10 * 60_000);
    child.stdout.on("data", (chunk: Buffer) => { stdout = (stdout + chunk.toString()).slice(-128_000); });
    child.stderr.on("data", (chunk: Buffer) => { stderr = (stderr + chunk.toString()).slice(-4000); });
    child.once("error", (error) => { clearTimeout(timer); reject(error); });
    child.once("close", (code) => { clearTimeout(timer); code === 0 ? done(stdout) : reject(new Error(`${name} failed: ${stderr || "process interrupted"}`)); });
  });
}

const formats: Record<string, string> = {
  "video/mp4": "mov", "video/quicktime": "mov", "video/webm": "matroska",
  "audio/wav": "wav", "audio/mpeg": "mp3", "audio/mp4": "mov", "audio/ogg": "ogg", "audio/flac": "flac",
};

export interface RenderOptions {
  draftId?: string;
  nodeIds: string[];
  audioNodeId?: string;
  aspectRatio?: "16:9" | "9:16" | "1:1";
  originalVolume?: number;
  narrationVolume?: number;
  baseRevision?: number;
}

/** Export explicitly selected results, in the supplied order, without altering the canvas. */
export async function renderProject(directory: string, options: RenderOptions, output: string): Promise<{ output: string; durationSeconds: number; assetIds: string[] }> {
  const document = await loadProject(directory);
  if (options.baseRevision !== undefined && document.revision !== options.baseRevision) throw new Error("project revision conflict; reload before exporting");
  const draft = document.drafts.find((item) => item.id === (options.draftId ?? document.activeDraftId));
  if (!draft) throw new Error("Unknown draft");
  if (!Array.isArray(options.nodeIds) || options.nodeIds.length === 0 || options.nodeIds.length > 100) throw new Error("Select 1 to 100 video clips in playback order");
  const choose = (nodeId: string, kind: string): Asset => {
    const node = draft.nodes.find((item) => item.id === nodeId);
    const asset = node && document.assets.find((item) => item.id === effectiveOutputAssetIds(node)[0]);
    if (!asset || asset.kind !== kind || !formats[asset.mediaType]) throw new Error(`Selected ${kind} node has no usable result`);
    return asset;
  };
  const clips = options.nodeIds.map((nodeId) => choose(nodeId, "video"));
  const narration = options.audioNodeId ? choose(options.audioNodeId, "audio") : undefined;
  const originalVolume = options.originalVolume ?? 1;
  const narrationVolume = options.narrationVolume ?? 1;
  if (![originalVolume, narrationVolume].every((value) => Number.isFinite(value) && value >= 0 && value <= 2)) throw new Error("Audio volume must be between 0 and 2");
  const ratio = options.aspectRatio ?? "16:9";
  const size = { "16:9": [1280, 720], "9:16": [720, 1280], "1:1": [720, 720] }[ratio];
  if (!size) throw new Error("Unsupported export aspect ratio");
  const [width, height] = size;
  const target = resolve(output);
  if (await access(target).then(() => true, () => false)) throw new Error("Output already exists; choose a new filename");
  await mkdir(dirname(target), { recursive: true });
  const temporary = await mkdtemp(join(dirname(target), ".open-canvas-render-"));
  const argsFor = (asset: Asset) => ["-protocol_whitelist", "file,pipe", "-f", formats[asset.mediaType]!, "-i", join(directory, asset.path)];
  try {
    for (const asset of new Map([...clips, ...(narration ? [narration] : [])].map((item) => [item.id, item])).values()) {
      await pipeline(createReadStream(join(directory, asset.path)), verifyAssetStream(asset), new Writable({ write(_chunk, _encoding, next) { next(); } }));
    }
    let durationSeconds = 0;
    for (const [index, clip] of clips.entries()) {
      const info = JSON.parse(await runMediaProcess("ffprobe", ["-v", "error", ...argsFor(clip), "-show_streams", "-show_format", "-of", "json"])) as { streams: { codec_type: string; duration?: string }[]; format: { duration?: string } };
      const video = info.streams.find((item) => item.codec_type === "video");
      const duration = Number(video?.duration ?? info.format.duration);
      if (!video || !Number.isFinite(duration) || duration <= 0 || duration > 3600) throw new Error("Video clip has no valid duration (maximum one hour)");
      durationSeconds += duration;
      const audio = info.streams.some((item) => item.codec_type === "audio");
      await runMediaProcess("ffmpeg", ["-hide_banner", "-loglevel", "error", "-nostdin", ...argsFor(clip),
        ...(audio ? [] : ["-f", "lavfi", "-i", "anullsrc=r=48000:cl=stereo"]),
        "-map", "0:v:0", "-map", audio ? "0:a:0" : "1:a:0",
        "-vf", `scale=${width}:${height}:force_original_aspect_ratio=decrease,pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2,setsar=1,fps=30,format=yuv420p`,
        "-af", `volume=${originalVolume},aresample=48000,apad`, "-t", String(duration),
        "-c:v", "libx264", "-threads", "2", "-preset", "veryfast", "-crf", "20", "-c:a", "aac", "-ar", "48000", "-ac", "2", "-b:a", "192k",
        "-movflags", "+faststart", join(temporary, `clip-${index}.mp4`)]);
    }
    await writeFile(join(temporary, "clips.txt"), clips.map((_item, index) => `file 'clip-${index}.mp4'`).join("\n"));
    const joined = join(temporary, "joined.mp4");
    await runMediaProcess("ffmpeg", ["-hide_banner", "-loglevel", "error", "-nostdin", "-f", "concat", "-safe", "1", "-i", join(temporary, "clips.txt"), "-c", "copy", "-movflags", "+faststart", joined]);
    let result = joined;
    if (narration) {
      result = join(temporary, "final.mp4");
      await runMediaProcess("ffmpeg", ["-hide_banner", "-loglevel", "error", "-nostdin", "-i", joined, ...argsFor(narration),
        // Both padded inputs stay active; compensate amix's default 1/2 gain.
        // This also works with the older FFmpeg builds shipped on Linux.
        "-filter_complex", `[1:a:0]volume=${narrationVolume},apad[voice];[0:a:0][voice]amix=inputs=2:duration=first:dropout_transition=0,volume=2[mix]`,
        "-map", "0:v:0", "-map", "[mix]", "-c:v", "copy", "-c:a", "aac", "-ar", "48000", "-ac", "2", "-b:a", "192k", "-t", String(durationSeconds), "-movflags", "+faststart", result]);
    }
    await link(result, target);
    return { output: target, durationSeconds, assetIds: [...clips, ...(narration ? [narration] : [])].map((asset) => asset.id) };
  } finally { await rm(temporary, { recursive: true, force: true }); }
}
