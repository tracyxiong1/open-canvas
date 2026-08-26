import assert from "node:assert/strict";
import { test } from "node:test";

import {
  DEFAULT_ARK_SEEDANCE_MODEL,
  DEFAULT_ARK_SEEDREAM_MODEL,
  GeminiOmniVideoAdapter,
  OpenAIImageAdapter,
  ProviderRoutingError,
  VolcengineArkAdapter,
  createProviderCredential,
  selectProviderRoute,
  type GenerationRequest,
} from "../src/index.js";

const imageRequest: GenerationRequest = {
  jobId: "job_019c8f55-9200-7000-8000-000000000920",
  kind: "image",
  prompt: "A quiet orbital city",
  inputs: [],
  requirements: { aspectRatio: "1:1", mediaType: "image/png" },
};

function configured(...providerIds: string[]) {
  return {
    has(providerId: string): boolean {
      return providerIds.includes(providerId);
    },
  };
}

test("registry routing honors an AI choice and refuses an unconfigured binding override", () => {
  const adapters = [new OpenAIImageAdapter(), new GeminiOmniVideoAdapter()];
  const selected = selectProviderRoute(adapters, {
    request: imageRequest,
    aiChoice: { providerId: "openai", modelId: "gpt-image-2" },
    credentials: configured("openai"),
  });
  assert.deepEqual(selected, {
    providerId: "openai",
    modelId: "gpt-image-2",
    selectionSource: "ai_choice",
  });

  assert.throws(
    () => selectProviderRoute(adapters, {
      request: imageRequest,
      promptOverride: { providerId: "openai" },
      credentials: configured(),
    }),
    (error: unknown) => {
      assert.equal(error instanceof ProviderRoutingError, true);
      assert.equal((error as ProviderRoutingError).code, "missing_credential");
      assert.equal((error as ProviderRoutingError).credentialEnv, "OPENAI_API_KEY");
      return true;
    },
  );
});

test("OpenAI image routing accepts documented arbitrary dimensions and rejects invalid dimensions before submission", () => {
  const adapters = [new OpenAIImageAdapter()];
  const supported = selectProviderRoute(adapters, {
    request: {
      ...imageRequest,
      requirements: {
        aspectRatio: "16:9",
        width: 2048,
        height: 1152,
        mediaType: "image/png",
      },
    },
    credentials: configured("openai"),
  });
  assert.deepEqual(supported, {
    providerId: "openai",
    modelId: "gpt-image-2",
    selectionSource: "registry_default",
  });

  assert.throws(
    () => selectProviderRoute(adapters, {
      request: {
        ...imageRequest,
        requirements: {
          aspectRatio: "16:9",
          width: 2048,
          height: 1153,
          mediaType: "image/png",
        },
      },
      credentials: configured("openai"),
    }),
    (error: unknown) => {
      assert.equal(error instanceof ProviderRoutingError, true);
      assert.equal((error as ProviderRoutingError).code, "no_matching_provider");
      return true;
    },
  );
});

test("OpenAI image routing rejects an unsupported reference media type before a job is submitted", () => {
  const adapters = [new OpenAIImageAdapter()];
  assert.throws(
    () => selectProviderRoute(adapters, {
      request: {
        ...imageRequest,
        inputs: [{ assetId: "asset_animated_reference", kind: "image", mediaType: "image/gif" }],
      },
      credentials: configured("openai"),
    }),
    (error: unknown) => {
      assert.equal(error instanceof ProviderRoutingError, true);
      assert.equal((error as ProviderRoutingError).code, "no_matching_provider");
      return true;
    },
  );
});

