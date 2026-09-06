---
id: "switcher-readme"
title: "Switcher"
type: "package-documentation"
owner: "codex-fixer"
created_at: "2026-09-05T12:50:21.698672Z"
updated_at: "2026-09-06T08:58:51.655382+00:00"
status: "active"
source_task: "01a07181-ca8d-70c1-99a2-b276dc5770f3"
---

# Switcher

Launch Claude Code, Codex, Grok Build or OpenCode 2 with a chosen compatible provider and its model catalog. An authenticated API owns profiles and run metadata; the CLI starts the native harness on your computer. Import the same HTTP client from `@hasna/switcher/sdk`.

Requires Bun 1.3.14 or newer. Install the native harnesses separately.

```sh
npm install -g @hasna/switcher
switcher --help
switcher doctor
```

## Direct launch

The following flow is implemented on the development branch and awaits the next npm release; npm 0.1.0 still requires explicit API/provider/profile setup.

Supply the provider key through environment injection (`DEEPSEEK_API_KEY`, `OPENROUTER_API_KEY`, or an explicit `SWITCHER_PROVIDER_*` reference), or configure a local credential binding below. Switcher never saves the value.

```sh
switcher providers presets
switcher models deepseek
switcher launch claude --provider deepseek
# Deterministic automation: choose an exact ID from the discovered catalog.
switcher launch claude --provider deepseek --model deepseek-v4-pro
switcher launch codex --provider openrouter --model anthropic/claude-sonnet-4.6
```

An interactive terminal can choose or search the catalog when `--model` is omitted. Noninteractive launches require an explicit model. `--dry-run` resolves and saves the provider/profile and fresh catalog, then prints the launch plan without starting the harness or creating a run record. Existing `switcher launch PROFILE` commands remain supported. Direct launches create or reuse records without overwriting customized providers or profiles.

When no remote API configuration is present, each CLI invocation starts an authenticated loopback API on an allocated port, stores SQLite data in `~/.hasna/switcher`, and closes its own listener on completion. Its random operator key remains in memory. Use `HASNA_SWITCHER_HOME` to choose another owner-only home, `HASNA_SWITCHER_SQLITE_PATH` for an explicit database, or `HASNA_SWITCHER_DATABASE_URL` for PostgreSQL. API and SDK data access remains HTTP.

If either remote API variable is configured, both `HASNA_SWITCHER_API_URL` and `HASNA_SWITCHER_API_KEY` are required. An unreachable or misconfigured remote API fails; it never selects a local database instead. The SDK always requires an explicitly configured API.

The registry contains DeepSeek, OpenRouter, Anthropic, OpenAI, xAI, Ollama, LM Studio, Groq, Cerebras, Mistral, Together AI, Fireworks, Moonshot/Kimi, DashScope, Z.AI, MiniMax, SiliconFlow, and generic protocol entries. `switcher providers presets ID` exposes documented routes, aliases and limitations; this is not a claim that every combination has passed live tests. Remaining adapters and acceptance gates are tracked in [TODOS.md](TODOS.md).

## Credential bindings

Bind an existing vault key once, then launch without an external wrapper. Use your vault's URL and the installed `secrets` CLI. On macOS, `--vault-account` selects the operator's `hasna.credentials.secrets.api-key` Keychain item. Without that option, inject `HASNA_SECRETS_API_KEY` for each process.

```sh
switcher credentials bind deepseek \
  --vault-key providers/deepseek/live/api_key --vault-url https://vault.example \
  --vault-account my-station
switcher credentials check deepseek
switcher launch claude --provider deepseek --model deepseek-v4-pro
```

`--vault-cli /absolute/path/to/secrets` selects a particular installation. Vault lookup uses `secrets exec` to inject the value into a short-lived receiver, which delivers it over an authenticated loopback connection. Values stay in process memory. The lookup has a 20-second deadline and owns a separate process group; it finishes before the native harness starts. Each lookup reads the vault again. Conflicting Secrets service URL configuration fails explicitly. Vault CLI bindings currently require POSIX; Windows callers can inject provider environment variables.

For provider keys already stored in macOS Keychain, use `--keychain-service SERVICE --keychain-account ACCOUNT` instead of vault options. Bindings contain only references and authorized origins under `~/.hasna/switcher/config/credential-bindings`, in owner-only files. They remain local even when Switcher uses a remote API. A configured binding takes precedence over environment aliases; an unavailable binding never falls back to another account.

`credentials list` displays bindings; `credentials remove PRESET_OR_REFERENCE` removes only the locator. Replacement requires explicit removal. Custom credential references require `--origin URL` (repeatable); preset bindings authorize their documented origins by default. `credentials check` reports availability, length and hash, not successful provider authentication. Provider credentials needed by a remote API's catalog discovery must still be configured on that server independently.

## Run a persistent service

Inject a random operator token of at least 24 characters as `HASNA_SWITCHER_API_KEY` through your secret manager. Inject provider credentials separately, using names beginning `SWITCHER_PROVIDER_`. Only environment references are persisted. Explicitly hosted servers read `SWITCHER_PROVIDER_*` references; the local launcher also accepts the standard aliases declared by each built-in preset.

