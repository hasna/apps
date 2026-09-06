---
id: "switcher-plan"
title: "Switcher implementation and release plan"
type: "implementation-plan"
owner: "codex-fixer"
created_at: "2026-09-05T12:35:04.768Z"
updated_at: "2026-09-06T11:27:05.462563+00:00"
status: "active"
source_task: "01a07181-ca8d-70c1-99a2-b276dc5770f3"
---

# Current delivery: complete built-in adapters and installed CLI

The 2026-09-05 DeepSeek test demonstrated that 0.1.0 needed an external API supervisor, an explicit provider/profile setup, and a manual model-catalog import. A successful OpenRouter release test did not prove the fresh-install DeepSeek experience. The user has authorized completing the missing adapters, shipping them, and testing the installed command live.

The active specification is the A–K checklist in [TODOS.md](TODOS.md). Its historical 0.1.0 section records earlier evidence only. The new goal remains active until the required adapter matrix and release acceptance are complete.

Publication is currently held on a reproduced OpenCode 2 credential-routing defect: native project or per-model configuration can redirect the selected provider credential. The previous 0.1.1 archive is withdrawn. Correction `0574a1c` now has independent native approval for all three API protocols, preserved deny rules/instructions, full native catalog and fresh same-session resume. Combined package/root checks and replacement-archive native/container acceptance pass. Exact-head CI, merge, publication and registry-installed repetition remain required. Additional adapter regressions and exact candidate states are tracked as R01–R06 in TODOS.md.

Delivery order:

1. Fix the DeepSeek catalog/inference split, provider registry, direct launch syntax, and automatic authenticated local API lifecycle.
2. Complete secure credential resolution, native catalogs/settings, cleanup and resume for Claude Code, Codex, Grok and OpenCode 2.
3. Complete the audited provider/gateway and Ori adapters, with explicit native versus translated protocol contracts and no implicit provider substitution.
4. Verify API/SDK migrations, real SQLite/PostgreSQL concurrency, Docker execution, the documented installed-CLI flow, and all applicable live provider/harness cells.
5. Open the reviewed release PR and publish the exact Contracts 1.0.2 dependency candidate within that wave so registry-dependent gates can run normally. Pass all required gates and CI before merging, then publish Switcher and repeat the matrix using the registry-installed command.

The target direct form is `switcher launch claude --provider deepseek --model deepseek-v4-pro`; the source CLI implements this form. Split-catalog subprocess tests pass, and an independently installed development tarball completed live DeepSeek Pro/Flash proof-file tool loops and native picker selection without an API supervisor or catalog import. The built-in vault/Keychain resolver now passes subprocess coverage and installed-development-CLI live acceptance: DeepSeek Pro/Flash proof-file tool loops, all three native picker models, and the corrected Default mapping. The remaining adapter matrix and registry-installed release acceptance are still pending. Provider credentials may be supplied through a supported runtime or secure-store reference, but no outside launch supervisor or manual catalog JSON should be required for a built-in provider. An explicit remote API must never silently fall back to a local database.

The current source passes 85 tests / 769 assertions with real SQLite/PostgreSQL and installed Pi/Ori checks enabled. A live OpenCode 2 cleanup hang was reproduced and fixed by closing unfinished forwarding streams before bridge shutdown; installed-candidate retesting passed before the separate routing defect was discovered. Reviewed source includes the installed-CLI setup and credential flow, process-group/terminal ownership, optional Ori integration, and the expanded provider/gateway registry. A fresh npm-installed candidate passed Claude + DeepSeek Flash tool use and Codex + OpenRouter tool use/resume through both direct and Ori backends in ephemeral tmux. Candidate bytes predate the final review corrections, so registry-byte repetition remains mandatory. Contracts 1.0.2 is published and independently verified from npm. Its exact candidate bytes and six dependent locks match. The registry-backed dependency gate and normal Skills consumer check now pass. PR #1810 is open and mergeable; CI runs before merge. See [TODOS.md](TODOS.md) for hashes, evidence and the remaining finite adapter matrix.

Both Docker Compose storage profiles passed health/authentication and recreation persistence in an isolated task VM. Upgrades from published 0.1.0 preserve all four data record kinds in SQLite and PostgreSQL. The historical candidate image passed upgrade/rollback acceptance; the replacement archive requires fresh image verification. Pi's corrected three-protocol adapter is integrated and undergoing combined review and verification; the remaining named harness/cloud adapters stay in scope.

