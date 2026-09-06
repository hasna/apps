---
id: "switcher-todos"
title: "Switcher full adapter and installed CLI delivery checklist"
type: "task-checklist"
owner: "codex-fixer"
created_at: "2026-09-05T12:35:04.768Z"
updated_at: "2026-09-06T10:11:12Z"
status: "active"
source_task: "01a07181-ca8d-70c1-99a2-b276dc5770f3"
---

# Active goal: complete adapters and installed CLI delivery

User directive, 2026-09-05: “create TODOS.md and let's add full todos for all the missing adapters everything must be built in full and start a goal to ship and test live”. This checklist supersedes the assumption that the 0.1.0 setup experience was complete. Historical release evidence is retained below; it does not close any new acceptance requirement.

Tracking task: `1fb71b94-93b1-466f-a44b-0bcdaa710804` (O15-05467).

Owner: parent Codex task `01a07181-ca8d-70c1-99a2-b276dc5770f3`. Worktree: `~/Workspace/scratch/universal-harness-switcher/worktrees/complete-adapters`. Branch: `codex/fixer/2026-09-05-switcher-complete-adapters`. Fetched base: `48f8c1d020d5138fa542461c19ff137d9ea69819`. Canonical directive: `~/Workspace/scratch/universal-harness-switcher/directives/2026-09-05-01a07181-complete-switcher-adapters.md`.

## Latest implementation evidence

The source CLI owns its authenticated local API lifecycle, creates or reuses provider/profile records, resolves secure credential references and refreshes the provider catalog before launch. Separate inference/discovery URLs and native picker generation are implemented for Claude Code, Codex, Grok and OpenCode 2. The registry now includes the audited provider families and explicit vLLM/LiteLLM operator endpoints. See [COMPATIBILITY.md](COMPATIBILITY.md) for implemented routes and remaining live cells.

The Pi-integrated package passes **76 tests / 743 assertions** with real SQLite/PostgreSQL and installed Pi/Ori checks enabled. Native process-group and terminal fixes in `db50d4571d9c4d3b6d8c771fc52fab7df05f8362` passed independent review and macOS/Linux descriptor/keyboard tests. Ori integration and native preflight fixes in `a476ca5272e7f6df54f4aad82d78066c8ab382bc` passed independent exact-commit review: 26 tests / 175 assertions, plus the explicit installed-Ori check separately. Version inspection receives no provider credentials. Corrected Fireworks text/image metadata and cross-page totals are verified through native catalog generation and negative fixtures.

A fresh npm consumer installed unpublished Switcher 0.1.1 candidate SHA-1 `e78464c7aaa6d88a4e251d096b67b22fe5474eff`, with the exact locally packed Contracts 1.0.2 dependency. It contains no optional Secrets/Events/Paths dependency chain. This is prepublication candidate verification, not an ordinary registry install. The actual installed `switcher` command passed ephemeral tmux proof-file tool loops for Claude 2.1.263 + DeepSeek Flash and Codex 0.153.4 + OpenRouter Haiku 4.5, using both direct and Ori backends. Both Codex backends then resumed the same native session and recalled the token without tools; all five successful launches exited 0 and removed temporary settings. The candidate predates the final native-version/environment review fixes, which require release-byte repetition. Evidence: task scratch `live/candidate-0.1.1/run-ClRJAU/{result.json,resume-result.json}` and `run-ig6IVb/result.json`. An initial Claude test-command MCP syntax error was corrected; the original failed attempt is retained. An initial Codex result parser concatenated commentary with the final answer; `result.initial.json` preserves that diagnostic and the corrected evaluator checks the final answer.

Earlier installed development artifacts remain supporting evidence: SHA-1 `7b6c403317d1206a060a2fecacd3f870b9b5a05f` passed Claude DeepSeek Pro/Flash proof-file tools, all three native picker IDs, session-only Flash selection and Default mapping; SHA-1 `29431898c73dcff0b7fa44975f98c32e609e8812` passed Grok/OpenCode 2 DeepSeek Flash tool loops and two-process resume. Those artifacts were unpublished 0.1.0 builds and predate later review fixes. Vault bindings read the operator from Keychain and use the installed Secrets CLI without external provider-key wrappers, API supervisors or manual catalog imports. The original user session remains preserved.

