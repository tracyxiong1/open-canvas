# Provider routing and BYOK adapter contract

状态：本地 MVP 已实现的适配器与路由契约。

This document defines the boundary between Open Canvas core and generation
providers. It is intentionally independent of any provider SDK. The canvas
document remains the source of truth for requested work, resolved routes, job
state, and durable asset references; adapters only translate between this
contract and provider APIs.

当前实现位于 packages/core/src/providers.ts 与
packages/cli/src/commands.ts：

- Core 提供纯能力匹配、路由选择、规范化快照和适配器实现，不读取环境变量。
- CLI 读取用户提供的非敏感 provider 配置，在路由确定后检查其中声明的环境变量、构造临时凭证，并在本地进程内读取项目素材字节。
- 预览端不接收凭证、供应商响应或临时下载地址。
- 当前可执行的真实路径为火山方舟的 Seedream 文生图/项目内参考图生成、Seedance 文生视频/单图首帧视频，以及 OpenAI 图像和 Gemini 视频路径。
- composition 节点当前不执行本地剪辑或渲染；CLI 会要求先生成底层镜头。该限制避免将生成式视频误表示为已完成剪辑。

## Acceptance trace

| MVP requirement | Contract decision |
| --- | --- |
| Image and video jobs | One normalized request and one adapter lifecycle cover both media kinds. |
| Local BYOK lookup | Adapters declare an environment-variable name; a local credential resolver returns an opaque secret only after routing. |
| Capability matching | Routing rejects candidates that cannot meet every required input and output constraint. |
| AI-selected defaults | The planner supplies an optional `aiChoice`; the router validates it and uses the stable locally configured production registry only when it is absent or ineligible. |
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
  count?: number;                // image candidates; local MVP accepts 1..4
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
  maxInputs?: number;            // maximum project-local media references
  outputMediaTypes: string[];
  aspectRatios?: Array<"16:9" | "9:16" | "1:1">;
  sizes?: Array<{ width: number; height: number }>;
  maxOutputs?: number;           // omitted means only one output is supported
  durationsSeconds?: number[];
  audio: "always" | "never" | "optional";
  registryPriority: number;      // lower wins deterministic fallback
}
```

A model is eligible only when all of these statements are true:

1. Its `kind` equals the request kind.
2. It accepts text and every referenced input kind.
3. Its output media types include the required media type, when specified.
4. Every specified aspect ratio, exact size, candidate count, duration, and audio requirement is
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
AI selects the provider and model by default. When it is absent or ineligible,
the CLI selects the first locally configured production capability using the
stable registry order. The mock adapter is omitted from that fallback and is
available only through an explicit mock override in tests or local demos. Cost
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
that persisted route unless a new user mutation creates a new job. In
particular, a resumed job uses the persisted model ID even if the user's future
default configuration has changed.

## Local provider configuration

Provider configuration is local runtime configuration, not canvas data. A user
may pass `--provider-config <path>` to `generate` or set
`OPEN_CANVAS_PROVIDER_CONFIG` to select the configuration file. `provider list`
prints only safe metadata and credential availability.

```json
{
  "version": 1,
  "providers": [
    {
      "id": "ark-primary",
      "adapter": "volcengine-ark",
      "credentialEnv": "ARK_API_KEY",
      "models": {
        "image": "your-ark-image-endpoint",
        "video": "your-ark-video-endpoint"
      },
      "priority": 90
    }
  ]
}
```

`adapter` currently supports `volcengine-ark`, `openai`, and
`google-gemini`. `id` is the stable route identifier persisted on a job;
`models` contains public model or endpoint identifiers only; `credentialEnv`
contains an environment-variable name only. The parser is strict and rejects
unknown fields, so API keys, tokens, endpoint authorization headers, and
arbitrary transport configuration cannot be placed in this file. No config
file keeps the three backward-compatible built-in provider defaults. A config
file replaces those defaults, so keep a provider `id` available while one of
its jobs is queued or running; its model ID may safely change because resume
uses the model persisted on that job.

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
  byteLength: number;
  checksumSha256: string;
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
    context?: ProviderExecutionContext,
  ): Promise<ProviderSnapshot>;
  poll(providerJobId: string, context?: ProviderExecutionContext): Promise<ProviderSnapshot>;
  openArtifact(
    providerJobId: string,
    artifactId: string,
    context?: ProviderExecutionContext,
  ): Promise<AsyncIterable<Uint8Array>>;
}

interface ProviderExecutionContext {
  credential?: Secret;
  inputBytes?: ReadonlyMap<string, Uint8Array>;
}
```