The user-owned live session `switcher-deepseek` is preserved. New acceptance sessions use separate task-owned paths, sockets, ports and databases. New worktree: `~/Workspace/scratch/universal-harness-switcher/worktrees/complete-adapters`; branch `codex/fixer/2026-09-05-switcher-complete-adapters`; fetched base `48f8c1d020d5138fa542461c19ff137d9ea69819`.

# Original product plan and 0.1.0 provenance

# Product and acceptance

Build and publish `@hasna/switcher`, an API-backed CLI and typed `./sdk` for launching existing coding harnesses with a chosen provider and model. Claude Code, Codex, Grok Build, and OpenCode 2 are required in the first release. Show the selected provider's model catalog in each harness's native picker where its supported interface permits it. Ship genuine SQLite and PostgreSQL server storage, self-hosting artifacts, meaningful automated tests and live release verification in ephemeral tmux sessions.

The user explicitly authorized implementation, shipping, publication and live testing on 2026-09-05. This extends the earlier research-only scope. `TODOS.md` is the execution checklist. Raw directives are retained in the task's Workspace scratch directive records; this plan records agent interpretation rather than extending authority.

## Research and decisions

Three research helpers inspected todos, official harness documentation and primary GitHub projects. Local inspection found Ori 0.12.1, Claude Code 2.1.261, Codex 0.153.4 and OpenCode 2. Grok was not on PATH. Ori's harness inventory recognized Claude/Codex but not the station's `opencode2` executable. Provide explicit executable paths and version-aware adapters.

The unauthenticated OpenRouter model endpoint returned 431 default text entries and 582 across all output modalities on 2026-09-05. These counts are observations, never constants or proof of account access. Catalog discovery and successful agentic execution are separate acceptance checks.