Contracts release preparation is committed in `8f8e888713329fdef4e03ef8098e504bcb759f88`: runtime/package/kit version 1.0.2, optional Secrets peer, independently reviewed candidate bytes, six clean frozen consumer installs and correct CLI links. Full Contracts verification passes 1,561 tests / 15,662 assertions with real PostgreSQL; one hosted-credential test is skipped. Root names/dependency/secrets/manifests checks pass. Contracts 1.0.2 was published at 2026-09-06T09:31:01.120Z. The npm archive byte-matches the reviewed candidate; independent ordinary consumer installation, both CLI aliases and 19 module imports pass, with the optional dependency chain absent. Root checks now pass, including publishing guard, 147 standard tests and frozen locks. PR #1810 is open; CI and Switcher publication remain pending. The upstream Skills 0.4.1 history is preserved beneath this dependency wave's 0.4.2 version.

Both Docker Compose storage profiles passed container health/readiness, authentication and recreation persistence in an isolated task VM. Upgrades from published 0.1.0 preserve provider/profile/catalog/run history in SQLite and PostgreSQL. Owned test containers/volumes were removed. Release-image repetition and rollback acceptance remain open. Evidence: task scratch `docker-tests/result.json` and `switcher-upgrade-acceptance/result.json`.

Pi is integrated with all three protocols, authentication bridging, stable provider identity and persistent sessions. Review corrections cover duplicate Anthropic version paths and case-colliding IDs anywhere in the picker. Combined package verification and corrected native CLI tool/resume fixtures pass. Independent review verifies all nine protocol/auth combinations against the installed Pi library. The earlier weaker helper evidence remains historical. An installed-Pi regression proves the picker includes nested model IDs and excludes other providers; case-colliding catalog IDs are rejected. DeepSeek Harness now has a direct native web/headless/ACP implementation and installed-native fixtures; independent integration review and live provider acceptance remain separate gates. Prime Agent and the remaining named adapters remain open below. Missing live provider access must be recorded explicitly rather than inferred from successful catalog discovery.

The newest installed candidate SHA-1 `d542620bc412a71b07ebb5a34faa6a56c683e302` resolves published Contracts 1.0.2 normally without overrides. Pi + DeepSeek Flash passed actual tmux read-tool proof and same-session recall with tools disabled after deleting the proof file; both launches exited 0 and removed launch settings. Independent latest-candidate Claude, Codex and Grok tool/resume checks also pass. OpenCode 2 returned the correct proof but exposed a bridge shutdown hang; the deterministic failing regression now passes with explicit upstream stream cancellation and ordered bridge shutdown. Independent concurrent/native-cancel fixtures confirm fast cleanup. Its installed-candidate retest remains open, and older OpenCode results do not close this gate. Evidence: task scratch `live/pi-installed-QtVasQ/result.json` and `reviews/credential-runtime/installed-matrix-latest.json`.

## Definition of complete

The user can install the released package, supply a credential through a supported secure resolver, and launch a named harness/provider/model with the actual `switcher` command. No Python supervisor, direct native launch, manually maintained provider model JSON, or source-file imports may be needed for a built-in provider. A managed loopback API or an explicitly configured remote API continues to own application data. Never silently change provider, model, protocol, API authority or credential account.

Every adapter has a recorded endpoint/auth/catalog contract, capability matrix, failure behavior, automated contract tests and an explicit live status. A successful greeting is not a tool-loop, model-switching, resume, concurrency or full-catalog test. Missing credentials and upstream limitations stay open rather than being reported as passes. Additional providers with different wire/auth contracts require real adapters; a renamed base URL is insufficient evidence.

## A. Audit, scope and release ownership