```sh
# SQLite: persistent hosted service and database.
switcher-serve --data-dir ~/.hasna/switcher --port 8080

# PostgreSQL: inject HASNA_SWITCHER_DATABASE_URL, then:
switcher-serve --port 8080
```

Choose exactly one backend. There is no automatic fallback. Both backends run migrations and the same behavioral tests. SQLite HTTP hosting is an explicit switcher-specific product requirement; clients always use HTTP. Use PostgreSQL for multiple service instances.

Set `HASNA_SWITCHER_API_URL=http://127.0.0.1:8080` for clients and inject the operator token into each process. Remote URLs require HTTPS. The service binds loopback by default; put a TLS reverse proxy in front of an explicitly hosted listener. This release has one operator authority per service, not tenant isolation.

For containers, build the package first, then use `docker compose --profile sqlite up --build`. For PostgreSQL, inject `SWITCHER_POSTGRES_PASSWORD` and a matching URI in `HASNA_SWITCHER_DATABASE_URL` using hostname `postgres`, database/user `switcher`; run `docker compose --profile postgres up --build`. URI-encode password characters. Choose one profile. Compose exposes only loopback port 8080 and persists named volumes.

## Add a provider and launch

```sh
switcher providers add openrouter-responses --preset openrouter \
  --protocol openai-responses --credential-env SWITCHER_PROVIDER_OPENROUTER
switcher providers refresh openrouter-responses
switcher models openrouter-responses --search claude --limit 1000
switcher profiles add coding --provider openrouter-responses \
  --harness codex --model anthropic/claude-sonnet-4.6
switcher launch coding -- --help
# Interactive native launch:
switcher launch coding
```

The model ID is an example; choose an exact ID from the current catalog and verify account access. Use `--url https://provider.example/api/v1` instead of the preset for any compatible endpoint. The base URL includes the provider API version/path. Presets declare the appropriate discovery URL separately; DeepSeek discovers models at its root while Messages inference uses its Anthropic path. Select a separate provider profile for each wire protocol. The launch adapters normalize native endpoint conventions.

For Claude use `--harness claude` with `anthropic-messages`; for Grok or OpenCode 2 use their supported protocol. Pass native arguments after `--`, such as `switcher launch coding -- exec "Reply with exactly: connected"`. `--backend direct` is the default; the optional `--backend ori` is OpenRouter-only and accepts `--ori-executable PATH`, while `--executable` remains the direct adapter option. `--cwd`, `--state-dir`, and `--timeout SECONDS` are local launcher options. Native approval and sandbox settings remain in effect. See [the Ori backend contract](docs/ori-backend-integration.md) for its supported target and catalog boundaries.

When the API runs remotely, inject the provider credential into the API process for authenticated catalog discovery and into the local launcher for direct inference. The API never returns a provider key. An external compatible gateway can be the configured provider. Switcher does not translate between wire protocols.

## Optional Ori backend

`switcher launch codex --provider openrouter --model MODEL --backend ori` uses installed Ori 0.12.x. Add `--ori-executable PATH` to choose its installation. `--dry-run` validates the Ori contract without resolving a launch credential. The Codex picker uses Switcher's complete compatible catalog. Grok is supported through Ori's Chat route and its entitled OpenRouter catalog. Direct adapters remain the default. Ori launches reject other provider authorities, Claude's global-configuration mutations, and the legacy OpenCode target; use the direct Claude and OpenCode 2 adapters. Ori live acceptance remains tracked separately from fixture checks.

## Models and native pickers

| Harness | Required wire protocol | Native catalog |
| --- | --- | --- |
| Claude Code ≥2.1.242 | Anthropic Messages | Per-launch `modelPicker` on compatible Claude versions |
| Codex ≥0.153.0 | OpenAI Responses | Startup `model_catalog_json` |
| Grok Build ≥1.0.13 | Chat Completions, Responses or Messages | Authenticated loopback remote catalog with upstream model IDs |
| OpenCode 2 (tested beta-19157) | Chat Completions, Responses or Messages | Version 2 provider/model configuration and standalone server |

The CLI catalog includes all provider output modalities. Native coding pickers exclude unavailable models and those explicitly lacking text output or tool support; unknown metadata remains unknown. This is a capability filter, not a guarantee of successful tool use. Catalog refresh happens before every launch. Native pickers are startup snapshots, not promised live reloads. OpenCode requires a complete capability object; missing fields use text-only/tool-enabled native defaults with a warning. Its beta `models --standalone` command may return an early empty snapshot; the native `/api/model` API and interactive picker expose the settled catalog.

