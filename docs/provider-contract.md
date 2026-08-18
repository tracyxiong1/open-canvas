# Provider routing and BYOK adapter contract

Status: MVP specification for JIM-10.

This document defines the boundary between Open Canvas core and generation
providers. It is intentionally independent of any provider SDK. The canvas
document remains the source of truth for requested work, resolved routes, job
state, and durable asset references; adapters only translate between this
contract and provider APIs.

## Acceptance trace

| MVP requirement | Contract decision |
| --- | --- |
| Image and video jobs | One normalized request and one adapter lifecycle cover both media kinds. |
| Local BYOK lookup | Adapters declare an environment-variable name; a local credential resolver returns an opaque secret only after routing. |
| Capability matching | Routing rejects candidates that cannot meet every required input and output constraint. |
| AI-selected defaults | The planner supplies an optional `aiChoice`; the router validates it and uses a deterministic fallback only when it is absent or ineligible. |
| Prompt-level overrides | `promptOverride` is separate from `aiChoice`, has higher precedence, and fails explicitly instead of silently falling back. |
| Deterministic tests | A credential-free mock adapter has stable identifiers, state transitions, artifacts, and failure behavior. |
| No secret persistence | Secrets, authorization headers, and signed provider URLs are forbidden from the canvas document, logs, fixtures, and errors. |

Billing, price-aware routing, provider quotas, retries, webhook hosting, and UI
behavior are outside this contract.

## Normalized types

The types below are normative TypeScript-shaped pseudocode. The eventual
shared-schema package may express them with a runtime validator without
changing field names or semantics.

```ts
type MediaKind = "image" | "video";
type InputKind = "text" | "image" | "video";

interface GenerationRequest {
  jobId: string;                 // stable core-owned idempotency key
  kind: MediaKind;
  prompt: string;
  inputs: AssetInput[];          // local, durable asset refs; never provider URLs
  requirements: OutputRequirements;
}

interface AssetInput {
  assetId: string;
  kind: Exclude<InputKind, "text">;
  mediaType: string;
}

interface OutputRequirements {
  aspectRatio?: "16:9" | "9:16" | "1:1";
  width?: number;
  height?: number;
  durationSeconds?: number;      // video only
  audio?: "required" | "forbidden" | "either";
  mediaType?: string;
}

interface RouteHint {
  providerId?: string;
  modelId?: string;
}

interface RoutingRequest {
  generation: GenerationRequest;
  promptOverride?: RouteHint;    // binding user intent extracted from the prompt
  aiChoice?: RouteHint;          // planner recommendation, not a binding override
}
```

An empty prompt is invalid. A request must not contain provider-specific
parameters. A future provider-specific escape hatch must be namespaced by
provider and requires a separate contract revision; adapters must not infer or
forward unknown fields.

## Provider manifest and capability matching

```ts
interface ProviderManifest {
  providerId: string;
  credentialEnv?: string;        // absent only for credential-free providers
  capabilities: ModelCapability[];
}

interface ModelCapability {
  modelId: string;
  kind: MediaKind;
  inputKinds: InputKind[];
  outputMediaTypes: string[];
  aspectRatios?: Array<"16:9" | "9:16" | "1:1">;
  sizes?: Array<{ width: number; height: number }>;
  durationsSeconds?: number[];
  audio: "always" | "never" | "optional";
  registryPriority: number;      // lower wins deterministic fallback
}
```

A model is eligible only when all of these statements are true:

1. Its `kind` equals the request kind.
2. It accepts text and every referenced input kind.
3. Its output media types include the required media type, when specified.
4. Every specified aspect ratio, exact size, duration, and audio requirement is
   advertised by the capability.
5. Its provider is locally configured: either it needs no credential, or its
   declared credential environment variable is present and non-empty.

Missing capability data never means "probably supported." When a request sets a
constraint that a manifest does not describe, that candidate does not match.
This keeps routing predictable and prevents adapters from sending requests that
the selected model is known not to satisfy.

## Routing algorithm

The router is deterministic validation code, not an LLM call.

1. Build the capability-matching set without reading secret values.
2. If `promptOverride` is present, filter that set by every field it supplies.
   Return `invalid_override` when no registered capability matches. If a match
   needs an absent credential, return `missing_credential` with the safe
   provider and environment-variable names. Do not use `aiChoice` or a fallback.
3. For non-override routing, remove providers whose required credential is not
   locally configured.
4. If `aiChoice` identifies an eligible provider/model, select it. An ineligible
   recommendation is advisory and may fall through.
5. Otherwise sort by `registryPriority`, then `providerId`, then `modelId`, all
   ascending, and select the first candidate.
