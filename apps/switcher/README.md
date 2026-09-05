---
id: "switcher-readme"
title: "Switcher"
type: "package-documentation"
owner: "codex-fixer"
created_at: "2026-09-05T12:50:21.698672Z"
updated_at: "2026-09-05T13:39:04.576066+00:00"
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

## Start the service

Inject a random operator token of at least 24 characters as `HASNA_SWITCHER_API_KEY` through your secret manager. Inject provider credentials separately, using names beginning `SWITCHER_PROVIDER_`. Only environment references are persisted.

```sh
# SQLite: one service process, persistent database.
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

The model ID is an example; choose an exact ID from the current catalog and verify account access. Use `--url https://provider.example/api/v1` instead of the preset for any compatible endpoint. The base URL includes the provider API version/path; discovery appends `/models`. Select a separate provider profile for each wire protocol. The launch adapters normalize native endpoint conventions.

For Claude use `--harness claude` with `anthropic-messages`; for Grok or OpenCode 2 use their supported protocol. Pass native arguments after `--`, such as `switcher launch coding -- exec "Reply with exactly: connected"`. `--cwd`, `--executable`, `--state-dir`, and `--timeout SECONDS` are local launcher options. Native approval and sandbox settings remain in effect.

When the API runs remotely, inject the provider credential into the API process for authenticated catalog discovery and into the local launcher for direct inference. The API never returns a provider key. An external compatible gateway can be the configured provider. Switcher does not translate between wire protocols.

## Models and native pickers

| Harness | Required wire protocol | Native catalog |
| --- | --- | --- |
| Claude Code ≥2.1.242 | Anthropic Messages | Per-launch `modelPicker` on compatible Claude versions |
| Codex ≥0.153.0 | OpenAI Responses | Startup `model_catalog_json` |
| Grok Build ≥1.0.13 | Chat Completions, Responses or Messages | Authenticated loopback remote catalog with upstream model IDs |
| OpenCode 2 (tested beta-18999) | Chat Completions, Responses or Messages | Version 2 provider/model configuration and standalone server |

The CLI catalog includes all provider output modalities. Native coding pickers exclude models explicitly lacking text output or tool support; unknown metadata remains unknown. This is a capability filter, not a guarantee of successful tool use. Catalog refresh happens before every launch. Native pickers are startup snapshots, not promised live reloads. OpenCode requires a complete capability object; missing fields use text-only/tool-enabled native defaults with a warning. Its beta `models --standalone` command may return an early empty snapshot; the native `/api/model` API and interactive picker expose the settled catalog.

Claude Code with a non-Claude model is experimental and unsupported by Anthropic. Codex requires Responses, not Chat Completions. Upstream reasoning, tool schemas, context limits and stateless Responses behavior still need provider-specific validation. Switcher never silently falls back to a different provider.

For a provider without discovery, use `providers add ID --file provider.json` with `manualModels`. Each model needs `id` and `name`; optional fields are `contextWindow`, `maxOutputTokens`, `inputModalities`, `outputModalities`, and `supportedParameters`. Use `modelsPath` for a different relative discovery path. Discovery follows Anthropic-style `has_more/last_id` pagination and otherwise expects an OpenAI-style `data` array. HTTP redirects are rejected.

Grok uses a per-launch authenticated loopback bridge because its environment overlay cannot define providers. The bridge serves model metadata and forwards the selected protocol unchanged. It holds upstream credentials only in memory; Grok receives an ephemeral local token. The same bridge handles credentialless endpoints and OpenCode auth-header mismatches. Bridged requests are limited to 4 MiB and four minutes. Grok resume, and OpenCode resume when an auth bridge is needed, are rejected in this release because the bridge endpoint is temporary.

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

Public lifecycle endpoints: `GET /health`, `/ready`, `/version`. Authenticated OpenAPI: `GET /v1/openapi.json`. Provider/profile CRUD, catalog list/refresh, launch-plan validation and run metadata are under `/v1`. SDK types are generated from that OpenAPI document. API errors include code, message and request ID.

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