- [x] A01 Start a new active build/ship/live-test goal; preserve the completed 0.1.0 record.
- [x] A02 Create an isolated worktree from fetched main after checking open Switcher PRs and branch ownership.
- [x] A03 Capture the full-delivery directive and preserve the user's active DeepSeek tmux session.
- [x] A04 Complete independent audits of provider/catalog, lifecycle/credentials, and native harness/Ori seams.
- [ ] A05 Publish a finite provider × protocol × harness coverage matrix with exact versions, transport/auth requirements and acceptance status.
- [ ] A06 Inventory every currently advertised route and unsupported combination; remove misleading universal/complete claims until evidence exists.
- [ ] A07 Turn newly discovered omissions into stable checklist entries and implementation work; do not silently defer named acceptance gates.

## B. Installed CLI and onboarding

- [x] B01 Provide `switcher launch HARNESS --provider PROVIDER --model MODEL` as a complete built-in path while retaining existing saved-profile launches.
- [x] B02 Provide provider/harness discovery, model search and interactive selection using the same registry and API as noninteractive commands.
- [x] B03 Create or reuse the provider/profile automatically without overwriting a user's customized profile or racing another launch.
- [ ] B04 Resolve executable paths and versions; show precise installation guidance when absent and an explicitly requested install path where supported.
- [ ] B05 Supply machine-readable plans, structured errors, exit codes, dry-run/diagnostic output and actionable remediation without revealing keys.
- [x] B06 Keep noninteractive automation deterministic: explicit missing credential/model errors, no hidden prompts or paid discovery probes.
- [ ] B07 Install the actual package CLI onto a test PATH and verify its bin/shebang/runtime resolution; include a normal station install within quarantine rules.
- [ ] B08 Add first-run, repeat-run, upgrade and restart acceptance using the documented commands exactly as a user would execute them.
- [ ] B09 Document one-command DeepSeek and OpenRouter examples plus local and remote API modes; remove dependency on external setup scripts.

## C. Local API lifecycle and remote API behavior

- [x] C01 Start an authenticated loopback API automatically for the configured local mode; keep CLI/SDK application operations HTTP-only.
- [x] C02 Keep generated local operator credentials in memory or an approved secure store; no token files, plaintext env files or secret-bearing launch arguments.
- [x] C03 Use only `~/.hasna/switcher` or an explicit home override for user data; keep acceptance fixtures in Workspace scratch.
- [ ] C04 Specify service ownership, port allocation, readiness, compatible-version checks, idle/shutdown policy and stale-process recovery.
- [x] C05 Prevent startup races and stale-PID/port reuse from attaching to or stopping an unrelated process.
- [x] C06 Verify concurrent launches, shared SQLite access and independent profiles without cross-session credential/config contamination.
- [x] C07 Honor explicitly configured remote API URL/auth; fail on remote errors without creating a local fallback store.
- [ ] C08 Preserve service availability for active sessions; stop only owned temporary services and bridges on normal exit, signals, timeout and startup failure.
- [ ] C09 Expose status/doctor and explicit lifecycle controls with redacted diagnostics and a real reachability distinction.
- [x] C10 Keep the public SDK free of local process and database dependencies; expose server capabilities/version for compatible clients.

## D. Credential and authentication adapters

- [x] D01 Support explicit provider environment references and standard provider variable aliases without copying values into persistent provider records.
- [x] D02 Add a configured approved-vault resolver so existing credentials can be used by the installed command without an outside launch wrapper.
- [ ] D03 Support macOS Keychain and documented Linux secret-manager/runtime injection paths; never create alternative fleet credential stores.
- [x] D04 Separate local credential locators from remote API data and keep operator/provider/catalog credentials independently scoped.
- [ ] D05 Support bearer, x-api-key and credentialless local endpoints; add other header/auth schemes only with explicit validated contracts.
- [ ] D06 Treat native harness subscription/OAuth authentication as its own supported mode where appropriate; never extract or pool native login credentials.
- [ ] D07 Distinguish missing, revoked, expired and inaccessible credentials; report stale or rotation-flagged vault metadata without automatic account switching.
- [ ] D08 Validate destination authority before attaching keys; reject redirects and require explicit separate credentials/consent for cross-origin catalog destinations.
- [ ] D09 Test redaction across stderr, debug/JSON, API errors, tmux capture, process arguments, settings files and persisted run metadata.
- [x] D10 Ensure child harnesses receive only the credentials they require; strip unrelated fleet, provider and cloud secrets.