test("OpenAI image adapter sends a normalized Image API request and retains bytes only in memory", async () => {
  const calls: Array<{ url: string; init: RequestInit | undefined }> = [];
  const fetcher: typeof fetch = async (url, init) => {
    calls.push({ url: String(url), init });
    return new Response(JSON.stringify({
      data: [{ b64_json: Buffer.from("open-canvas-image-bytes").toString("base64") }],
    }), { status: 200, headers: { "Content-Type": "application/json" } });
  };
  const adapter = new OpenAIImageAdapter(fetcher);
  const submitted = await adapter.submit(imageRequest, "gpt-image-2", {
    credential: createProviderCredential("unit-test-not-a-real-key"),
  });

  assert.equal(submitted.status, "succeeded");
  assert.equal(calls.length, 1);
  assert.equal(calls[0]?.url, "https://api.openai.com/v1/images/generations");
  const headers = new Headers(calls[0]?.init?.headers);
  assert.equal(headers.get("Authorization")?.startsWith("Bearer "), true);
  assert.deepEqual(JSON.parse(String(calls[0]?.init?.body)), {
    model: "gpt-image-2",
    prompt: "A quiet orbital city",
    output_format: "png",
    size: "1024x1024",
  });
  const bytes = Buffer.concat(
    await Array.fromAsync(adapter.openArtifact(submitted.providerJobId, submitted.outputs![0]!.artifactId)),
  );
  assert.equal(bytes.toString(), "open-canvas-image-bytes");
});

test("OpenAI image adapter requests and materializes every selected image candidate", async () => {
  const calls: Array<{ url: string; init: RequestInit | undefined }> = [];
  const fetcher: typeof fetch = async (url, init) => {
    calls.push({ url: String(url), init });
    return new Response(JSON.stringify({
      data: [
        { b64_json: Buffer.from("open-canvas-candidate-one").toString("base64") },
        { b64_json: Buffer.from("open-canvas-candidate-two").toString("base64") },
      ],
    }), { status: 200, headers: { "Content-Type": "application/json" } });
  };
  const adapter = new OpenAIImageAdapter(fetcher);
  const request: GenerationRequest = {
    ...imageRequest,
    jobId: "job_019c8f55-9200-7000-8000-000000000923",
    requirements: { ...imageRequest.requirements, count: 2 },
  };
  const submitted = await adapter.submit(request, "gpt-image-2", {
    credential: createProviderCredential("unit-test-not-a-real-key"),
  });

  assert.equal(submitted.status, "succeeded");
  assert.equal(submitted.outputs?.length, 2);
  assert.equal(submitted.outputs?.[0]?.artifactId === submitted.outputs?.[1]?.artifactId, false);
  assert.deepEqual(JSON.parse(String(calls[0]?.init?.body)), {
    model: "gpt-image-2",
    prompt: "A quiet orbital city",
    output_format: "png",
    size: "1024x1024",
    n: 2,
  });
  const outputs = await Promise.all((submitted.outputs ?? []).map(async (output) => Buffer.concat(
    await Array.fromAsync(adapter.openArtifact(submitted.providerJobId, output.artifactId)),
  )));
  assert.deepEqual(outputs.map((bytes) => bytes.toString()), [
    "open-canvas-candidate-one",
    "open-canvas-candidate-two",
  ]);
});

test("image candidate count is routed only to a provider that advertises enough outputs", () => {
  const adapters = [new OpenAIImageAdapter(), new GeminiOmniVideoAdapter()];
  const selected = selectProviderRoute(adapters, {
    request: {
      ...imageRequest,
      requirements: { ...imageRequest.requirements, count: 4 },
    },
    credentials: configured("openai"),
  });
  assert.equal(selected.providerId, "openai");

  assert.throws(
    () => selectProviderRoute(adapters, {
      request: {
        ...imageRequest,
        requirements: { ...imageRequest.requirements, count: 5 },
      },
      credentials: configured("openai"),
    }),
    (error: unknown) => {
      assert.equal(error instanceof ProviderRoutingError, true);
      assert.equal((error as ProviderRoutingError).code, "no_matching_provider");
      return true;
    },
  );
});