The Claude adapter sets `ANTHROPIC_DEFAULT_MODEL` and the default subagent model to the selected provider model. Explicit subagent definitions and managed model restrictions still apply. These follow the [native model precedence rules](https://code.claude.com/docs/en/model-config).

Claude Code with a non-Claude model is experimental and unsupported by Anthropic. Codex requires Responses, not Chat Completions. Upstream reasoning, tool schemas, context limits and stateless Responses behavior still need provider-specific validation. Switcher never silently falls back to a different provider.

For a provider without discovery, use `providers add ID --file provider.json` with `manualModels`. Each model needs `id` and `name`; optional fields are `contextWindow`, `maxOutputTokens`, `inputModalities`, `outputModalities`, `supportedParameters`, and `available`. Use `catalogBaseUrl` and `modelsPath` for a separate discovery root/path; CLI equivalents are `--catalog-url` and `--models-path`. Use `catalogFormat: "ollama"` for `/api/tags`. Mistral presets select a capability-aware parser, including archived status. Together presets select its native bare-array parser. Fireworks requires `--catalog-account-id ID` or an explicit catalog URL and retains count evidence across its paginated account catalog. DashScope requires an explicit region/workspace `--catalog-url` with `--catalog-format dashscope`. Z.AI currently requires an explicit catalog or manual models because its documented API has no model-list contract. MiniMax defaults to its `.cn` Open Platform endpoints; use an explicit authority and credential reference for another product or region. A different authenticated catalog origin requires an explicit `catalogCredentialEnv`; a public catalog can declare `catalogAuthStyle: "none"`. Standard credential aliases are resolved only for the matching built-in provider origin. The default parser follows Anthropic-style `has_more/last_id` pagination and otherwise expects an OpenAI-style `data` array. HTTP redirects are rejected.

Grok uses a per-launch authenticated loopback bridge because its environment overlay cannot define providers. The bridge serves model metadata and forwards the selected protocol unchanged. It holds upstream credentials only in memory; Grok receives an ephemeral local token. The same bridge handles credentialless endpoints and OpenCode auth-header mismatches. Bridged requests are limited to 4 MiB and four minutes. Grok resumes retain the selected profile model. Use `-- --resume SESSION_ID -p PROMPT` for headless continuation, or omit the prompt and type after the interactive session loads. Interactive resume with an inline positional prompt is rejected because the native client can send it before applying the selected model. Grok 1.0.13 passed source and installed development CLI resume checks against a controlled Messages fixture and live DeepSeek Flash. OpenCode's provider identity stays stable across temporary bridge ports; `-- run --session SESSION_ID PROMPT` resumes with fresh launch settings. The installed beta-19157 passed two-process Messages resume checks against a controlled local upstream and live DeepSeek Flash, including a proof-file read and preserved history. Other provider/protocol and registry-release cells remain tracked separately in COMPATIBILITY.md.

Native history and credentials stay with the harness. Resume only with the same profile/provider/model configuration unless the harness explicitly supports a change; cross-provider reasoning/session migration is not provided. Temporary nonsecret picker/config files are removed when the child exits. Run records contain launch/end metadata and initial model, not transcripts or a claim about later native picker selections.

## SDK and API

```ts
import { SwitcherClient } from "@hasna/switcher/sdk";
const client = new SwitcherClient({
  baseUrl: "http://127.0.0.1:8080",
  apiKey: () => process.env.HASNA_SWITCHER_API_KEY!,
});
const profiles = await client.listProfiles();
const plan = await client.launchPlan(profiles.data[0].id);
console.log(plan.catalog.models.length);
```

The SDK supports Node and Bun. It has no database or launcher imports. Explicit credentials may be supplied as a string or a fresh resolver function; `clientFromEnv()` uses the shared contracts resolver with environment-only inputs and no disk fallback.

Public lifecycle endpoints: `GET /health`, `/ready`, `/version`. Authenticated OpenAPI: `GET /v1/openapi.json`. Provider/profile CRUD, `/v1/provider-presets`, catalog list/refresh, launch-plan validation and run metadata are under `/v1`. The SDK includes `listProviderPresets()`, `getProviderPreset()`, `health()`, `ready()`, and `version()`. SDK types are generated from that OpenAPI document. API errors include code, message and request ID.

All mutations require `Idempotency-Key`. Reuse the same key and payload after an uncertain response; changing the payload returns 409. Updates/deletes also require the numeric record version in `If-Match`. SDK methods supply these headers and accept a caller-provided idempotency key. Run creation requires the `planToken` from a launch plan; a changed provider, profile or catalog rejects the stale plan with 409 before local execution. List endpoints accept `limit` (1–1000), `offset` and `search`. Referenced providers/profiles cannot be deleted while children exist.

`switcher-mcp` exposes provider/profile management, catalogs, launch plans and run reads using standard MCP stdio. It does not remotely execute native harnesses. Fleet coding agents should use the CLI instead of registering this MCP server.

## Development

```sh
bun install
bun run generate
bun run verify
# Inject a disposable database URL:
bun run test:postgres
```

Tests create a unique PostgreSQL schema and remove only that schema. Test scratch defaults to `~/Workspace/scratch/switcher-tests`; override `SWITCHER_TEST_ROOT` for CI. `bun run check:generated` detects OpenAPI/type drift. Publication uses npm with the repository release gates.