## E. Provider registry and built-in presets

Each preset must declare supported inference protocols, inference/catalog base URLs, catalog parser/pagination, auth style, credential aliases, metadata provenance and tested status. Static model names are not a replacement for discovery. A provider's optional endpoint must not be advertised before validation.

- [x] E01 Implement a shared typed provider registry exposed consistently by CLI, API and SDK; validate user endpoint overrides.
- [ ] E02 DeepSeek: distinct Anthropic inference and root model-discovery endpoints; current native model IDs, context metadata and defaults; no manual catalog import.
- [ ] E03 OpenRouter: full all-modality catalog, native Messages/Responses/Chat routes, metadata preservation and exact provider model IDs.
- [ ] E04 Anthropic: Messages headers/auth, paginated native catalog, supported context/reasoning metadata and native-auth boundary.
- [ ] E05 OpenAI: separate Responses and Chat routes, model catalog, tools/reasoning capability distinctions and account access errors.
- [ ] E06 xAI: verified native protocols/catalog/auth, Grok model identifiers and compatibility with other supported harnesses.
- [ ] E07 Ollama: local discovery format, supported native/compatible inference endpoints, no-auth operation and installation/model-availability diagnostics.
- [ ] E08 LM Studio: local compatible server discovery, model metadata and authenticated/credentialless operation.
- [ ] E09 vLLM: OpenAI-compatible and separately verified Messages deployment paths; explicit operator URLs and server capabilities.
- [ ] E10 LiteLLM and generic compatible gateways: prefixed inference URLs, independent discovery URL/auth and transparent protocol declarations.
- [ ] E11 Audit and implement other material compatible provider families (Mistral, Groq, Cerebras, Together, Fireworks, Moonshot/Kimi, Qwen/DashScope, Z.ai, MiniMax, SiliconFlow) with verified presets rather than assumed endpoint strings.
- [ ] E12 Audit Gemini, Azure OpenAI, Bedrock and Vertex separately: inventory distinct wire/auth/deployment contracts and implement explicit adapters or supported gateway integrations; do not label them generic-compatible without evidence.
- [ ] E13 Supply an extension interface for unlisted providers with schema validation, explicit protocol/capabilities and the same security/test contract.
- [ ] E14 For every named built-in provider, record live credential availability and run all applicable acceptance cells; missing access remains an open gate.

## F. Catalog discovery and model metadata

- [x] F01 Add independent catalog base URL/path and parser/auth metadata to the provider schema, API, generated SDK and both database upgrade paths.
- [x] F02 Normalize inference/version path conventions centrally; cover DeepSeek's split path, custom prefixes and optional version suffixes.
- [ ] F03 Implement applicable OpenAI/Anthropic/Ollama/provider-specific catalog parsers and pagination without truncating models.
- [ ] F04 Verify refresh, retry/backoff, rate limits, bounded response/page sizes, cache freshness, offline behavior and upstream changes.
- [ ] F05 Preserve exact upstream model IDs and metadata provenance; keep aliases explicit and inspectable.
- [ ] F06 Fill context, output, reasoning, modalities and tools fields only from verified catalog or documented provider overrides; expose unknown values clearly.
- [ ] F07 Generate every native picker from compatible provider entries while keeping the complete unfiltered provider catalog in the API/CLI.
- [ ] F08 Verify selecting another native model changes the actual request model and keeps the intended provider/auth authority.
- [ ] F09 Handle model removal, renamed IDs, stale plans, deprecated aliases and unsupported selections without silent fallback.
- [ ] F10 Retain manual catalogs as an explicit custom-provider feature, never a hidden requirement for a built-in preset.

## G. Native harness adapters

