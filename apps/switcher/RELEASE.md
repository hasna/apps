---
id: "switcher-release-0-1-0"
title: "Switcher 0.1.0 verification and release evidence"
type: "release-report"
owner: "codex-fixer"
created_at: "2026-09-05T13:26:26.273004+00:00"
updated_at: "2026-09-05T15:00:05.316596+00:00"
status: "released"
source_task: "01a07181-ca8d-70c1-99a2-b276dc5770f3"
---

# Scope and provenance

Initial public `@hasna/switcher` release. Tracking task: `e0be8c8c-9588-4b7b-9996-382f113736e3`. Parent-owned worktree: `~/Workspace/scratch/universal-harness-switcher/worktrees/implementation`; branch `codex/fixer/2026-09-05-universal-harness-switcher`; fetched base `c6a9fcf5a4825a9e49bab7b3ae688040726fcd61`. Canonical checkout changes were preserved.

The changeset parser contract permits only package/bump pairs in front matter. Required artifact metadata for `.changeset/switcher-initial-release.md` is carried by this release report; the entry records the already-applied initial version with a `none` bump. A hermetic per-package `bun.lock` is included.

Canonical directives are under `~/Workspace/scratch/universal-harness-switcher/directives/`, including `2026-09-05-01a07181-build-ship-switcher.md`. Research helpers investigated todos, Ori, GitHub alternatives and native harness configuration. The parent implemented the package. Two independent read-only reviewers approved implementation commit `4a2a5d6755fe530b22f703c701f6664299cf5109`; packaging metadata commit `9f836605a58c57605d5a7adab968cf7563ec407a` was also independently approved.

# Verified before publication

- Bun 1.3.14: `15 pass`, `0 fail`, `119 expect() calls` with the same behavioral suite exercising SQLite and real PostgreSQL. Tests cover durable idempotency, stale launch plans, optimistic concurrency, profile updates, rollback, persistence, API auth, paging, redirects, model provenance, concurrent launcher isolation, timeouts, exit codes, bridge streaming and credential isolation.
- Generated OpenAPI/type drift, typecheck, build and app contract checks passed. Model-list schemas now include catalog provenance and coding eligibility. Packed-artifact scanning passed, including npm's inherited dry-run regression.
- Root affected build: `43 successful, 43 total`; explicit Turbo switcher build also passed. Root names, dependency direction, staged secrets, manifests, packed publish guard and deployment lanes passed. The final standard suite passed `145 pass`, `0 fail`, `554 expect() calls`, after retrying a transient latest-validator startup failure in three existing packages. Frozen locks passed. The optional reporting lane ran without a fleet CLI on its isolated PATH, avoiding unprefixed fleet calls. No global gate was weakened.
- An isolated npm install of the packed artifact imported its SDK on Node, exercised SQLite HTTP through the SDK, launched CLI/server bins, and completed MCP initialization and tool listing. No Hasna MCP server was registered in an agent.
- Docker Compose YAML parsed successfully with SQLite/PostgreSQL profiles and persistent volumes. Native service startup and HTTP operations were tested on both databases. This station has no Docker engine; container image execution is not claimed.

# Native harness verification

All four harnesses also completed a read-only tool loop against a random temporary proof file; each returned its actual contents.

All live prompts ran in task-owned ephemeral tmux sessions with protected runtime credential injection. Initial prompts requested a fixed reply without tools; subsequent acceptance prompts required reading a random proof file without changing files. The selected provider was OpenRouter. Live success means bounded inference and the tested read-only tool loop, not validation of every catalog model or every agentic tool feature.

| Harness | Native version | Verified behavior |
| --- | --- | --- |
| Claude Code | 2.1.261 | Live Anthropic Messages inference using `anthropic/claude-haiku-4.5`; native `/model` displayed the generated catalog and accepted a session-only selection. |
| Codex | 0.153.4 | Live Responses inference using Haiku 4.5; app-server `model/list` returned all 364 coding-eligible snapshot models and the selected ID. |
| Grok Build | 1.0.13 (5e9a58528b76) | Official isolated binary; native catalog and live Chat inference with Haiku 4.5. A PostgreSQL-backed second run reported `openai/gpt-4.1-mini` in native model usage, verifying a changed upstream model. |
| OpenCode 2 | v0.0.0-beta-18999 | Live Chat inference using Haiku 4.5; settled native `/api/model` returned all 364 snapshot models. Controlled 401 probes verified exact model, auth and native Chat/Responses/Messages routes without fallback. |

OpenCode's native capability schema requires a complete object; partial capabilities silently discard a provider. Switcher supplies explicitly warned native defaults for unknown fields. The installed beta's `models --standalone` can return an early empty snapshot. The installed beta also lacks newer `anthropic-compatible` and `openai-compatible/responses` package routes documented upstream; verified `anthropic` and `openai/responses` runtimes are used with the configured base URL. Grok requires an authenticated catalog/API-key loopback bridge, and its resume is explicitly unsupported in this release.