6. Return `no_matching_provider` when no eligible candidate exists.

The planner is expected to provide `aiChoice` during normal Codex creation, so
AI selects the provider and model by default. The deterministic fallback makes
CLI behavior and tests reproducible when the planner declines to choose. Cost
must not participate in MVP ranking.

The router returns this non-secret value for persistence in the canvas
document:

```ts
interface ResolvedRoute {
  providerId: string;
  modelId: string;
  selectionSource: "prompt_override" | "ai_choice" | "registry_default";
}

interface RoutingError {
  code: "invalid_override" | "missing_credential" | "no_matching_provider";
  providerId?: string;
  credentialEnv?: string;        // variable name is safe; its value is not
  message: string;
}
```

Persist the resolved route before submission. A retry of the same `jobId` uses
that persisted route unless a new user mutation creates a new job.

## Local credential boundary

```ts
declare const secretBrand: unique symbol;
type Secret = { readonly [secretBrand]: true };

interface CredentialResolver {
  has(providerId: string): boolean;
  resolve(providerId: string): Secret;
}
```

The MVP resolver reads only the environment variable named by the selected
provider manifest. It checks presence during matching and resolves the value
only immediately before calling the adapter. `Secret` exposes no string or JSON
representation to core code; only the adapter transport can unwrap it while
constructing an authorization header.

The following are mandatory:

- Never write credential values to source, local project files, the canvas
  document, task-tracker configuration or metadata, fixtures, snapshots, errors, or
  logs.
- Redact authorization headers and query parameters before transport logging.
- Prefer authorization headers. In particular, the Gemini adapter sends
  `x-goog-api-key` rather than putting the key in a URL that may be logged.
- `has` reports only a boolean. `resolve` returns `missing_credential` without
  including an environment value.
- The preview must never receive a provider credential; generation runs in the
  local CLI process.

## Adapter lifecycle

```ts
type ProviderJobStatus = "queued" | "running" | "succeeded" | "failed";

interface ProviderSnapshot {
  providerJobId: string;
  status: ProviderJobStatus;
  progress?: number;             // inclusive 0..1
  outputs?: ProviderArtifact[];  // present only when succeeded
  error?: ProviderError;         // present only when failed
}

interface ProviderArtifact {
  artifactId: string;            // adapter-private locator, not a canvas asset id
  kind: MediaKind;
  mediaType: string;
  byteLength?: number;
  checksumSha256?: string;
}

interface ProviderError {
  code:
    | "provider_rejected"
    | "provider_unavailable"
    | "provider_protocol"
    | "missing_credential";
  retryable: boolean;
  message: string;               // sanitized, bounded, no provider response dump
}

interface ProviderAdapter {
  readonly manifest: ProviderManifest;
  submit(
    request: GenerationRequest,
    modelId: string,
    credential?: Secret,
  ): Promise<ProviderSnapshot>;
  poll(providerJobId: string, credential?: Secret): Promise<ProviderSnapshot>;
  openArtifact(
    providerJobId: string,
    artifactId: string,
    credential?: Secret,
  ): Promise<AsyncIterable<Uint8Array>>;
}
```

Every provider is normalized to this lifecycle, even when its API returns an
image synchronously: `submit` may immediately return `succeeded`. For
asynchronous providers, `submit` returns `queued` or `running`; core schedules
polling and owns retry timing. Status transitions are monotonic:

```text
queued -> running -> succeeded
   |          |
   +----------+-> failed
```

`progress` may stay absent and must never decrease. Core records the provider
job id before the next poll so a process restart does not resubmit the request.
Adapter methods do not mutate the canvas document.

On success, core streams `openArtifact` into the project asset store, computes
its checksum, and persists only the resulting durable local `assetId`. Provider
URLs and adapter-private artifact locators are transient because they may
expire or embed credentials.

Cancellation is omitted from the MVP boundary. A later optional `cancel`
method can be added without changing submission or polling semantics.

## Initial provider registry

Initial adapters are selected only where current official API documentation
supports the required behavior.

### `openai`

- Credential: `OPENAI_API_KEY`.
- Model: `gpt-image-2`.
- Capability: text-to-image generation; adapter calls the Image API and
  materializes returned image bytes.
- MVP manifest: text input; PNG, JPEG, or WebP output; canonical sizes
  `1024x1024`, `2048x1152`, and `2160x3840`; aspect ratios `1:1`, `16:9`, and
  `9:16`; audio `never`; registry priority `100`.
- Contract mapping: an Image API response is normalized to an immediately
  `succeeded` snapshot.