| Reference | Finding | Decision |
| --- | --- | --- |
| [Ori](https://openrouter.ai/docs/guides/ori/harness) | Launches many existing harnesses with OpenRouter settings and argument passthrough. Its documented full catalog integrations vary by harness. | Use as product reference and optional adapter; no mandatory runtime dependency. |
| [CC Switch](https://github.com/farion1231/cc-switch) | Desktop profiles, SQLite, config management and local proxy. | Reference for profile usability; own HTTP API and SDK. |
| [Claude Code Router](https://github.com/musistudio/claude-code-router) | Multi-agent gateway, custom endpoints, discovery and routing. | Reference and optional upstream gateway. |
| [CLIProxyAPI](https://github.com/router-for-me/CLIProxyAPI) | Multiple compatibility protocols and a management API. | Optional separately operated translation backend. |
| [LiteLLM](https://github.com/BerriAI/litellm) | Broad provider API and self-hosted gateway. | Supported as a compatible upstream; do not reimplement a universal translator in the first release. |
| todos | Four surfaces, storage adapter seam and OpenAPI-generated client; legacy client paths and nontransactional PostgreSQL behavior also exist. | Reuse architecture selectively, with one API and transactional storage. |
| workflows | Existing harness lane abstraction and single service layer. | Avoid creating a second workflow scheduler; switcher owns provider/configuration/catalog launching. |

Ori is already installed; no duplicate installation is needed. Its public source repository and stable launcher SDK were not verifiable during research. Use documented launch interfaces only. Consumer subscription credential pooling is outside this product's first release.

## API, client and process boundaries

- `switcher`: human and automation CLI. All application data access is authenticated HTTP.
- `switcher-serve`: authenticated HTTP API, domain service and selected database adapter.
- `@hasna/switcher/sdk`: typed HTTP client without a database or process-launch dependency.
- `switcher-mcp`: required public package surface using the same API; never register a Hasna MCP server in the station's coding-agent configuration.
- Local launcher: consumes a validated launch plan, resolves provider credentials in memory and starts the local harness with argv arrays and process-scoped configuration.
- Optional gateway: compatible remote/local upstream. Native protocol pass-through comes first; translation must be explicit and tested.

A remotely hosted API does not execute commands on a user's laptop. Launch stays local. Native sessions and history remain owned by their harnesses. The service stores run metadata, not copied session databases.

```mermaid
flowchart LR
    CLI[CLI] --> SDK[HTTP SDK]
    SDK --> API[Authenticated API]
    API --> DB[(SQLite or PostgreSQL)]
    API --> Plan[Profile and catalog snapshot]
    Plan --> Launcher[Local launcher]
    CLI --> Launcher
    Launcher --> Harness[Claude / Codex / Grok / OpenCode 2]
    Harness --> Provider[Compatible provider or gateway]
```

A launch plan includes a content fingerprint of the provider, profile and catalog. Run creation validates that fingerprint transactionally and records provider/profile revisions, preventing stale configuration from starting after a concurrent edit.

Initial resources: `/v1/providers`, `/v1/providers/:id/models`, `/v1/profiles`, `/v1/launch-plans`, `/v1/runs`; public health/version and bounded readiness endpoints; an OpenAPI document. Generate SDK operation/type bindings from the specification and verify drift.

## Providers and model catalogs

A provider records endpoint, wire protocol, credential reference and nonsecret options. Initial protocol identifiers: Anthropic Messages, OpenAI Responses and OpenAI Chat Completions. OpenRouter is a preset, not a required provider. Preserve custom URL path prefixes. Never equate the two OpenAI protocols.

Catalog entries retain exact upstream ID, display name, description, modalities, context/output limits, supported parameters, provenance and refresh timestamp. Support pagination, authenticated catalog access, cache freshness and explicit manual entries when an endpoint has no discovery. Retain unknown capabilities in the API catalog. When a native schema requires complete fields, declare conservative native assumptions and warn; do not present these defaults as provider evidence.

Show the complete provider catalog in switcher, with explicit eligibility/compatibility information. Generate the harness picker from permitted compatible entries and explain native limitations. Do not silently substitute provider/model, truncate lists or claim an image/embedding model can run a coding loop. Refresh snapshots at launch; live reload is promised only where the harness supports it.

Model selection inside the harness must affect the model sent upstream on subsequent requests. Any gateway session credential binds to the provider and allowed model set, not solely to the starting model. Separate credential authority, model discovery and execution compatibility.

## Required first-release harnesses

| Harness | Connection and launch | Catalog integration |
| --- | --- | --- |
| Claude Code | Anthropic Messages via supported base URL/auth/model environment and launch settings. Preserve permissions. | Explicit `modelPicker` launch settings on supported versions; discovery alone filters IDs and can expose only a curated subset. |
| Codex | Responses-compatible custom provider using per-launch config. Preserve user home, approvals and sandbox. | Version-compatible startup `model_catalog_json`, or proven native catalog discovery. Include correct limits/reasoning metadata. |
| Grok Build | Official 1.0.13 binary. A per-launch authenticated loopback bridge uses supported remote catalog and API-key probe endpoints; forwards Messages, Responses or Chat unchanged. Native home and policies are preserved. | Remote entries carry readable provider aliases, exact upstream model IDs and backend metadata; credentials stay out of the native catalog cache. Resume is rejected until bridge resume is supported. |
| OpenCode 2 | First-class `opencode2` executable and version-specific provider config; separate from legacy OpenCode. | Populate provider `models` configuration with exact IDs, limits and capabilities. Use private/standalone execution where necessary to avoid cross-session provider contamination. |

Native picker integration is not proof of tool use, streaming or context correctness. Anthropic explicitly does not support non-Claude models behind Claude Code gateways; report these combinations as experimental. Unknown/signed reasoning state must not be blindly replayed across providers. Preserve native resume where supported and reject unsupported resume combinations clearly.

Primary sources:
- [Claude model configuration](https://code.claude.com/docs/en/model-config)
- [Claude gateway discovery](https://code.claude.com/docs/en/llm-gateway-protocol#model-discovery)
- [Claude settings precedence](https://code.claude.com/docs/en/settings)
- [Claude gateway support boundary](https://code.claude.com/docs/en/llm-gateway)
- [Codex configuration](https://learn.chatgpt.com/docs/config-file/config-reference)
- [Codex advanced configuration](https://learn.chatgpt.com/docs/config-file/config-advanced)
- [Grok Build official source](https://github.com/xai-org/grok-build)
- [Grok Build changelog](https://x.ai/build/changelog)
- [OpenCode 2 providers](https://opencode.ai/v2/docs/providers)
- [OpenCode 2 models](https://opencode.ai/v2/docs/models)
- [Ori model catalog integration](https://openrouter.ai/docs/guides/ori/harness)
- [OpenRouter Claude integration](https://openrouter.ai/docs/cookbook/coding-agents/claude-code-integration)
- [OpenRouter Codex integration](https://openrouter.ai/blog/tutorials/codex-cli-openrouter/)
- [OpenRouter models API](https://openrouter.ai/docs/api/api-reference/models/list-all-models-and-their-properties)

## Storage and self-hosting

Use one domain store interface with actual SQLite and PostgreSQL implementations. Normalize providers, profiles, model snapshots and run metadata. Use parameterized SQL, transactions, optimistic concurrency as needed and migration versioning. SQLite is for one service instance with a persistent volume; PostgreSQL supports shared deployments. Run the same behavioral suite against both. Verify fresh startup, upgrade, rollback on failed transactions and restart persistence.

The existing canonical client contract assumes PostgreSQL server authority. The user's explicit SQLite requirement overrides that assumption for switcher. Document an app-scoped exception and keep all clients HTTP-only. Do not weaken global checks or silently revive local database fallbacks. Database credentials are server-only.

Supply a Dockerfile and SQLite/PostgreSQL compose profiles with persistence and health checks. Defaults bind to loopback unless explicitly configured for hosting. Select storage explicitly and fail startup on invalid/missing configuration.

## Credential and process handling

Store credential references only. On this fleet, resolve provider values through the approved secrets service and runtime injection; retain no plaintext copies. Public users may inject credentials through their supported process environment or secret manager. No values in argv, saved launch plans, JSON config, database rows, logs or source control.

Only forward required credentials to the selected harness. Validate remote API authority and provider destinations before attaching credentials; block redirects that could leak them. Use an allowlisted launcher command/config schema instead of arbitrary API-supplied shell execution. Redact diagnostic output and upstream auth errors. Keep transcripts disabled by default and preserve native permission behavior.

## Implementation sequence

1. Scaffold and record this plan; establish schemas, service API, SDK and dual storage.
2. Implement provider/catalog discovery and searchable selection.
3. Implement all four required launchers and native catalog adapters.
4. Verify direct provider and compatible gateway paths, model switching and credential isolation.
5. Build/package, independent exact-commit review, required repository checks and PR-first merge.
6. Publish the public npm release through the repository's vault-token/npmrc workflow.
7. Install the exact release in an isolated test location and verify API/SDK and all four real harnesses in ephemeral tmux sessions.
8. Record evidence, close completed checklist entries and retain any unfinished requirement explicitly.

## Verification and release

Automated tests must exercise real outcomes: API auth/error handling; CRUD and persistence for both databases; catalog pagination/metadata; SDK contract drift; invalid launch plans; argv/config generation; two simultaneous profiles; SSE and tool-call compatibility fixtures where proxying is implemented; model changes; signals and exit status; native settings preservation; credential redaction.

Live verification uses a task-owned tmux session and scratch directory, loopback service, temporary database and a minimal prompt. Record exact package/harness versions, provider and model, outcome, exit code, run IDs and sanitized evidence. Exercise each required harness through the built and then published switcher. Native picker visibility requires a direct UI or harness catalog verification in addition to inference success. Keep live prompts small and bounded; never expose credentials or disable harness protections. Stop only task-owned sessions/processes and retain useful evidence.

Run package typecheck/tests/build/contract checks and repository-required gates. Perform independent review against the exact implementation commit. Ship via branch and pull request; run staged secret scans before commits/pushes. Announce package/version in the required publishing channel, publish with npm from the package directory using protected token injection, verify registry version plus timestamp and test the exact registry artifact. Respect the global-install quarantine.

## Ownership and current state

- Owner: parent Codex task `01a07181-ca8d-70c1-99a2-b276dc5770f3`.
- Base commit: `c6a9fcf5a4825a9e49bab7b3ae688040726fcd61`.
- Branch: `codex/fixer/2026-09-05-universal-harness-switcher`.
- Implementation worktree: `~/Workspace/scratch/universal-harness-switcher/worktrees/implementation`.
- Existing canonical-checkout untracked files are preserved.
- Implementation shipped through [PR #1797](https://github.com/hasna/apps/pull/1797), merged as `b117b6bd95c1d374dec97ebe840dfef083025834`.
- Public [`@hasna/switcher@0.1.0`](https://www.npmjs.com/package/@hasna/switcher/v/0.1.0) was published at `2026-09-05T14:50:10.495Z`. Registry timestamp, tarball integrity and all 19 built-file hashes were verified.
- The exact registry release passed Node SDK/CLI/server/MCP smoke, all four native harness read-only tool loops on SQLite, and PostgreSQL with a second model. See `RELEASE.md` for evidence and limitations.
- Tracking task: `e0be8c8c-9588-4b7b-9996-382f113736e3`.
- Build, PR merge, publication and registry live acceptance are complete. Task/goal closure follows final evidence delivery. Optional product extensions and maintenance follow-ups remain explicit in `TODOS.md`.

## Release candidate verification update

The reviewed 0.1.1 archive now passes installed OpenCode tool/resume and interactive full DeepSeek picker checks, exact Codex provider-catalog matching, Node/Bun public surface checks, and both container storage profiles with upgrade/rollback/re-upgrade preservation. PR #1810 awaits a new required CI result after Projects’ generated storage-kit version stamp was refreshed to Contracts 1.0.2. This correction does not change the Switcher archive. The remaining adapter branches and live provider cells in TODOS.md remain active.
