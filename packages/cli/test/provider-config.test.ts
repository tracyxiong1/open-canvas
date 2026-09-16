import assert from "node:assert/strict";
import { test } from "node:test";

import {
  createConfiguredProviderAdapters,
  parseProviderConfigurationFile,
  withPersistedRouteModel,
} from "../src/provider-config.ts";

test("speech configuration supports safe named instances and preserves the resumed model", () => {
  const configuration = parseProviderConfigurationFile({ version: 1, providers: [{
    id: "narration", adapter: "openai-speech", credentialEnv: "NARRATION_KEY", models: { audio: "current-speech" },
  }] });
  const resumed = withPersistedRouteModel(configuration.providers, {
    providerId: "narration", modelId: "original-speech", selectionSource: "registry_default",
  }, "audio");
  const adapter = createConfiguredProviderAdapters(resumed)[0]!;
  assert.equal(adapter.manifest.credentialEnv, "NARRATION_KEY");
  assert.equal(adapter.manifest.capabilities[0]!.modelId, "original-speech");
  assert.equal(adapter.manifest.capabilities[0]!.kind, "audio");
  assert.throws(() => parseProviderConfigurationFile({ version: 1, providers: [{
    id: "narration", adapter: "openai-speech", models: { image: "invalid" },
  }] }), /only audio/);
});

test("provider configuration creates a named Ark instance without credentials", () => {
  const configuration = parseProviderConfigurationFile({
    version: 1,
    providers: [{
      id: "studio-ark",
      adapter: "volcengine-ark",
      credentialEnv: "STUDIO_ARK_KEY",
      models: { image: "studio-image-endpoint", video: "studio-video-endpoint" },
      priority: 12,
    }],
  });

  const [adapter] = createConfiguredProviderAdapters(configuration.providers);
  assert.deepEqual(adapter?.manifest, {
    providerId: "studio-ark",
    credentialEnv: "STUDIO_ARK_KEY",
    capabilities: [
      {
        modelId: "studio-image-endpoint",
        kind: "image",
        inputKinds: ["text", "image"],
        inputMediaTypes: ["image/png", "image/jpeg", "image/webp"],
        outputMediaTypes: ["image/png"],
        aspectRatios: ["1:1", "16:9", "9:16"],
        sizes: [
          { width: 2048, height: 2048 },
          { width: 2048, height: 1152 },
          { width: 1152, height: 2048 },
        ],
        maxOutputs: 1,
        audio: "never",
        registryPriority: 12,
      },
      {
        modelId: "studio-video-endpoint",
        kind: "video",
        inputKinds: ["text", "image"],
        inputMediaTypes: ["image/png", "image/jpeg", "image/webp"],
        maxInputs: 1,
        outputMediaTypes: ["video/mp4"],
        aspectRatios: ["1:1", "16:9", "9:16"],
        durationsSeconds: [
          4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15,
          16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30,
        ],
        maxOutputs: 1,
        audio: "optional",
        registryPriority: 12,
      },
    ],
  });
});

test("a persisted route overrides only its resumed media model", () => {
  const configuration = parseProviderConfigurationFile({
    version: 1,
    providers: [{
      id: "studio-ark",
      adapter: "volcengine-ark",
      models: { image: "current-image", video: "current-video" },
    }],
  });

  const resumed = withPersistedRouteModel(configuration.providers, {
    providerId: "studio-ark",
    modelId: "persisted-video",
    selectionSource: "registry_default",
  }, "video");
  const [adapter] = createConfiguredProviderAdapters(resumed);
  assert.deepEqual(adapter?.manifest.capabilities.map((capability) => ({ kind: capability.kind, modelId: capability.modelId })), [
    { kind: "image", modelId: "current-image" },
    { kind: "video", modelId: "persisted-video" },
  ]);
});

test("provider configuration rejects unsupported secret-like fields without reading their values", () => {
  assert.throws(
    () => parseProviderConfigurationFile({
      version: 1,
      providers: [{ id: "studio-ark", adapter: "volcengine-ark", token: "placeholder" }],
    }),
    /unsupported field: token/,
  );
});

test("provider configuration reserves the mock identifier for explicit test routing", () => {
  assert.throws(
    () => parseProviderConfigurationFile({
      version: 1,
      providers: [{ id: "mock", adapter: "openai", models: { image: "image-endpoint" } }],
    }),
    /provider id mock is reserved/,
  );
});