test("OpenAI image adapter uses a project-local multipart reference for image editing", async () => {
  const calls: Array<{ url: string; init: RequestInit | undefined }> = [];
  const fetcher: typeof fetch = async (url, init) => {
    calls.push({ url: String(url), init });
    return new Response(JSON.stringify({
      data: [
        { b64_json: Buffer.from("open-canvas-edited-image-one").toString("base64") },
        { b64_json: Buffer.from("open-canvas-edited-image-two").toString("base64") },
      ],
    }), { status: 200, headers: { "Content-Type": "application/json" } });
  };
  const adapter = new OpenAIImageAdapter(fetcher);
  const request: GenerationRequest = {
    ...imageRequest,
    jobId: "job_019c8f55-9200-7000-8000-000000000922",
    prompt: "Keep the character but move them into a rainy neon street",
    inputs: [
      { assetId: "asset_character", kind: "image", mediaType: "image/png" },
      { assetId: "asset_palette", kind: "image", mediaType: "image/webp" },
    ],
    requirements: { aspectRatio: "16:9", mediaType: "image/webp", count: 2 },
  };
  const submitted = await adapter.submit(request, "gpt-image-2", {
    credential: createProviderCredential("unit-test-not-a-real-key"),
    inputBytes: new Map([
      ["asset_character", Buffer.from("character-reference")],
      ["asset_palette", Buffer.from("palette-reference")],
    ]),
  });

  assert.equal(submitted.status, "succeeded");
  assert.equal(calls.length, 1);
  assert.equal(calls[0]?.url, "https://api.openai.com/v1/images/edits");
  const headers = new Headers(calls[0]?.init?.headers);
  assert.equal(headers.get("Authorization")?.startsWith("Bearer "), true);
  assert.equal(headers.has("Content-Type"), false);
  assert.equal(calls[0]?.init?.body instanceof FormData, true);
  const form = calls[0]?.init?.body as FormData;
  assert.equal(form.get("model"), "gpt-image-2");
  assert.equal(form.get("prompt"), request.prompt);
  assert.equal(form.get("output_format"), "webp");
  assert.equal(form.get("size"), "1792x1008");
  assert.equal(form.get("n"), "2");
  const references = form.getAll("image[]");
  assert.equal(references.length, 2);
  const [character, palette] = references;
  assert.equal(character instanceof Blob, true);
  assert.equal(palette instanceof Blob, true);
  assert.equal(character?.type, "image/png");
  assert.equal(palette?.type, "image/webp");
  assert.equal((character as File).name, "reference-1.png");
  assert.equal((palette as File).name, "reference-2.webp");
  assert.equal(Buffer.from(await (character as Blob).arrayBuffer()).toString(), "character-reference");
  assert.equal(Buffer.from(await (palette as Blob).arrayBuffer()).toString(), "palette-reference");
  assert.equal(submitted.outputs?.length, 2);
  const bytes = await Promise.all((submitted.outputs ?? []).map(async (output) => Buffer.concat(
    await Array.fromAsync(adapter.openArtifact(submitted.providerJobId, output.artifactId)),
  )));
  assert.deepEqual(bytes.map((value) => value.toString()), [
    "open-canvas-edited-image-one",
    "open-canvas-edited-image-two",
  ]);
});

test("OpenAI image adapter refuses image editing when local reference bytes are unavailable", async () => {
  const adapter = new OpenAIImageAdapter(async () => {
    throw new Error("must not fetch without a local reference");
  });
  await assert.rejects(
    adapter.submit({
      ...imageRequest,
      inputs: [{ assetId: "asset_missing", kind: "image", mediaType: "image/png" }],
    }, "gpt-image-2", {
      credential: createProviderCredential("unit-test-not-a-real-key"),
    }),
    (error: unknown) => {
      assert.equal(error instanceof Error, true);
      assert.match((error as Error).message, /reference bytes are unavailable/);
      return true;
    },
  );
});