Official evidence: OpenAI documents `gpt-image-2` as its current image model and
the Image API generations endpoint for single-prompt generation in the
[image generation guide](https://developers.openai.com/api/docs/guides/image-generation)
and [model page](https://developers.openai.com/api/docs/models/gpt-image-2).

### `google-gemini`

- Credential: `GEMINI_API_KEY`.
- Model: `gemini-omni-flash-preview`.
- Capability: text-to-video and image-to-video, MP4 output, native audio, and
  `16:9` or `9:16` aspect ratio.
- MVP manifest: text and image inputs; MP4 output; aspect ratios `16:9` and
  `9:16`; no advertised exact size or duration; audio `always`; registry
  priority `100`. An explicit size, duration, or no-audio requirement therefore
  does not match until official support is recorded in the registry.
- Contract mapping: inline output may immediately succeed; URI delivery is
  normalized to `running` while its file state is processing, `succeeded` when
  active, and `failed` when the file state fails.

Google currently recommends Gemini Omni Flash as the default Gemini API video
model and documents both text/image inputs and MP4 output in the
[video overview](https://ai.google.dev/gemini-api/docs/video) and
[Omni Flash guide](https://ai.google.dev/gemini-api/docs/omni). The model is in
preview, so its identifier and capabilities belong in registry data and must be
reviewed before each release. Google recommends environment-based key lookup in
its [API key guide](https://ai.google.dev/gemini-api/docs/api-key).

### Explicitly not selected: OpenAI Sora 2

The shared adapter contract remains able to represent Sora-style asynchronous
jobs, but Sora 2 is not an initial adapter. OpenAI states that the Sora 2 models
and Videos API are deprecated and will shut down on September 24, 2026 in its
[video generation guide](https://developers.openai.com/api/docs/guides/video-generation).
Selecting it for a new MVP in August 2026 would create an immediate migration.

## Deterministic mock provider

The `mock` adapter requires no credential and advertises two models:
`mock-image-v1` and `mock-video-v1`. It is registered only in tests and explicit
local demo profiles, never in the production registry, so it cannot win a
production fallback.

Its normative behavior is:

1. Canonicalize the request as UTF-8 JSON with recursively sorted object keys
   and original array order.
2. Set `providerJobId` to `mock:` plus the lowercase SHA-256 digest of those
   bytes.
3. `submit` returns `queued` with progress `0`.
4. The first `poll` returns `running` with progress `0.5`.
5. The second and later polls return `succeeded` with progress `1` and one
   stable artifact: a bundled valid 1x1 PNG for image jobs or a bundled valid
   one-frame MP4 for video jobs. Artifact id and checksum are fixture constants.
6. When the prompt starts with `[mock:fail]`, the first poll returns `failed`
   with code `provider_rejected`, `retryable: false`, and message
   `deterministic mock failure`.

Test runners construct a fresh mock adapter per test so poll counts cannot leak
between cases.

## Conformance cases

The future provider package must turn each row into a focused contract test.
No executable test harness exists in the repository at the time of this
specification.

| Case | Expected result |
| --- | --- |
| Image request, OpenAI configured, AI chooses OpenAI | OpenAI route, source `ai_choice`. |
| Video request with image input, Gemini configured, AI chooses Gemini | Gemini route, source `ai_choice`. |
| Prompt overrides provider and model with an eligible pair | Exact pair, source `prompt_override`. |
| Prompt override names an incapable or unknown provider/model | `invalid_override`; no fallback and no adapter call. |
| Prompt override names a capable provider whose credential is absent | `missing_credential` with the safe environment-variable name; no fallback. |
| AI recommendation is incapable but another eligible model exists | Deterministic registry fallback. |
| Required duration, aspect ratio, media type, or audio is not advertised | Candidate is excluded. |
| Required credential variable is absent or empty | Provider is excluded; errors never include a secret value. |
| Same mock request is run twice | Same provider job id, state sequence, artifact id, bytes, and checksum. |
| Prompt begins `[mock:fail]` | Stable non-retryable `provider_rejected` failure. |
| Provider returns a signed artifact URL | URL remains adapter-private; canvas receives only a local asset id. |

## Implementation boundary

When the shared package foundation lands, implement in three focused units:

1. Pure capability matcher and router, with no SDK imports and no credential
   access.
2. Local environment credential resolver with redaction tests.
3. Adapter registry containing the two initial adapters and deterministic mock,
   each behind the same conformance suite.

Provider SDK response objects must not cross this boundary. The canvas schema,
CLI, and preview consume only normalized route, job, error, and asset records.