- [ ] G01 Claude Code: complete native preset launch, full picker, provider-specific context/reasoning settings, auth modes, default/subagent model mapping and metadata warnings.
- [ ] G02 Claude Code: verify DeepSeek and Anthropic-compatible gateways, actual tool loops, streaming, cancellation and session resume with preserved native permissions/config.
- [ ] G03 Codex: complete provider configuration and full ModelInfo catalog, reasoning/context behavior, exact selected ID and native authentication modes.
- [ ] G04 Codex: verify direct and compatible Responses backends, supported tool cycles, streaming/cancellation and resume without inheriting stale provider settings.
- [ ] G05 Grok: complete protocol-specific bridge/catalog/auth behavior and preserve exact model IDs with per-session isolation.
- [ ] G06 Grok: resolve bridge lifetime/resume support and overlay cleanup; keep state removal independent of bridge shutdown, including shutdown rejection.
- [ ] G07 OpenCode 2: version-aware provider package/schema selection, complete native catalog and capability metadata, stable provider identity and standalone/shared execution behavior.
- [ ] G08 OpenCode 2: verify all supported protocol/auth combinations and complete bridge-safe resume, rather than permanently rejecting it without a tracked implementation.
- [ ] G09 All four: preserve native settings, cwd, terminal resize, stdin/TTY, permissions and normal exit codes; reserve only flags that would invalidate the chosen provider/profile.
- [ ] G10 All four: verify SIGINT/SIGTERM, timeout, failed spawn, bridge error and API-finalization failure; no surviving owned children, listeners or generated settings.
- [ ] G11 All four: test concurrent sessions, model changes and resumed sessions; never modify unrelated global provider configuration.
- [ ] G12 Add a documented harness adapter/extension contract with detection, supported versions/protocols, preparation, catalog and cleanup tests.
- [ ] G13 Inventory additional harnesses from Ori/local evidence and add explicit adapter tasks for supported launch interfaces; keep the named four mandatory.
- [ ] G14 Pi: implement verified executable/config/provider/catalog/session integration and apply the same installed-CLI live acceptance contract.
- [ ] G15 Prime Agent: implement verified launch/provider/full-catalog integration and test native model changes and lifecycle.
- [x] G16 DeepSeek Harness: direct native `dsh` web/headless/ACP adapter with isolated catalog, all three wire protocols and persistent sessions/attachments. Installed official 0.1.2-rc.1 fixtures verify nine protocol/auth tool/resume cells and browser catalog/auth/trust/shutdown. SDK/custom profiles and Ori's setup-only command are rejected. Independent integration review and real-provider live acceptance remain separate release gates.
- [ ] G17 Hermes: verify and implement isolated provider/auth/model configuration, catalog behavior, tool loop and resume.
- [ ] G18 Legacy OpenCode: keep its executable/schema separate from OpenCode 2 and test both without ambiguous executable substitution.
- [ ] G19 OMP: verify the native launch/config contract and implement model selection plus truthful catalog support.
- [ ] G20 Kilo: verify the CLI distribution/launch contract and implement supported provider/catalog/session behavior.
- [ ] G21 Cline: verify the CLI distribution/launch contract and implement supported provider/catalog/session behavior.
- [ ] G22 Gemini CLI: verify its distinct provider/auth/wire contract before implementing an adapter or explicit compatible gateway path.
- [ ] G23 Aider: implement its verified provider/model/config path and distinguish available model listing from a native interactive picker.

## H. Ori and protocol adaptation

- [x] H01 Inspect the installed Ori command contract/version and implement an optional built-in backend using supported interfaces (Codex/Grok subset; other pairs rejected explicitly).
- [ ] H02 Validate Ori provider/model limits, executable mapping including opencode2, argument passthrough, exit codes and catalog ownership.
- [x] H03 Keep direct adapters available; reject unsupported Ori/provider combinations explicitly and never route DeepSeek through OpenRouter silently.
- [ ] H04 Add Ori dry-run/configuration, subprocess tests and live acceptance with the installed package command.
- [ ] H05 Define exact Messages/Responses/Chat feature compatibility and report unsupported combinations before spawning a harness.
- [ ] H06 Implement required opt-in compatibility adapters or supported external gateways for missing native protocol combinations; no implicit translation/fallback.
- [ ] H07 Test streaming event order, tool-call IDs/arguments/results, cancellation, usage, errors and reasoning state for every translation path shipped.
- [ ] H08 Explicitly handle parallel tools, multimodal content, context limits and resume across translated protocols; reject lossy unsupported features rather than silently dropping them.