Every provider is normalized to this lifecycle, even when its API returns an
image synchronously: `submit` may immediately return `succeeded`. For
asynchronous providers, `submit` returns `queued` or `running`; the local CLI
owns the bounded polling loop and Core applies only monotonic snapshots. Status
transitions are monotonic:

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

### `volcengine-ark`

- Credential: `ARK_API_KEY`.
- Default models: `doubao-seedream-5-0-260128` for images and
  `doubao-seedance-2-5-260628` for videos. These are public Ark model
  identifiers, not credentials. A user may set `OPEN_CANVAS_ARK_IMAGE_MODEL`
  or `OPEN_CANVAS_ARK_VIDEO_MODEL` to a model identifier or their own Ark
  endpoint identifier; the selected identifier is persisted only as the
  non-secret resolved route.
- Image capability: text-to-image and project-local PNG/JPEG/WebP reference
  images; one PNG output; `1:1`, `16:9`, or `9:16`; exact local presets
  `2048x2048`, `2048x1152`, and `1152x2048`; audio `never`. The adapter
  requests `b64_json` and keeps its bytes in memory until Core writes the
  project-local asset.
- Video capability: Seedance 2.5 text-to-video or one project-local
  PNG/JPEG/WebP first-frame input; MP4 output; `1:1`, `16:9`, or `9:16`; 4
  through 30 second durations; audio `optional`. The current MVP deliberately
  does not expose 2.5's multi-reference, edit, or extend modes yet. The adapter
  creates an asynchronous Ark task, persists only the task ID, polls it, and
  retrieves the completed HTTPS artifact into the local project store. The
  temporary result URL is never persisted.
- Contract mapping: all calls use the public Ark HTTP API directly from the
  local CLI. There is no SDK dependency, product-specific routing dependency,
  or credential migration. An image response succeeds immediately; a video
  response follows the normalized queued/running/succeeded lifecycle.