Detailed sanitized evidence is under `~/Workspace/scratch/universal-harness-switcher/`: `all-engine-tests-final.log`, `live/source-01`, `live/grok-02`, `live/postgres-01`, `live/opencode-02`, `live/tools-01`, `live/catalog-01`, `live/claude-picker-01`, `live/opencode-catalog-08`, route probes, and `packed/smoke/result.json`. Failed probes are retained as diagnostic history and are not counted as acceptance passes. A disposable OpenCode loopback server password appeared in one diagnostic output after that server had stopped; its log was redacted and the event recorded in the required incident channel. Provider and fleet credentials were not exposed.

# Shipped release

- PR [#1797](https://github.com/hasna/apps/pull/1797) merged at `2026-09-05T14:49:33Z` as `b117b6bd95c1d374dec97ebe840dfef083025834`. Required checks passed in [CI run 33969903483](https://github.com/hasna/apps/actions/runs/33969903483): affected build `43 successful, 43 total`; affected test graph `88 successful, 88 total`; gates, versioning/standard, generated artifacts and publish guard passed.
- CI's missing package lock/changeset findings were fixed before merge. Local versioning passed `22 pass`, `1 skip` (opt-in npm parity), `0 fail`, `481 expect() calls`. An unrelated emails PostgreSQL setup timeout passed on retry. Two existing Mementos CLI assertions failed in one CI attempt and passed on retry without code changes; the targeted local reproduction passed 30 tests. A broader macOS diagnostic had unrelated platform/fixture failures and is not counted as a passing suite.
- Negative control returned E404 at `2026-09-05T14:50:03.590625Z`. Public [`@hasna/switcher@0.1.0`](https://www.npmjs.com/package/@hasna/switcher/v/0.1.0) was published with npm from the merged package directory at `2026-09-05T14:50:10.495Z`. Intent and verification were recorded in the required publishing thread and tracking task. Registry visibility lagged the accepted write briefly; publication was not repeated.
- Public tarball: 43,876 bytes, 26 members; SHA-1 `8a17d12f7dbf5d6ddb391dd78aec757aa38d32ed`; integrity `sha512-qi9Mkbjf0FojmraviCCgeW5Jj3l06N4Wq4RCRkjKo9cXiaBjEGwbtcvy4mjRrEXX0F5l/eJBZu3DM45tELZiQQ==`. Downloaded bytes and npm lock integrity matched. The registry does not expose a `gitHead` for this version; all 19 installed built files matched the reviewed source SHA-256 manifest.
- Installed the exact named registry version in an isolated scratch directory without changing global quarantine settings. Node imported the published SDK, exercised SQLite HTTP, launched CLI/server bins, and completed standalone MCP initialization with all 15 tools. No Hasna MCP server was registered in an agent.

# Exact registry live acceptance

The registry-installed CLI launched each native harness through the registry-installed API and SDK. Every required launch exited 0 and returned the exact contents of a random proof file using a read-only tool. Each discovery returned 582 all-modality OpenRouter entries; native coding catalogs use the compatible subset, with the source adapter catalog checks and identical installed-file hashes establishing the catalog implementation shipped.

| Database | Harness | Model | Result |
| --- | --- | --- | --- |
| SQLite | Claude Code 2.1.261 | `anthropic/claude-haiku-4.5` | Exit 0; proof-file tool loop passed. |
| SQLite | Codex 0.153.4 | `anthropic/claude-haiku-4.5` | Exit 0; proof-file tool loop passed. |
| SQLite | Grok Build 1.0.13 | `anthropic/claude-haiku-4.5` | Exit 0; proof-file tool loop passed. |
| SQLite | OpenCode 2 beta-18999 | `anthropic/claude-haiku-4.5` | Exit 0; proof-file tool loop passed. |
| PostgreSQL | Grok Build 1.0.13 | `openai/gpt-4.1-mini` | Exit 0; proof-file tool loop passed; native `modelUsage` confirms the changed model. |

Evidence under the scratch root: `npm-registry.json`, `npm-publish.log`, `registry/integrity.json`, `registry/acceptance.json`, `registry/cleanup.json`, `registry/smoke-result/result.json`, `live/registry-tools-01`, and `live/registry-postgres-01`. Run metadata and sanitized native output are retained.

All task-owned live tmux sessions ended and the disposable PostgreSQL cluster stopped. One Grok launch left a credential-free model overlay after native exit; it was removed explicitly. Thirty controlled subprocess repetitions and two further real Grok tool loops (`registry-grok-cleanup-02` and `03`) cleaned normally. The root cause is unconfirmed; cleanup ordering is tracked for hardening rather than described as fully resolved.

# Remaining limitations and follow-ups

- Docker manifests passed static validation; no Docker engine was available for image execution.
- Native compatibility is tied to the tested versions and routes above. Non-Claude models in Claude Code remain experimental; Grok resume and bridged OpenCode resume are rejected explicitly. Full catalog visibility does not prove every model supports a coding tool loop.
- npm installs a deprecated transitive `@hasna/paths@0.1.0` through contracts' non-optional secrets peer. Switcher's explicit environment credential path does not load that secrets SDK chain. An upstream optional-peer/core-resolver fix is tracked; no private credentials or legacy app configuration are installed.
- Optional Ori integration, additional harnesses, protocol translation and remote workers remain deferred product scope. Required first-release build, merge, publication and live acceptance are complete.