## I. API, SDK, storage and self-hosting

- [x] I01 Extend OpenAPI and generated SDK for provider registry, discovery settings, capabilities, credential references and launch diagnostics; verify drift.
- [ ] I02 Migrate existing 0.1.0 SQLite/PostgreSQL data without losing provider/profile/catalog/run history; prove rollback and restart persistence.
- [x] I03 Preserve transactional plan fingerprints, optimistic concurrency, durable idempotency and referential integrity with all new provider/launch fields.
- [x] I04 Run the same contract suite against real SQLite and PostgreSQL, including concurrent process startup.
- [ ] I05 Execute Docker build, SQLite compose and PostgreSQL compose on a Docker-capable host; verify health, persistence, upgrades and graceful stop.
- [x] I06 Verify hosted/remote API use from a separate CLI process and prevent remote API requests from executing local commands without the local launcher.
- [ ] I07 Resolve the deprecated contracts → secrets → events → paths dependency chain through the owning contract boundary; do not fork credential resolution or hide it with legacy-peer flags.
- [ ] I08 Verify CLI, serve, required MCP packaging surface and Node/Bun SDK entrypoints from the actual npm tarball; never register Hasna MCP in an agent.
- [ ] I09 Keep remote execution workers as a separately identified product architecture; account for authentication, worker enrollment and process ownership before advertising remote launches.

## J. Automated and live acceptance

- [ ] J01 Add a regression reproducing the DeepSeek inference/catalog split; prove it fails on 0.1.0 and passes through the new installed CLI.
- [x] J02 Add clean-environment subprocess tests for first launch, secure auth resolution, autostart, repeat launch, config persistence and remote-mode failure.
- [ ] J03 Test every preset with deterministic contract servers for advertised protocols/auth/catalogs and meaningful negative cases.
- [ ] J04 Validate missing/revoked keys, 401/403/404/429/5xx, broken streams, malformed catalogs, redirects and unavailable local servers.
- [ ] J05 Maintain a provider × protocol × harness matrix with separate configured, fixture-tested, live-inference, live-tool-loop, picker and resume outcomes.
- [x] J06 Run DeepSeek + Claude via the installed `switcher` command in ephemeral tmux with no external supervisor or catalog import; verify full native list, model change and proof-file tool loop.
- [ ] J07 Repeat live acceptance for Claude Code, Codex, Grok and OpenCode 2 across applicable named built-in providers; include direct provider and gateway/local-server paths.
- [ ] J08 Run the optional Ori backend through the installed CLI and verify its declared model/provider boundaries.
- [ ] J09 Live-test SQLite and PostgreSQL, concurrent sessions, interruption, resume and cleanup; retain sanitized evidence and exact versions/model IDs.
- [ ] J10 Use approved credentials and bounded prompts; record missing access as a blocker, not a skipped success; never rotate credentials without separate authority.
- [x] J11 Preserve the user's existing DeepSeek session; use separate task-owned tmux sockets, directories, databases and ports for acceptance.
- [ ] J12 Remove all test-only setup assumptions from README examples and prove the documented install/launch path on a fresh configuration.

## K. Ship and close