Official evidence: Ark documents its Bearer `ARK_API_KEY` authentication,
Seedream image endpoint and Base64/image-input response modes in the
[ImageGenerations API](https://api.volcengine.com/api-docs/view?action=ImageGenerations&serviceCode=ark&version=2024-01-01),
and its asynchronous video submission, task ID, and result retrieval in the
[CreateContentsGenerationsTasks API](https://api.volcengine.com/api-docs/view?action=CreateContentsGenerationsTasks&serviceCode=ark&version=2024-01-01)
and [GetContentsGenerationsTask API](https://api.volcengine.com/api-docs/view?action=GetContentsGenerationsTask&serviceCode=ark&version=2024-01-01). The
[Seedance 2.5 tutorial](https://docs.volcengine.com/docs/82379/2607688) defines
the 2.5 model ID, task modes, and supported duration range.

### `openai`

- Credential: `OPENAI_API_KEY`.
- Model: `gpt-image-2`.
- Capability: text-to-image generation and project-local image-reference
  generation/editing. Text-only work uses the Image API generations endpoint;
  image-reference work uses the multipart edits endpoint. Both materialize
  returned Base64 image bytes.
- Current manifest: text and image input; PNG, JPEG, or WebP output; common
  Studio presets `2048x2048`, `2048x1152`, and `1152x2048`; aspect ratios
  `1:1`, `16:9`, and `9:16`; audio `never`; registry priority `100`. In
  addition to those presets, routing accepts any `gpt-image-2` resolution with
  both edges divisible by `16`, max edge `3840`, aspect ratio at most `3:1`,
  and total pixels from `655,360` through `8,294,400`. For example,
  `2048x1152` is valid. The adapter advertises `maxOutputs: 4`; an image
  request may set `count` to `1`, `2`, or `4`. The CLI sends the Image API
  `n` parameter for counts above one and materializes every returned candidate
  as a separate project-local asset.
- Contract mapping: a successful Image API response becomes an immediate
  `succeeded` snapshot. The bytes remain in adapter memory only until Core
  writes the content-addressed project-local asset.
- Project-local reference rule: the CLI passes image bytes only in a transient
  multipart request. PNG, JPEG, and WebP references are accepted; the adapter
  does not persist source bytes, remote file IDs, or provider URLs in the
  canvas document.
- Route validation rule: the same input-media-type rule participates in pure
  capability matching, so an unsupported local reference (for example GIF)
  is rejected before any generation job is persisted or provider request is
  sent.

Official evidence: OpenAI documents `gpt-image-2` as its current image model,
the Image API `n` parameter for multiple generated images, the generations
endpoint for single-prompt generation, and the edits
endpoint with one or more image references in the
[image generation guide](https://developers.openai.com/api/docs/guides/image-generation)
and [model page](https://developers.openai.com/api/docs/models/gpt-image-2).

### `google-gemini`

- Credential: `GEMINI_API_KEY`.
- Model: `gemini-omni-flash-preview`.
- Capability: text-to-video and image-to-video, MP4 output, native audio, and
  `16:9` or `9:16` aspect ratio.
- Current manifest: text and image inputs; MP4 output; aspect ratios `16:9`
  and `9:16`; no advertised exact size or duration; audio `always`; registry
  priority `100`. Explicit size, duration, video-input, or no-audio
  requirements do not match this adapter.
- Contract mapping: the adapter posts an interaction with URI delivery. An
  inline video response completes immediately. A URI-delivered interaction is
  stored as `running`; later CLI polling requests the interaction by ID and
  materializes the returned Base64 bytes when available. The URI itself remains
  adapter-private.

Google currently recommends Gemini Omni Flash as the default Gemini API video
model and documents the interactions endpoint, text/image inputs, MP4 output,
and URI delivery in the
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

The repository contains focused contract tests in
packages/core/test/providers.test.ts and CLI behavior tests in
packages/cli/test/cli.test.ts. They inject an in-memory fetch transport; no
test contacts a real provider or uses a real credential.

| Case | Expected result |
| --- | --- |
| Image request, OpenAI configured, AI chooses OpenAI | OpenAI route, source `ai_choice`. |
| Video request with image input, Gemini configured, AI chooses Gemini | Gemini route, source `ai_choice`. |
| Prompt overrides provider and model with an eligible pair | Exact pair, source `prompt_override`. |
| Prompt override names an incapable or unknown provider/model | `invalid_override`; no fallback and no adapter call. |
| Prompt override names a capable provider whose credential is absent | `missing_credential` with the safe environment-variable name; no fallback. |
| AI recommendation is incapable but another eligible model exists | Stable production-registry fallback; mock is excluded. |
| Required duration, aspect ratio, media type, or audio is not advertised | Candidate is excluded. |
| Image request asks for 2 or 4 candidates | Only an adapter advertising enough `maxOutputs` is eligible; OpenAI materializes every returned image locally. |
| Required credential variable is absent or empty | Provider is excluded; errors never include a secret value. |
| Same mock request is run twice | Same provider job id, state sequence, artifact id, bytes, and checksum. |
| Prompt begins `[mock:fail]` | Stable non-retryable `provider_rejected` failure. |
| Provider returns a signed artifact URL | URL remains adapter-private; canvas receives only a local asset id. |

## Implementation boundary

The current implementation uses three focused units:

1. Pure capability matcher and router in Core, with no environment access.
2. CLI-only local environment resolver and local asset-byte loader.
3. Adapter registry containing Ark Image/Video, OpenAI Image, Gemini Omni Flash,
   OpenAI Speech, and the explicit-only deterministic mock.

Provider SDK response objects must not cross this boundary. The canvas schema,
CLI, and preview consume only normalized route, job, error, and asset records.

## Speech extension (2026-09-15)

`openai-speech` implements official `POST /v1/audio/speech`. Its default model
is `gpt-4o-mini-tts`, credential environment variable is `OPENAI_API_KEY`, and
configuration uses `models.audio`. Supported outputs are WAV (`audio/wav`,
default) and MP3 (`audio/mpeg`); voice defaults to `coral`, speed to 1. The
adapter validates voice, speed and text length, rejects media references, and
uses a bounded transport timeout with sanitized errors. Response bytes remain
process-local until the CLI materializes the local content-addressed asset.

Speech is synchronous, with no provider retrieval handle. The CLI persists a
submission marker before sending. If interrupted after that boundary, resume
reports unavailable synchronous results rather than sending another paid
request automatically. A deliberate new attempt may incur another charge.
No real speech provider was contacted by the unit tests or local browser QA.

Protocol evidence: [Create speech](https://developers.openai.com/api/reference/resources/audio/subresources/speech/methods/create)
and [Text-to-speech guide](https://developers.openai.com/api/docs/guides/text-to-speech).
