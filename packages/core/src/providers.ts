import { createHash } from "node:crypto";

import { canonicalSha256 } from "./canonical.js";

export type MediaKind = "image" | "video";
export interface GenerationRequest {
  jobId: string;
  kind: MediaKind;
  prompt: string;
  inputs: Array<{ assetId: string; kind: MediaKind; mediaType: string }>;
  requirements: {
    aspectRatio?: "16:9" | "9:16" | "1:1";
    width?: number;
    height?: number;
    durationSeconds?: number;
    audio?: "required" | "forbidden" | "either";
    mediaType?: string;
  };
}
export interface ProviderArtifact {
  artifactId: string;
  kind: MediaKind;
  mediaType: string;
  byteLength: number;
  checksumSha256: string;
}
export interface ProviderSnapshot {
  providerJobId: string;
  status: "queued" | "running" | "succeeded" | "failed";
  progress?: number;
  outputs?: ProviderArtifact[];
  error?: {
    code: "provider_rejected" | "provider_unavailable" | "provider_protocol" | "missing_credential";
    retryable: boolean;
    message: string;
  };
}

const PNG_BYTES = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
  "base64",
);
const MP4_BYTES = Buffer.from(
  "AAAAIGZ0eXBpc29tAAACAGlzb21pc28yYXZjMW1wNDEAAALubW9vdgAAAGxtdmhkAAAAAAAAAAAAAAAAAAAD6AAAE4gAAQAAAQAAAAAAAAAAAAAAAAEAAAAAAAAAAAAAAAAAAAABAAAAAAAAAAAAAAAAAABAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAgAAAhl0cmFrAAAAXHRraGQAAAADAAAAAAAAAAAAAAABAAAAAAAAE4gAAAAAAAAAAAAAAAAAAAAAAAEAAAAAAAAAAAAAAAAAAAABAAAAAAAAAAAAAAAAAABAAAAAACAAAAASAAAAAAAkZWR0cwAAABxlbHN0AAAAAAAAAAEAABOIAAAAAAABAAAAAAGRbWRpYQAAACBtZGhkAAAAAAAAAAAAAAAAAABAAAABQABVxAAAAAAALWhkbHIAAAAAAAAAAHZpZGUAAAAAAAAAAAAAAABWaWRlb0hhbmRsZXIAAAABPG1pbmYAAAAUdm1oZAAAAAEAAAAAAAAAAAAAACRkaW5mAAAAHGRyZWYAAAAAAAAAAQAAAAx1cmwgAAAAAQAAAPxzdGJsAAAAmHN0c2QAAAAAAAAAAQAAAIhhdmMxAAAAAAAAAAEAAAAAAAAAAAAAAAAAAAAAACAAEgBIAAAASAAAAAAAAAABAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAGP//AAAAMmF2Y0MBZAAK/+EAGWdkAAqs2Ul+IwEQAAADAFAAAAMAIPEiWWABAAZo6+PLIsAAAAAYc3R0cwAAAAAAAAABAAAAAQABQAAAAAAcc3RzYwAAAAAAAAABAAAAAQAAAAEAAAABAAAAFHN0c3oAAAAAAAACywAAAAEAAAAUc3RjbwAAAAAAAAABAAADHgAAAGF1ZHRhAAAAWW1ldGEAAAAAAAAAIWhkbHIAAAAAAAAAAG1kaXJhcHBsAAAAAAAAAAAAAAAALGlsc3QAAAAkqXRvbwAAABxkYXRhAAAAAQAAAABMYXZmNTYuNC4xMDEAAAAIZnJlZQAAAtNtZGF0AAACrgYF//+q3EXpvebZSLeWLNgg2SPu73gyNjQgLSBjb3JlIDE0MiByMjQ5MSAyNGU0ZmVkIC0gSC4yNjQvTVBFRy00IEFWQyBjb2RlYyAtIENvcHlsZWZ0IDIwMDMtMjAxNCAtIGh0dHA6Ly93d3cudmlkZW9sYW4ub3JnL3gyNjQuaHRtbCAtIG9wdGlvbnM6IGNhYmFjPTEgcmVmPTMgZGVibG9jaz0xOjA6MCBhbmFseXNlPTB4MzoweDExMyBtZT1oZXggc3VibWU9NyBwc3k9MSBwc3lfcmQ9MS4wMDowLjAwIG1peGVkX3JlZj0xIG1lX3JhbmdlPTE2IGNocm9tYV9tZT0xIHRyZWxsaXM9MSA4eDhkY3Q9MSBjcW09MCBkZWFkem9uZT0yMSwxMSBmYXN0X3Bza2lwPTEgY2hyb21hX3FwX29mZnNldD0tMiB0aHJlYWRzPTQ4IGxvb2thaGVhZF90aHJlYWRzPTEgc2xpY2VkX3RocmVhZHM9MCBucj0wIGRlY2ltYXRlPTEgaW50ZXJsYWNlZD0wIGJsdXJheV9jb21wYXQ9MCBjb25zdHJhaW5lZF9pbnRyYT0wIGJmcmFtZXM9MyBiX3B5cmFtaWQ9MiBiX2FkYXB0PTEgYl9iaWFzPTAgZGlyZWN0PTEgd2VpZ2h0Yj0xIG9wZW5fZ29wPTAgd2VpZ2h0cD0yIGtleWludD0yNTAga2V5aW50X21pbj0xIHNjZW5lY3V0PTQwIGludHJhX3JlZnJlc2g9MCByY19sb29rYWhlYWQ9NDAgcmM9Y3JmIG1idHJldD0xIGNyZj0yMy4wIHFjb21wPTAuNjAgcXBtaW49MCBxcG1heD02OSBxcHN0ZXA9NCBpcF9yYXRpbz0xLjQwIGFxPTE6MS4wMACAAAAAFWWIhAAV//73ye/Apuvb3rW/YAEA+Q==",
  "base64",
);

