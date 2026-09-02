import { readFile } from "node:fs/promises";

import {
  DEFAULT_ARK_SEEDANCE_MODEL,
  DEFAULT_ARK_SEEDREAM_MODEL,
  DEFAULT_GEMINI_OMNI_VIDEO_MODEL,
  DEFAULT_OPENAI_IMAGE_MODEL,
  DEFAULT_OPENAI_SPEECH_MODEL,
  OpenAISpeechAdapter,
  GeminiOmniVideoAdapter,
  OpenAIImageAdapter,
  VolcengineArkAdapter,
  type MediaKind,
  type ProviderAdapter,
  type ResolvedRoute,
} from "@open-canvas/core";

import { CliUsageError } from "./args.js";

export type BuiltInProviderAdapter = "volcengine-ark" | "openai" | "google-gemini" | "openai-speech";

export type ProviderModels = {
  image?: string;
  video?: string;
  audio?: string;
};

/**
 * A non-secret, user-owned configuration for one built-in adapter instance.
 * API keys remain in the environment variable named by `credentialEnv`.
 */
export type ProviderConfiguration = {
  id: string;
  adapter: BuiltInProviderAdapter;
  credentialEnv?: string;
  models?: ProviderModels;
  priority?: number;
};

export type ProviderConfigurationFile = {
  version: 1;
  providers: ProviderConfiguration[];
};

export type LoadedProviderConfiguration = {
  source: "defaults" | "file";
  providers: ProviderConfiguration[];
  path?: string;
};

const IDENTIFIER_PATTERN = /^[a-z][a-z0-9-]{0,63}$/;
const CREDENTIAL_ENV_PATTERN = /^[A-Z_][A-Z0-9_]*$/;

function configuredModel(environment: NodeJS.ProcessEnv, name: string, fallback: string): string {
  const value = environment[name]?.trim();
  return value === undefined || value === "" ? fallback : value;
}

export function defaultProviderConfigurations(
  environment: NodeJS.ProcessEnv = process.env,
): ProviderConfiguration[] {
  return [
    {
      id: "openai-speech", adapter: "openai-speech", credentialEnv: "OPENAI_API_KEY",
      models: { audio: DEFAULT_OPENAI_SPEECH_MODEL }, priority: 100,
    },
    {
      id: "volcengine-ark",
      adapter: "volcengine-ark",
      credentialEnv: "ARK_API_KEY",
      models: {
        image: configuredModel(environment, "OPEN_CANVAS_ARK_IMAGE_MODEL", DEFAULT_ARK_SEEDREAM_MODEL),
        video: configuredModel(environment, "OPEN_CANVAS_ARK_VIDEO_MODEL", DEFAULT_ARK_SEEDANCE_MODEL),
      },
      priority: 90,
    },
    {
      id: "openai",
      adapter: "openai",
      credentialEnv: "OPENAI_API_KEY",
      models: { image: DEFAULT_OPENAI_IMAGE_MODEL },
      priority: 100,
    },
    {
      id: "google-gemini",
      adapter: "google-gemini",
      credentialEnv: "GEMINI_API_KEY",
      models: { video: DEFAULT_GEMINI_OMNI_VIDEO_MODEL },
      priority: 100,
    },
  ];
}

function asObject(value: unknown, message: string): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) throw new CliUsageError(message);
  return value as Record<string, unknown>;
}

function assertOnlyKeys(value: Record<string, unknown>, keys: readonly string[], label: string): void {
  for (const key of Object.keys(value)) {
    if (!keys.includes(key)) throw new CliUsageError(`${label} contains unsupported field: ${key}`);
  }
}

function requiredString(value: unknown, label: string): string {
  if (typeof value !== "string" || value.trim() === "") throw new CliUsageError(`${label} must be a non-empty string`);
  return value.trim();
}

function optionalString(value: unknown, label: string): string | undefined {
  if (value === undefined) return undefined;
  return requiredString(value, label);
}

function parseModels(value: unknown, adapter: BuiltInProviderAdapter): ProviderModels | undefined {
  if (value === undefined) return undefined;
  const models = asObject(value, "provider models must be an object");
  assertOnlyKeys(models, ["image", "video", "audio"], "provider models");
  const audio = optionalString(models.audio, "provider audio model");
  if (adapter === "openai-speech") {
    if (audio === undefined || models.image !== undefined || models.video !== undefined) {
      throw new CliUsageError("openai-speech provider models must contain only audio");
    }
    return { audio };
  }
  if (audio !== undefined) throw new CliUsageError("audio model requires the openai-speech adapter");
  const image = optionalString(models.image, "provider image model");
  const video = optionalString(models.video, "provider video model");
  const parsed = {
    ...(image === undefined ? {} : { image }),
    ...(video === undefined ? {} : { video }),
  };
  if (adapter === "openai" && (parsed.image === undefined || parsed.video !== undefined)) {
    throw new CliUsageError("openai provider models must contain only image");
  }
  if (adapter === "google-gemini" && (parsed.video === undefined || parsed.image !== undefined)) {
    throw new CliUsageError("google-gemini provider models must contain only video");
  }
  if (adapter === "volcengine-ark" && parsed.image === undefined && parsed.video === undefined) {
    throw new CliUsageError("volcengine-ark provider models must contain image or video");
  }
  return parsed;
}

