---
id: "switcher-changelog"
title: "Switcher changelog"
type: "release-notes"
owner: "codex-fixer"
created_at: "2026-09-05T12:54:59Z"
updated_at: "2026-09-06T12:44:02.606710+00:00"
status: "active"
source_task: "01a07181-ca8d-70c1-99a2-b276dc5770f3"
---

## Unreleased

- Add the official DeepSeek Harness (`dsh`) with its native browser UI, headless task and ACP profiles, all three wire protocols, isolated provider catalog and persistent sessions/attachments. Reject SDK/custom profiles and Ori's setup-only command as launch paths.
- Add OMP with a native provider catalog and persistent per-profile sessions.

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