function artifact(kind: MediaKind): { record: ProviderArtifact; bytes: Buffer } {
  const bytes = kind === "image" ? PNG_BYTES : MP4_BYTES;
  const digest = createHash("sha256").update(bytes).digest("hex");
  return {
    record: {
      artifactId: `mock-${kind}-fixture-v1`,
      kind,
      mediaType: kind === "image" ? "image/png" : "video/mp4",
      byteLength: bytes.length,
      checksumSha256: `sha256:${digest}`,
    },
    bytes,
  };
}

export class MockProviderAdapter {
  readonly manifest = {
    providerId: "mock",
    capabilities: [
      {
        modelId: "mock-image-v1",
        kind: "image" as const,
        mediaType: "image/png",
        aspectRatio: "1:1" as const,
        width: 1,
        height: 1,
        audio: "never" as const,
      },
      {
        modelId: "mock-video-v1",
        kind: "video" as const,
        mediaType: "video/mp4",
        aspectRatio: "16:9" as const,
        width: 32,
        height: 18,
        durationSeconds: 5,
        audio: "never" as const,
      },
    ],
  };
  readonly #jobs = new Map<string, { request: GenerationRequest; polls: number }>();

  async submit(request: GenerationRequest, modelId: string): Promise<ProviderSnapshot> {
    if (request.prompt.trim() === "") throw new Error("Generation prompt must not be empty");
    const capability = this.manifest.capabilities.find((candidate) => candidate.modelId === modelId);
    if (!capability || capability.kind !== request.kind) throw new Error(`Unsupported mock model: ${modelId}`);
    const providerJobId = `mock:${canonicalSha256(request).slice("sha256:".length)}`;
    this.#jobs.set(providerJobId, { request: structuredClone(request), polls: 0 });
    return { providerJobId, status: "queued", progress: 0 };
  }

  async poll(providerJobId: string): Promise<ProviderSnapshot> {
    const job = this.#jobs.get(providerJobId);
    if (!job) throw new Error(`Unknown mock job: ${providerJobId}`);
    job.polls += 1;
    if (job.request.prompt.startsWith("[mock:fail]")) {
      return {
        providerJobId,
        status: "failed",
        error: { code: "provider_rejected", retryable: false, message: "deterministic mock failure" },
      };
    }
    if (job.polls === 1) return { providerJobId, status: "running", progress: 0.5 };
    return { providerJobId, status: "succeeded", progress: 1, outputs: [artifact(job.request.kind).record] };
  }

  async *openArtifact(providerJobId: string, artifactId: string): AsyncIterable<Uint8Array> {
    const job = this.#jobs.get(providerJobId);
    if (!job) throw new Error(`Unknown mock job: ${providerJobId}`);
    const output = artifact(job.request.kind);
    if (output.record.artifactId !== artifactId) throw new Error(`Unknown mock artifact: ${artifactId}`);
    yield output.bytes;
  }
}