test("Gemini Omni adapter packages local image bytes and resumes a URI-delivered interaction", async () => {
  const calls: Array<{ url: string; init: RequestInit | undefined }> = [];
  const videoBytes = Buffer.from("open-canvas-video-bytes");
  const fetcher: typeof fetch = async (url, init) => {
    const target = String(url);
    calls.push({ url: target, init });
    if (init?.method === "POST") {
      return new Response(JSON.stringify({
        id: "interaction-test",
        status: "running",
        steps: [],
      }), { status: 200, headers: { "Content-Type": "application/json" } });
    }
    return new Response(JSON.stringify({
      id: "interaction-test",
      status: "completed",
      steps: [{
        type: "model_output",
        content: [{
          type: "video",
          mime_type: "video/mp4",
          data: videoBytes.toString("base64"),
        }],
      }],
    }), { status: 200, headers: { "Content-Type": "application/json" } });
  };
  const adapter = new GeminiOmniVideoAdapter(fetcher);
  const request: GenerationRequest = {
    jobId: "job_019c8f55-9200-7000-8000-000000000921",
    kind: "video",
    prompt: "Turn the reference into a slow reveal",
    inputs: [{ assetId: "asset_reference", kind: "image", mediaType: "image/png" }],
    requirements: {
      aspectRatio: "9:16",
      audio: "required",
      mediaType: "video/mp4",
    },
  };
  const credential = createProviderCredential("unit-test-not-a-real-key");
  const submitted = await adapter.submit(request, "gemini-omni-flash-preview", {
    credential,
    inputBytes: new Map([["asset_reference", Buffer.from("local-reference")]]),
  });
  assert.equal(submitted.status, "running");
  const polling = await adapter.poll(submitted.providerJobId, { credential });
  assert.equal(polling.status, "succeeded");
  assert.equal(calls[0]?.url, "https://generativelanguage.googleapis.com/v1beta/interactions");
  assert.equal(
    calls[1]?.url,
    "https://generativelanguage.googleapis.com/v1beta/interactions/interaction-test",
  );
  const headers = new Headers(calls[0]?.init?.headers);
  assert.equal(headers.has("x-goog-api-key"), true);
  const body = JSON.parse(String(calls[0]?.init?.body));
  assert.deepEqual(body.response_format, {
    type: "video",
    delivery: "uri",
    aspect_ratio: "9:16",
  });
  assert.deepEqual(body.generation_config, { video_config: { task: "image_to_video" } });
  assert.equal(body.input[0].type, "image");
  assert.equal(Buffer.from(body.input[0].data, "base64").toString(), "local-reference");
  const bytes = Buffer.concat(
    await Array.fromAsync(adapter.openArtifact(polling.providerJobId, polling.outputs![0]!.artifactId)),
  );
  assert.deepEqual(bytes, videoBytes);
});

test("Ark image adapter sends a direct BYOK request and materializes base64 output locally", async () => {
  const calls: Array<{ url: string; init: RequestInit | undefined }> = [];
  const fetcher: typeof fetch = async (url, init) => {
    calls.push({ url: String(url), init });
    return new Response(JSON.stringify({
      data: [{ b64_json: Buffer.from("ark-image-bytes").toString("base64") }],
    }), { status: 200, headers: { "Content-Type": "application/json" } });
  };
  const adapter = new VolcengineArkAdapter({ fetcher });
  const submitted = await adapter.submit(imageRequest, DEFAULT_ARK_SEEDREAM_MODEL, {
    credential: createProviderCredential("unit-test-not-a-real-key"),
  });

  assert.equal(submitted.status, "succeeded");
  assert.equal(calls[0]?.url, "https://ark.cn-beijing.volces.com/api/v3/images/generations");
  const headers = new Headers(calls[0]?.init?.headers);
  assert.equal(headers.get("Authorization")?.startsWith("Bearer "), true);
  assert.deepEqual(JSON.parse(String(calls[0]?.init?.body)), {
    model: DEFAULT_ARK_SEEDREAM_MODEL,
    prompt: "A quiet orbital city",
    size: "2048x2048",
    response_format: "b64_json",
    output_format: "png",
    sequential_image_generation: "disabled",
    watermark: false,
  });
  const bytes = Buffer.concat(
    await Array.fromAsync(adapter.openArtifact(submitted.providerJobId, submitted.outputs![0]!.artifactId)),
  );
  assert.equal(bytes.toString(), "ark-image-bytes");
});

test("Ark Seedance 2.5 accepts its documented 30-second upper duration", () => {
  const request: GenerationRequest = {
    jobId: "job_019c8f55-9200-7000-8000-000000000923",
    kind: "video",
    prompt: "A continuous cinematic walk through a night market",
    inputs: [],
    requirements: {
      aspectRatio: "16:9",
      durationSeconds: 30,
      mediaType: "video/mp4",
    },
  };

  const route = selectProviderRoute([new VolcengineArkAdapter()], {
    request,
    credentials: configured("volcengine-ark"),
  });
  assert.equal(DEFAULT_ARK_SEEDANCE_MODEL, "doubao-seedance-2-5-260628");
  assert.deepEqual(route, {
    providerId: "volcengine-ark",
    modelId: DEFAULT_ARK_SEEDANCE_MODEL,
    selectionSource: "registry_default",
  });
});