function parseProviderConfiguration(value: unknown): ProviderConfiguration {
  const provider = asObject(value, "provider configuration must be an object");
  assertOnlyKeys(provider, ["id", "adapter", "credentialEnv", "models", "priority"], "provider configuration");
  const id = requiredString(provider.id, "provider id");
  if (!IDENTIFIER_PATTERN.test(id)) {
    throw new CliUsageError("provider id must use lowercase letters, digits, and hyphens");
  }
  if (id === "mock") throw new CliUsageError("provider id mock is reserved for explicit test routing");
  const adapter = requiredString(provider.adapter, "provider adapter");
  if (adapter !== "volcengine-ark" && adapter !== "openai" && adapter !== "google-gemini" && adapter !== "openai-speech") {
    throw new CliUsageError(`Unsupported provider adapter: ${adapter}`);
  }
  const credentialEnv = optionalString(provider.credentialEnv, "provider credentialEnv");
  if (credentialEnv !== undefined && !CREDENTIAL_ENV_PATTERN.test(credentialEnv)) {
    throw new CliUsageError("provider credentialEnv must be an environment variable name");
  }
  const priority = provider.priority;
  if (priority !== undefined && (typeof priority !== "number" || !Number.isSafeInteger(priority) || priority < 0)) {
    throw new CliUsageError("provider priority must be a non-negative integer");
  }
  const models = parseModels(provider.models, adapter);
  return {
    id,
    adapter,
    ...(credentialEnv === undefined ? {} : { credentialEnv }),
    ...(models === undefined ? {} : { models }),
    ...(priority === undefined ? {} : { priority: priority as number }),
  };
}

export function parseProviderConfigurationFile(value: unknown): ProviderConfigurationFile {
  const file = asObject(value, "provider config must be a JSON object");
  assertOnlyKeys(file, ["version", "providers"], "provider config");
  if (file.version !== 1) throw new CliUsageError("provider config version must be 1");
  if (!Array.isArray(file.providers) || file.providers.length === 0) {
    throw new CliUsageError("provider config must contain at least one provider");
  }
  const providers = file.providers.map(parseProviderConfiguration);
  const ids = new Set<string>();
  for (const provider of providers) {
    if (ids.has(provider.id)) throw new CliUsageError(`provider config contains duplicate id: ${provider.id}`);
    ids.add(provider.id);
  }
  return { version: 1, providers };
}

export async function loadProviderConfiguration(options: {
  path?: string;
  environment?: NodeJS.ProcessEnv;
} = {}): Promise<LoadedProviderConfiguration> {
  const environment = options.environment ?? process.env;
  const path = options.path?.trim() || environment.OPEN_CANVAS_PROVIDER_CONFIG?.trim();
  if (!path) return { source: "defaults", providers: defaultProviderConfigurations(environment) };
  let contents: string;
  try {
    contents = await readFile(path, "utf8");
  } catch {
    throw new CliUsageError("Unable to read provider config file");
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(contents);
  } catch {
    throw new CliUsageError("Provider config must be valid JSON");
  }
  return { source: "file", path, providers: parseProviderConfigurationFile(parsed).providers };
}

export function createConfiguredProviderAdapters(configurations: readonly ProviderConfiguration[]): ProviderAdapter[] {
  return configurations.map((configuration) => {
    const priority = configuration.priority;
    switch (configuration.adapter) {
      case "openai-speech":
        return new OpenAISpeechAdapter({
          providerId: configuration.id,
          ...(configuration.credentialEnv === undefined ? {} : { credentialEnv: configuration.credentialEnv }),
          ...(configuration.models === undefined ? {} : { modelId: configuration.models.audio! }),
          ...(priority === undefined ? {} : { registryPriority: priority }),
        });
      case "volcengine-ark":
        return new VolcengineArkAdapter({
          providerId: configuration.id,
          ...(configuration.credentialEnv === undefined ? {} : { credentialEnv: configuration.credentialEnv }),
          ...(configuration.models === undefined
            ? {}
            : {
                imageModelId: configuration.models.image ?? null,
                videoModelId: configuration.models.video ?? null,
              }),
          ...(priority === undefined ? {} : { registryPriority: priority }),
        });
      case "openai":
        return new OpenAIImageAdapter({
          providerId: configuration.id,
          ...(configuration.credentialEnv === undefined ? {} : { credentialEnv: configuration.credentialEnv }),
          ...(configuration.models === undefined ? {} : { modelId: configuration.models.image! }),
          ...(priority === undefined ? {} : { registryPriority: priority }),
        });
      case "google-gemini":
        return new GeminiOmniVideoAdapter({
          providerId: configuration.id,
          ...(configuration.credentialEnv === undefined ? {} : { credentialEnv: configuration.credentialEnv }),
          ...(configuration.models === undefined ? {} : { modelId: configuration.models.video! }),
          ...(priority === undefined ? {} : { registryPriority: priority }),
        });
    }
  });
}

function adapterSupportsKind(adapter: BuiltInProviderAdapter, kind: MediaKind): boolean {
  if (kind === "audio" || adapter === "openai-speech") return kind === "audio" && adapter === "openai-speech";
  return adapter === "volcengine-ark" || (adapter === "openai" ? kind === "image" : kind === "video");
}

/**
 * A persisted route is an execution record. When an in-flight job is resumed,
 * preserve its exact model ID even if the user has since changed the default.
 */
export function withPersistedRouteModel(
  configurations: readonly ProviderConfiguration[],
  route: ResolvedRoute,
  kind: MediaKind,
): ProviderConfiguration[] {
  return configurations.map((configuration) => {
    if (configuration.id !== route.providerId || !adapterSupportsKind(configuration.adapter, kind)) return configuration;
    return {
      ...configuration,
      models: { ...configuration.models, [kind]: route.modelId },
    };
  });
}