- [ ] K01 Obtain independent review of exact implementation commits and correct/verify findings.
- [ ] K02 Run package typecheck/tests/build/generated/artifact checks plus required root names/secrets/manifests/standard/frozen-lock gates and affected build/test.
- [ ] K03 Add the appropriate changeset/version/changelog and update reproducible root/app lockfiles.
- [ ] K04 Scan staged changes before every commit/push; open reviewed PRs and merge only after required CI.
- [ ] K05 Announce publication, verify version absence, publish with npm through protected vault injection, and verify fresh timestamp/integrity.
- [ ] K06 Install the exact released package as the command being tested, preserving quarantine; resolve `command -v switcher` and prove runtime version.
- [ ] K07 Repeat the live acceptance matrix against registry bytes; verify artifacts match reviewed builds.
- [ ] K08 Update PLAN.md, this checklist, compatibility matrix and release evidence with actual PRs/commits/version/results and remaining upstream limitations.
- [ ] K09 Confirm publication in the required thread/task, stop only owned acceptance processes, and preserve the user's interactive session.
- [ ] K10 Close the goal only after the full required matrix and release gates are complete; no completion claim based solely on scaffolding, fixtures or OpenRouter smoke.

---

# Historical 0.1.0 release checklist

The following entries describe the original release scope only. The active requirements above remain open until independently verified.


# Completion rules

Mark an item complete only with evidence. All four launchers are required for the first release: Claude Code, Codex, Grok Build, OpenCode 2. A successful model picker is not a successful inference test. A successful source build is not a published release. See `PLAN.md` for the accepted scope and sources.

## Planning and isolation
- [x] Investigate todos, official harness documentation, Ori and primary GitHub alternatives.
- [x] Inspect installed CLIs and fetch the public OpenRouter catalog without inference.
- [x] Create the active build/ship/publish/live-test goal.
- [x] Check existing branches/PRs/package and create an isolated worktree from fetched main.
- [x] Generate the new member with the repository scaffold.
- [x] Save PLAN.md and TODOS.md with required metadata.
- [x] Record the latest implementation/publication directive and link it from the task evidence.
- [x] Verify Grok Build's official install, protocol, configuration and picker interfaces.
- [x] Finish app-specific conformance review and document the explicit dual-storage exception.

## Domain, API and SDK
- [x] Define runtime-validated provider, model, profile, launch-plan and run schemas.
- [x] Implement one service layer with structured errors and stable IDs.
- [x] Implement authenticated provider CRUD.
- [x] Implement model list/refresh and profile CRUD.
- [x] Implement validated launch-plan creation and run metadata lifecycle.
- [x] Implement health/readiness/version and OpenAPI endpoints.
- [x] Generate typed SDK bindings from OpenAPI and verify reproducibility.
- [x] Make CLI and MCP application-data operations use the HTTP SDK only.
- [x] Verify malformed URL/auth handling and fail closed without local DB fallback.
- [x] Verify server authentication, request limits and safe diagnostics.

## SQLite and PostgreSQL
- [x] Implement migration-backed transactional SQLite storage.
- [x] Implement migration-backed transactional PostgreSQL storage.
- [x] Run the same storage contract suite against both engines.
- [x] Verify restart persistence, duplicate/conflict handling and rollback behavior.
- [x] Validate server-only database configuration.
- [x] Supply and validate Dockerfile/compose deployment configuration (parsed/static checks; container runtime not available).

## Providers and catalogs
- [x] Define distinct Anthropic Messages, OpenAI Responses and Chat Completions protocols.
- [x] Add OpenRouter preset and arbitrary compatible base URLs with path-prefix support.
- [x] Resolve credential references in memory without storing raw values.
- [x] Implement discovery, pagination, manual catalog entries and refresh/cache policy.
- [x] Preserve source model IDs, metadata provenance and unknown capabilities.
- [x] Provide searchable model listing with explicit compatibility information.
- [x] Verify representative native selections retain exact upstream model IDs, including a second live model.
- [x] Document supported direct paths and optional external translation gateways.
- [x] Test auth error redaction, redirects and provider isolation.

## Required first-release launchers
- [x] Implement Claude Code executable/version detection and per-launch configuration.
- [x] Implement Claude Code native modelPicker generation and capability limitations.
- [x] Implement Codex custom Responses provider and per-launch configuration.
- [x] Implement Codex version-compatible startup model catalog.
- [x] Implement Grok Build provider/model configuration.
- [x] Implement Grok native picker integration where supported, with truthful fallback.
- [x] Implement OpenCode 2 executable detection including opencode2.
- [x] Implement OpenCode 2 isolated provider configuration and native model catalog.
- [x] Preserve native cwd, terminal, permissions, session/home configuration and user arguments.
- [x] Forward signals and child exit codes; prevent orphaned child processes.
- [x] Verify concurrent sessions with different providers do not contaminate each other.
- [x] Implement a doctor command that distinguishes installed, configured and live-verified.
- [x] Verify documented resume behavior or clearly reject unsupported combinations.