test("routing skips Ark video before persisting a job when two image references are selected", () => {
  const route = selectProviderRoute([new VolcengineArkAdapter(), new GeminiOmniVideoAdapter()], {
    request: {
      jobId: "job_019c8f55-9200-7000-8000-000000000925",
      kind: "video",
      prompt: "Blend both references into a continuous reveal",
      inputs: [
        { assetId: "asset_first", kind: "image", mediaType: "image/png" },
        { assetId: "asset_second", kind: "image", mediaType: "image/jpeg" },
      ],
      requirements: { aspectRatio: "16:9", audio: "either", mediaType: "video/mp4" },
    },
    credentials: configured("volcengine-ark", "google-gemini"),
  });

  assert.deepEqual(route, {
    providerId: "google-gemini",
    modelId: "gemini-omni-flash-preview",
    selectionSource: "registry_default",
  });
});

test("Ark video adapter submits, polls, and downloads a temporary result without persisting its URL", async () => {
  const calls: Array<{ url: string; init: RequestInit | undefined }> = [];
  const videoBytes = Buffer.from("ark-video-bytes");
  const fetcher: typeof fetch = async (url, init) => {
    const target = String(url);
    calls.push({ url: target, init });
    if (init?.method === "POST") {
      return new Response(JSON.stringify({ id: "cgt-test", status: "queued" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }
    if (target.endsWith("/contents/generations/tasks/cgt-test")) {
      return new Response(JSON.stringify({
        id: "cgt-test",
        status: "succeeded",
        content: { video_url: "https://assets.example.test/generated.mp4" },
      }), { status: 200, headers: { "Content-Type": "application/json" } });
    }
    if (target === "https://assets.example.test/generated.mp4") {
      return new Response(videoBytes, { status: 200, headers: { "Content-Type": "video/mp4" } });
    }
    throw new Error("Unexpected Ark request: " + target);
  };
  const adapter = new VolcengineArkAdapter({ fetcher });
  const request: GenerationRequest = {
    jobId: "job_019c8f55-9200-7000-8000-000000000924",
    kind: "video",
    prompt: "A slow push through a rain-soaked neon street",
    inputs: [{ assetId: "asset_first_frame", kind: "image", mediaType: "image/png" }],
    requirements: {
      aspectRatio: "16:9",
      durationSeconds: 5,
      audio: "required",
      mediaType: "video/mp4",
    },
  };
  const credential = createProviderCredential("unit-test-not-a-real-key");
  const submitted = await adapter.submit(request, DEFAULT_ARK_SEEDANCE_MODEL, {
    credential,
    inputBytes: new Map([["asset_first_frame", Buffer.from("local-first-frame")]]),
  });
  assert.equal(submitted.status, "queued");
  const polling = await adapter.poll(submitted.providerJobId, { credential });
  assert.equal(polling.status, "succeeded");
  assert.equal(calls[0]?.url, "https://ark.cn-beijing.volces.com/api/v3/contents/generations/tasks");
  assert.equal(calls[1]?.url, "https://ark.cn-beijing.volces.com/api/v3/contents/generations/tasks/cgt-test");
  assert.equal(calls[2]?.url, "https://assets.example.test/generated.mp4");
  const body = JSON.parse(String(calls[0]?.init?.body));
  assert.deepEqual(body, {
    model: DEFAULT_ARK_SEEDANCE_MODEL,
    content: [
      { type: "text", text: request.prompt },
      {
        type: "image_url",
        image_url: { url: "data:image/png;base64," + Buffer.from("local-first-frame").toString("base64") },
        role: "first_frame",
      },
    ],
    ratio: "16:9",
    duration: 5,
    generate_audio: true,
    watermark: false,
  });
  const bytes = Buffer.concat(
    await Array.fromAsync(adapter.openArtifact(polling.providerJobId, polling.outputs![0]!.artifactId)),
  );
  assert.deepEqual(bytes, videoBytes);
});
