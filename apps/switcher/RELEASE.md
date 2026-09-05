---
id: "switcher-release-0-1-0"
title: "Switcher 0.1.0 verification and release evidence"
type: "release-report"
owner: "codex-fixer"
created_at: "2026-09-05T13:26:26.273004+00:00"
updated_at: "2026-09-05T13:45:41.012524+00:00"
status: "verification"
source_task: "01a07181-ca8d-70c1-99a2-b276dc5770f3"
---

# Scope and provenance

Initial public `@hasna/switcher` release. Tracking task: `e0be8c8c-9588-4b7b-9996-382f113736e3`. Parent-owned worktree: `~/Workspace/scratch/universal-harness-switcher/worktrees/implementation`; branch `codex/fixer/2026-09-05-universal-harness-switcher`; fetched base `c6a9fcf5a4825a9e49bab7b3ae688040726fcd61`. Canonical checkout changes were preserved.

The changeset parser contract permits only package/bump pairs in front matter. Required artifact metadata for `.changeset/switcher-initial-release.md` is carried by this release report; the entry records the already-applied initial version with a `none` bump. A hermetic per-package `bun.lock` is included.

Canonical directives are under `~/Workspace/scratch/universal-harness-switcher/directives/`, including `2026-09-05-01a07181-build-ship-switcher.md`. Research helpers investigated todos, Ori, GitHub alternatives and native harness configuration. The parent implemented the package. Read-only helpers reviewed the service/store and packaging contracts; exact-commit review is a separate release gate.

# Verified before publication

- Bun 1.3.14: `15 pass`, `0 fail`, `119 expect() calls` with the same behavioral suite exercising SQLite and real PostgreSQL. Tests cover durable idempotency, stale launch plans, optimistic concurrency, profile updates, rollback, persistence, API auth, paging, redirects, model provenance, concurrent launcher isolation, timeouts, exit codes, bridge streaming and credential isolation.
- Generated OpenAPI/type drift, typecheck, build and app contract checks passed. Model-list schemas now include catalog provenance and coding eligibility. Packed-artifact scanning passed, including npm's inherited dry-run regression.
- Root affected build: `43 successful, 43 total`; explicit Turbo switcher build also passed. Root names, dependency direction, staged secrets, manifests, packed publish guard and deployment lanes passed. The final standard suite passed `145 pass`, `0 fail`, `554 expect() calls`, after retrying a transient latest-validator startup failure in three existing packages. Frozen locks passed. The optional reporting lane ran without a fleet CLI on its isolated PATH, avoiding unprefixed fleet calls. No global gate was weakened.
- An isolated npm install of the packed artifact imported its SDK on Node, exercised SQLite HTTP through the SDK, launched CLI/server bins, and completed MCP initialization and tool listing. No Hasna MCP server was registered in an agent.
- Docker Compose YAML parsed successfully with SQLite/PostgreSQL profiles and persistent volumes. Native service startup and HTTP operations were tested on both databases. This station has no Docker engine; container image execution is not claimed.

# Native harness verification

All four harnesses also completed a read-only tool loop against a random temporary proof file; each returned its actual contents.

All live prompts ran in task-owned ephemeral tmux sessions with protected runtime credential injection. Prompts requested a fixed reply and no tools or file changes. The selected provider was OpenRouter. Live success means bounded inference, not validation of every catalog model or every agentic tool feature.

| Harness | Native version | Verified behavior |
| --- | --- | --- |
| Claude Code | 2.1.261 | Live Anthropic Messages inference using `anthropic/claude-haiku-4.5`; native `/model` displayed the generated catalog and accepted a session-only selection. |
| Codex | 0.153.4 | Live Responses inference using Haiku 4.5; app-server `model/list` returned all 364 coding-eligible snapshot models and the selected ID. |
| Grok Build | 1.0.13 (5e9a58528b76) | Official isolated binary; native catalog and live Chat inference with Haiku 4.5. A PostgreSQL-backed second run reported `openai/gpt-4.1-mini` in native model usage, verifying a changed upstream model. |
| OpenCode 2 | v0.0.0-beta-18999 | Live Chat inference using Haiku 4.5; settled native `/api/model` returned all 364 snapshot models. Controlled 401 probes verified exact model, auth and native Chat/Responses/Messages routes without fallback. |

OpenCode's native capability schema requires a complete object; partial capabilities silently discard a provider. Switcher supplies explicitly warned native defaults for unknown fields. The installed beta's `models --standalone` can return an early empty snapshot. The installed beta also lacks newer `anthropic-compatible` and `openai-compatible/responses` package routes documented upstream; verified `anthropic` and `openai/responses` runtimes are used with the configured base URL. Grok requires an authenticated catalog/API-key loopback bridge, and its resume is explicitly unsupported in this release.

Detailed sanitized evidence is under `~/Workspace/scratch/universal-harness-switcher/`: `all-engine-tests-final.log`, `live/source-01`, `live/grok-02`, `live/postgres-01`, `live/opencode-02`, `live/tools-01`, `live/catalog-01`, `live/claude-picker-01`, `live/opencode-catalog-08`, route probes, and `packed/smoke/result.json`. Failed probes are retained as diagnostic history and are not counted as acceptance passes. A disposable OpenCode loopback server password appeared in one diagnostic output after that server had stopped; its log was redacted and the event recorded in the required incident channel. Provider and fleet credentials were not exposed.

# Release gates remaining

- Exact implementation commit `4a2a5d6755fe530b22f703c701f6664299cf5109` was independently approved by two reviewers; release metadata follow-up was independently reviewed with no blockers.
- PR [#1797](https://github.com/hasna/apps/pull/1797) is open; required CI and merge remain. CI identified a missing per-package lockfile and committed changeset record. Both were corrected; local versioning now passes `22 pass`, `1 skip` (opt-in npm parity), `0 fail`, `481 expect() calls`. The unrelated emails PostgreSQL setup timeout passed on retry.
- Version negative control, required publication notice, npm publish and registry timestamp/integrity verification.
- Exact registry-artifact install and repeated live acceptance in ephemeral tmux.
- Final commit/PR/version/outcomes below and task/goal completion.

No npm publication is claimed by this pre-release report. Final packed-artifact entrypoint/SDK/MCP smoke passed after reinstalling the tarball with registry dependencies.
