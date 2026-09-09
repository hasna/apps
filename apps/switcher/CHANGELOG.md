---
id: "switcher-changelog"
title: "Switcher changelog"
type: "release-notes"
owner: "codex-fixer"
created_at: "2026-09-05T12:54:59Z"
updated_at: "2026-09-09T18:20:24Z"
status: "active"
source_task: "01a07181-ca8d-70c1-99a2-b276dc5770f3"
---

## 0.1.7

### Patch Changes

- Replace the four-minute total provider-response deadline with a four-minute inactivity watchdog across all inference bridges. Keepalive bytes and streamed content allow long responses to finish, while idle headers or streams return a distinct sanitized timeout. Preserve caller cancellation, terminal completion and downstream backpressure without replaying partial responses.
- Prevent a provider that never acknowledges stream cancellation from blocking local error handling or bridge cleanup.

## 0.1.6

### Patch Changes

- Default Claude Code launches using the official DeepSeek Messages endpoint to the documented compaction window while preserving explicit environment values. Recognize bounded provider context-overflow errors and return a sanitized native recovery message without exposing provider error text or retrying another model.
- Add optional inclusive UTC expiry dates and additive provider models with `models add`. DeepSeek presets include the V4.1 Flash preview through September 10, 2026. Expired models remain listed for reference while launches, native selection and gateway requests reject them.

## 0.1.5

### Patch Changes

- Finish completed provider SSE responses cleanly and distinguish native client cancellation from actual upstream stream failure.

## 0.1.4
### Patch Changes

- Resolve API and vault operator credentials through the canonical Contracts chain; honor config/credentials, Keychain, URL defaults and rotation without manual process injection while retaining explicit account boundaries.

## 0.1.3
### Patch Changes

- Inject model guidance automatically into managed inference requests, enforce profile model allowlists and explicit transient fallbacks, pin native child/utility model roles, and persist bounded routing evidence. Guard Ori's native launch paths and reject older launchers without model-policy support.

## 0.1.2

### Patch Changes

- Sanitize remote API error diagnostics before SDK or CLI output, validating bounded fields and redacting common representations of the operator credential sent with the request.

- Add built-in OMP, DeepSeek Harness, Cline, Hermes, Prime Agent, legacy OpenCode, Kilo, Gemini CLI and Aider adapters with provider catalogs, native model selection and persistent sessions. Preserve each supported native permission and instruction contract with validation before provider discovery or credential resolution.

  Add Gemini generateContent and OpenAI-compatible provider routes, plus Azure v1 Chat/Responses with literal api-key authentication and explicit deployment inventories. Correct signal exit codes and Prime socket-path fallback; retain parent-held credentials for adapters that require scoped bridges.

## 0.1.1

### Patch Changes

- Launch a named harness/provider directly with a managed authenticated local API or explicitly configured remote API. Discover the provider catalog, choose a model and reuse the launch profile.
- Resolve origin-scoped Keychain or vault credential bindings through the installed CLI without storing key values. Separate inference and catalog endpoints, including DeepSeek.
- Preserve native terminal input, resize, redirected descriptors and exit codes; stop owned POSIX tool processes on exit and cancellation. Correct Grok and OpenCode 2 session continuation across fresh bridge ports.
- Add Pi with an isolated native catalog, provider-scoped picker and persistent sessions; preserve nested model IDs and reject ambiguous case collisions. Add optional Ori launching for the verified OpenRouter Codex/Grok subset.
- Expand documented provider presets and explicit vLLM/LiteLLM gateways, including account/regional discovery and custom deployment prefixes.
- Cancel unfinished upstream streams before closing launch bridges, so a completed OpenCode 2 response cannot leave the CLI waiting during cleanup.
- Isolate OpenCode 2 provider settings from project/global and per-model overrides while preserving validated native permissions, agent prompts, ancestor instructions and durable sessions. Reject remote configuration registrations that could reintroduce provider settings.
- Align the exact `@hasna/contracts` pin with the 1.0.2 optional Secrets peer release.

# 0.1.0

Initial release: authenticated provider/profile/catalog API, HTTP CLI and SDK, SQLite and PostgreSQL service storage, and local adapters for Claude Code, Codex, Grok Build and OpenCode 2.

The initial minor changeset was applied from 0.0.0 with the Changesets CLI in an isolated release preparation directory, without applying unrelated pending monorepo changesets.