## Product and package
- [x] Replace scaffold placeholders with useful CLI help, JSON output and actionable errors.
- [x] Implement the required MCP surface with correct protocol framing.
- [x] Write README examples, self-host instructions and compatibility matrix.
- [x] Update package exports, bins, license, manifest and release version/changeset.
- [x] Exclude tests, private evidence and secrets from the published artifact.
- [x] Build and verify CLI, server, SDK and MCP entrypoints from the packed artifact.

## Automated and independent verification
- [x] Pass package typecheck and meaningful behavioral tests.
- [x] Pass real PostgreSQL integration tests.
- [x] Pass generated SDK/artifact drift checks and package conformance checks.
- [x] Pass required repository name/dependency/secrets/manifest/publish/standard gates.
- [x] Pass affected build/test checks or resolve evidenced failures.
- [x] Obtain independent review of the exact implementation commit.
- [x] Fix review findings and independently verify the corrected commit.
- [x] Run staged secret scans before each commit and push.

## Live verification in ephemeral tmux
- [x] Create only task-owned tmux sessions, scratch directories and loopback services.
- [x] Select an authorized station credential via protected secrets-service injection.
- [x] Install/resolve Grok through its official distribution if absent.
- [x] Live-test API and SDK using both SQLite and PostgreSQL backends.
- [x] Live-test Claude Code through switcher with a bounded no-edit prompt.
- [x] Live-test Codex through switcher with a bounded no-edit prompt.
- [x] Live-test Grok Build through switcher with a bounded no-edit prompt.
- [x] Live-test OpenCode 2 through switcher with a bounded no-edit prompt.
- [x] Verify native catalog visibility and selection for each supported picker.
- [x] Verify a model change changes the actual model used.
- [x] Record source-test versions, outcomes and sanitized evidence; clean up only owned tmux sessions/processes.

## Ship and publish
- [x] Open the implementation PR with scope, validation and Agent trailer.
- [x] Wait for required CI/review and merge through the authorized PR-first workflow.
- [x] Verify the publish version is not already present on npm.
- [x] Announce publication intent in the required publishing channel.
- [x] Publish from the package directory via npm and protected vault-token/npmrc pairing.
- [x] Verify npm version, fresh timestamp and artifact integrity.
- [x] Confirm publication in the required thread and task record.
- [x] Install the exact published version in an isolated test location respecting quarantine.
- [x] Repeat required live acceptance checks against the registry artifact.
- [x] Update PLAN.md/TODOS.md and final evidence with actual commit/PR/version/results.
- [x] Verify release and live-test prerequisites before closing the external task/goal.

Historical 0.1.0 verification and limitations are recorded in `RELEASE.md`. Current container execution evidence and remaining release-image gates appear in the active checklist above.

## Maintenance follow-ups

- [ ] Execute the published Dockerfile and both compose profiles on a Docker-capable host.
- [ ] Investigate intermittent Grok overlay cleanup and make state removal independent of bridge shutdown; one credential-free overlay required manual cleanup, while 30 controlled subprocess repetitions and two additional real runs cleaned normally.
- [ ] Remove the deprecated transitive `@hasna/paths` dependency through an upstream contracts/secrets peer-dependency fix; the current explicit environment credential path does not load that SDK chain.

## Deferred product extensions
These do not reduce the first-release requirements above.
- [ ] Add other harness adapters after the required four are verified.
- [ ] Add an optional Ori launcher backend without making it mandatory.
- [ ] Add protocol translators only with explicit feature contracts and streaming tests.
- [ ] Add remote execution workers only as a separately authorized product scope.
