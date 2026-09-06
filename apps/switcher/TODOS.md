---
id: "switcher-todos"
title: "Switcher full adapter and installed CLI delivery checklist"
type: "task-checklist"
owner: "codex-fixer"
created_at: "2026-09-05T12:35:04.768Z"
updated_at: "2026-09-06T14:35:14.192834+00:00"
status: "active"
source_task: "01a07181-ca8d-70c1-99a2-b276dc5770f3"
---

# Active goal: complete adapters and installed CLI delivery

User directive, 2026-09-05: “create TODOS.md and let's add full todos for all the missing adapters everything must be built in full and start a goal to ship and test live”. Tracking task: `1fb71b94-93b1-466f-a44b-0bcdaa710804`. Owner: `01a07181-ca8d-70c1-99a2-b276dc5770f3`. Canonical directive: `~/Workspace/scratch/universal-harness-switcher/directives/2026-09-05-01a07181-complete-switcher-adapters.md`.

Switcher **0.1.1 is published and registry accepted**. PR [#1810](https://github.com/hasna/apps/pull/1810) merged source `0bb3d62e28ba23acb76352a8dfad9f2d5d770e50`; npm publication at `2026-09-06T13:22:44.352Z` has SHA-1 `fe0aee17e92a46d2500bbc69f85d53ecda4b22ed`. All 38 installed files match the reviewed archive. The actual station CLI passed seven real-provider file-read/deleted-file fresh-resume paths in owned tmux: Claude/DeepSeek, Codex/OpenRouter, Grok/DeepSeek, OpenCode 2/DeepSeek, Pi/DeepSeek and Codex/Grok through Ori/OpenRouter. Codex listed exactly 363 compatible IDs from the recorded 581-entry OpenRouter refresh; OpenCode 2 showed all three DeepSeek IDs and selected Pro without inference. Node/Bun package surfaces and SQLite/PostgreSQL container persistence, upgrade, rollback and re-upgrade passed. Earlier rejected archives remain withdrawn; their reports are historical evidence.

The **0.1.2 candidate** adds OMP, DeepSeek Harness, Cline, Hermes, Prime Agent, legacy OpenCode, Kilo, Gemini CLI and Aider. All 14 native harnesses and two Ori paths passed actual installed baseline requests plus deleted-file fresh-process continuation; Aider uses file-context/edit/history semantics. The final source `ef217dd749c4628bead0df43c4a83b3dc8d11468` additionally preserves Gemini generation methods and excludes explicitly incompatible methods from coding selection, without inventing tool capabilities. Independent reviews reconcile 19 exact file hashes; 14 adapter implementation files are unchanged from the live baseline. The final archive SHA-1 `453bc3d6180a523286ab10f0a0154316cbf75672` matches all 49 ordinary npm consumer files.

Current verification passes **152 package tests / 1,584 assertions** including real PostgreSQL and installed Pi/Ori/Gemini, **147 root tests / 560 assertions**, all **43 affected builds**, generated/artifact/manifest/secret guards and frozen locks. Final archive Node/Bun CLI/API/SDK/MCP surfaces and SQLite/PostgreSQL container persistence, rollback and re-upgrade pass. Final Gemini live/catalog replay passes (54 retained models, 40 eligible native IDs, 14 explicitly incompatible method entries); PR [#1836](https://github.com/hasna/apps/pull/1836) CI is in progress; publication and registry acceptance remain open. The old 0.1.1 API reads preserved new rows but refuses new harness writes and updates carrying new generation-method metadata. Hermes/DeepSeek Chat can emit a nonfatal auxiliary-title format warning; its main tool loop and history resume pass. Native permission choices remain caller-controlled.

[COMPATIBILITY.md](COMPATIBILITY.md) separates published evidence, current source fixtures and remaining access/package gates. Evidence paths resolve under `~/Workspace/scratch/universal-harness-switcher`; the [evidence index](docs/verification-evidence.json) records source identities. Preserve the original user session `switcher-deepseek` on the separate `deepseek.sock` socket.

## Completion contract

The released `switcher launch HARNESS --provider PROVIDER --model MODEL` path owns API lifecycle, credential resolution and automatic discovery for supported built-in providers. No external supervisor or manually maintained replacement catalog is needed for DeepSeek/OpenRouter. Explicit operator deployment catalogs remain necessary where the provider has no deployment-list API. Remote API failures never fall back silently.

A checkbox closes only its stated contract. The 0.1.1 delivery rows are complete; K01–K09 below now track the expanded 0.1.2 delivery. Source fixtures do not establish registry or live-provider acceptance. Model-list APIs, visual pickers and actual request selection are separate claims. The [compatibility matrix](COMPATIBILITY.md) records each native interface and upstream limitation.

### Newly reproduced adapter regressions

- [x] R01 OpenCode 2: prevent global, project, per-model and per-agent endpoint/header overrides from changing the selected provider authority; preserve native JSONC/YAML permissions, prompts, AGENTS instructions and existing session data. Verify the actual native full catalog after initialization settles. Exact correction `0574a1c` has independent source/native approval: all three protocol fixtures pass tool/read/deleted-file resume, per-agent deny enforcement, exact complete native catalog, zero hostile requests and no credential files; nine focused tests / 30 assertions pass. Published 0.1.1 acceptance is R06; expanded shared-code rechecks remain K02/K07.
- [x] R02 Implementation verified: foreground supervision, delayed readiness, six signal/callback orderings, long-TMPDIR fallback and native file/resume pass; final combined/installed acceptance remains K01/K07.
- [x] R03 Corrected JSONC, root/agent deny and native grammar checks pass; all three integrated native tool/resume paths pass. Exact combined/package acceptance remains K01/K07.
- [x] R04 Six source CLI protocol/auth/no-auth read/resume cells and native catalog/second selection pass. Literal api-key followup passes direct Chat/Responses and bridged Messages; exact package/live acceptance remains open.
- [x] R05 Cline implementation and all three controlled ACP read/resume/second-model paths pass; installed baseline DeepSeek read/deleted-file resume also passes. Registry release remains K04–K07.
- [x] R07 Preserve profile authority for attached and clustered native arguments, native fallback/provider selectors and Ori forwarding; keep option values and literal prompts intact. Verify exact committed correction independently.
- [x] R06 Replace the withdrawn archives, repeat package/container/installed-harness acceptance against exact new bytes, pass required CI and publish through the reviewed PR. Repeat live tests from the registry-installed station command.

## A. Audit, scope and release ownership

- [x] A01 Start a new active build/ship/live-test goal; preserve the completed 0.1.0 record.
- [x] A02 Create an isolated worktree from fetched main after checking open Switcher PRs and branch ownership.
- [x] A03 Capture the full-delivery directive and preserve the user's active DeepSeek tmux session.
- [x] A04 Complete independent audits of provider/catalog, lifecycle/credentials, and native harness/Ori seams.
- [x] A05 Publish a finite provider × protocol × harness coverage matrix with exact versions, transport/auth requirements and acceptance status.
- [x] A06 Audit advertised routes and unsupported combinations in COMPATIBILITY; distinguish implementation, controlled native evidence, installed live paths and external account prerequisites.
- [x] A07 Track discovered omissions explicitly, including corrected Gemini generation-method eligibility and the upstream Hermes/DeepSeek auxiliary-title format limitation; preserve pending release/access gates.

## B. Installed CLI and onboarding

- [x] B01 Provide `switcher launch HARNESS --provider PROVIDER --model MODEL` as a complete built-in path while retaining existing saved-profile launches.
- [x] B02 Provide provider/harness discovery, model search and interactive selection using the same registry and API as noninteractive commands.
- [x] B03 Create or reuse the provider/profile automatically without overwriting a user's customized profile or racing another launch.
- [ ] B04 Resolve executable paths and versions; show precise installation guidance when absent and an explicitly requested install path where supported.
- [ ] B05 Supply machine-readable plans, structured errors, exit codes, dry-run/diagnostic output and actionable remediation without revealing keys.
- [x] B06 Keep noninteractive automation deterministic: explicit missing credential/model errors, no hidden prompts or paid discovery probes.
- [x] B07 Install the actual package CLI onto a test PATH and verify its bin/shebang/runtime resolution; include a normal station install within quarantine rules.
- [ ] B08 Add first-run, repeat-run, upgrade and restart acceptance using the documented commands exactly as a user would execute them.
- [x] B09 Document one-command DeepSeek and OpenRouter examples plus local and remote API modes; remove dependency on external setup scripts.

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
- [x] D05 Bearer, x-api-key, literal api-key and credentialless compatible endpoints have validated protocol/header contracts and native fixtures; live account coverage remains provider-specific.
- [ ] D06 Treat native harness subscription/OAuth authentication as its own supported mode where appropriate; never extract or pool native login credentials.
- [ ] D07 Distinguish missing, revoked, expired and inaccessible credentials; report stale or rotation-flagged vault metadata without automatic account switching.
- [x] D08 Validate catalog/inference authority before credential resolution or attachment; reject redirects and require a separate explicit credential reference for another catalog origin. Negative fixtures pass.
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
- [ ] E14 Record availability and access prerequisites for every named provider. Run the finite live cells in COMPATIBILITY with usable authorized credentials; missing access remains an explicit open gate, without requiring paid inference for every model/harness permutation.

## F. Catalog discovery and model metadata

- [x] F01 Add independent catalog base URL/path and parser/auth metadata to the provider schema, API, generated SDK and both database upgrade paths.
- [x] F02 Normalize inference/version path conventions centrally; cover DeepSeek's split path, custom prefixes and optional version suffixes.
- [x] F03 Implemented bounded native OpenAI/Anthropic/Ollama/Gemini/Mistral/Together/Fireworks/DashScope catalog parsers and their documented pagination contracts; no usable catalog is claimed for unsupported endpoints.
- [ ] F04 Verify refresh, retry/backoff, rate limits, bounded response/page sizes, cache freshness, offline behavior and upstream changes.
- [ ] F05 Preserve exact upstream model IDs and metadata provenance; keep aliases explicit and inspectable.
- [ ] F06 Fill context, output, reasoning, modalities and tools fields only from verified catalog or documented provider overrides; expose unknown values clearly.
- [x] F07 Generate native catalogs from compatible entries and retain the complete provider catalog in CLI/API. Explicit incompatible Gemini generation methods are now excluded; unknown capabilities remain unknown. Upstream native listing/picker differences remain documented.
- [ ] F08 Verify selecting another native model changes the actual request model and keeps the intended provider/auth authority.
- [ ] F09 Handle model removal, renamed IDs, stale plans, deprecated aliases and unsupported selections without silent fallback.
- [x] F10 Manual catalogs remain explicit for custom/deployment providers; built-ins discover automatically where documented. Azure foundation-model definitions are never treated as deployment inventory.

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
- [x] G14 Published 0.1.1 Pi native adapter and registry DeepSeek tool/deleted-file same-session resume pass; remaining unverified interactive behavior is listed in COMPATIBILITY.
- [x] G15 Prime implementation, foreground supervision, short runtime fallback, native read/deleted-file resume, exact RPC catalog and second-model request pass; installed baseline DeepSeek acceptance passes. Final registry gate is K07.
- [x] G16 DeepSeek Harness: direct native `dsh` web/headless/ACP adapter with isolated catalog, all three wire protocols and persistent sessions/attachments. Installed official 0.1.2-rc.1 fixtures verify nine protocol/auth tool/resume cells and browser catalog/auth/trust/shutdown. SDK/custom profiles and Ori's setup-only command are rejected. Independent integration review and real-provider live acceptance remain separate release gates.
- [x] G17 Hermes Chat/Responses/Messages controlled read/resume and selected-provider inventory pass; installed baseline DeepSeek Chat read/resume passes. Built-in free/MOA rows remain visible. Native auxiliary title generation can warn HTTP400 on DeepSeek Chat json_schema; main execution and fallback naming work. Registry gate is K07.
- [x] G18 Legacy OpenCode 1.18.29 has its own executable/schema and reviewed permissions/argument contract. All three controlled protocol paths and installed baseline DeepSeek read/resume/catalog pass. Registry gate is K07.
- [x] G19 OMP 18.1.11 native catalog, model selection, six protocol/auth/no-auth paths and RPC switches pass; installed baseline DeepSeek read/deleted-file resume passes. Literal api-key Messages uses the public bridge. Registry gate is K07.
- [x] G20 Kilo 7.5.15 integration has exact independent source review reconciled to final source; all three controlled protocol paths, cancellation, permissions and installed baseline DeepSeek read/resume/catalog pass. Native project MCP may use the ephemeral bridge token; it never receives the upstream credential. Registry gate is K07.
- [x] G21 Cline 3.0.61 ACP permissioned tool loops, full catalog, three protocols and second-model request pass; installed baseline DeepSeek read/deleted-file resume passes. Registry gate is K07.
- [x] G22 Gemini CLI0.58.0 native generateContent implementation, routing/trust/config hardening, cancellation and controlled native catalog pass. Installed baseline Gemini Flash-Lite read/deleted-file resume passes. Final generation-method fix is independently reviewed; final archive catalog/read/deleted-file resume now passes; registry acceptance remains K07.
- [x] G23 Aider 0.86.2 has independent review and 16 controlled native Chat/Responses/Messages edit/history/catalog launches; installed baseline DeepSeek edit/deleted-file history continuation passes. Responses is buffered and native listings include built-in definitions. Registry and unclaimed-platform checks remain separate.

## H. Ori and protocol adaptation

- [x] H01 Inspect the installed Ori command contract/version and implement an optional built-in backend using supported interfaces (Codex/Grok subset; other pairs rejected explicitly).
- [x] H02 Validate Ori provider/model limits, executable mapping including opencode2, argument passthrough, exit codes and catalog ownership.
- [x] H03 Keep direct adapters available; reject unsupported Ori/provider combinations explicitly and never route DeepSeek through OpenRouter silently.
- [x] H04 Add Ori dry-run/configuration, subprocess tests and live acceptance with the installed package command.
- [ ] H05 Define exact Messages/Responses/Chat feature compatibility and report unsupported combinations before spawning a harness.
- [ ] H06 Implement required opt-in compatibility adapters or supported external gateways for missing native protocol combinations; no implicit translation/fallback.
- [ ] H07 Test streaming event order, tool-call IDs/arguments/results, cancellation, usage, errors and reasoning state for every translation path shipped.
- [ ] H08 Explicitly handle parallel tools, multimodal content, context limits and resume across translated protocols; reject lossy unsupported features rather than silently dropping them.

## I. API, SDK, storage and self-hosting

- [x] I01 Extend OpenAPI and generated SDK for provider registry, discovery settings, capabilities, credential references and launch diagnostics; verify drift.
- [x] I02 Verified SQLite/PostgreSQL data preservation through 0.1.0→0.1.1 and 0.1.1→final 0.1.2→0.1.1→0.1.2. Providers/profiles/catalogs/runs and generation-method metadata persist; old clients deliberately reject unsupported new writes.
- [x] I03 Preserve transactional plan fingerprints, optimistic concurrency, durable idempotency and referential integrity with all new provider/launch fields.
- [x] I04 Run the same contract suite against real SQLite and PostgreSQL, including concurrent process startup.
- [x] I05 Final archive Docker image passes SQLite/PostgreSQL health, restart persistence, upgrades, rollback/re-upgrade and owned cleanup. Existing user services and the Docker VM remain intact.
- [x] I06 Verify hosted/remote API use from a separate CLI process and prevent remote API requests from executing local commands without the local launcher.
- [x] I07 Resolve the deprecated contracts → secrets → events → paths dependency chain through the owning contract boundary; published Contracts 1.0.2 and independent ordinary consumer acceptance prove removal without overrides or legacy-peer flags.
- [x] I08 Final 49-file npm consumer passes CLI, serve, standalone MCP protocol and Node/Bun SDK/API surfaces, including generation-method contract. No Hasna MCP server was registered in an agent. Registry acceptance remains K06–K07.
- [ ] I09 Keep remote execution workers as a separately identified product architecture; account for authentication, worker enrollment and process ownership before advertising remote launches.

## J. Automated and live acceptance

- [x] J01 DeepSeek inference/catalog split is reproduced and fixed; installed 0.1.1 and expanded baseline launch through the built-in flow without a replacement catalog or external API setup.
- [x] J02 Add clean-environment subprocess tests for first launch, secure auth resolution, autostart, repeat launch, config persistence and remote-mode failure.
- [ ] J03 Test every preset with deterministic contract servers for advertised protocols/auth/catalogs and meaningful negative cases.
- [ ] J04 Validate missing/revoked keys, 401/403/404/429/5xx, broken streams, malformed catalogs, redirects and unavailable local servers.
- [x] J05 Maintain the finite COMPATIBILITY matrix with separately identified configured, controlled-native, real-provider, catalog/selection, resume and release outcomes; do not equate protocol fixtures with provider entitlement.
- [x] J06 Run DeepSeek + Claude via the installed `switcher` command in ephemeral tmux with no external supervisor or catalog import; verify full native list, model change and proof-file tool loop.
- [ ] J07 Repeat live acceptance for Claude Code, Codex, Grok and OpenCode 2 across applicable named built-in providers; include direct provider and gateway/local-server paths.
- [x] J08 Run the optional Ori backend through the installed CLI and verify its declared model/provider boundaries.
- [ ] J09 Live-test SQLite and PostgreSQL, concurrent sessions, interruption, resume and cleanup; retain sanitized evidence and exact versions/model IDs.
- [ ] J10 Use approved credentials and bounded prompts; record missing access as a blocker, not a skipped success; never rotate credentials without separate authority.
- [x] J11 Preserve the user's existing DeepSeek session; use separate task-owned tmux sockets, directories, databases and ports for acceptance.
- [ ] J12 Remove all test-only setup assumptions from README examples and prove the documented install/launch path on a fresh configuration.

## K. Ship and close — expanded 0.1.2

Published 0.1.1 completed these delivery steps; this section tracks their repetition for the expanded candidate.

- [x] K01 Independent implementation and final delta reviews report no actionable P1/P2 findings; 19 exact reviewed file hashes reconcile to source ef217dd749c4 and unchanged adapter files bind baseline native evidence.
- [x] K02 Final source passes 152 package tests / 1,584 assertions with PostgreSQL/native opt-ins, generated/type/build/artifact/conformance checks,147 root tests / 560 assertions, 43 affected builds and frozen locks. PR CI remains K04.
- [x] K03 Apply only the owned Changesets patch to 0.1.2, update changelog/version/generated API and reproducible root/app lockfiles; unrelated main package versions remain intact.
- [ ] K04 Scan staged changes before every commit/push; open reviewed PRs and merge only after required CI.
- [ ] K05 Announce publication, verify version absence, publish with npm through protected vault injection, and verify fresh timestamp/integrity.
- [ ] K06 Install the exact released package as the command being tested, preserving quarantine; resolve `command -v switcher` and prove runtime version.
- [ ] K07 Repeat the live acceptance matrix against registry bytes; verify artifacts match reviewed builds.
- [x] K08 Update PLAN.md, this checklist, compatibility matrix and release evidence with actual PRs/commits/version/results and remaining upstream limitations.
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

- [x] Superseded by 0.1.1: executed both Docker Compose profiles, persistence, upgrade/rollback/re-upgrade on the accepted image.
- [x] Corrected and registry verified in 0.1.1: investigate intermittent Grok overlay cleanup and make state removal independent of bridge shutdown; one credential-free overlay required manual cleanup, while 30 controlled subprocess repetitions and two additional real runs cleaned normally.
- [x] Completed by published Contracts 1.0.2: remove the deprecated transitive `@hasna/paths` dependency through an upstream contracts/secrets peer-dependency fix; the current explicit environment credential path does not load that SDK chain.

## Deferred product extensions
These do not reduce the first-release requirements above.
- [ ] Expanded adapters are the active G14–G23 scope, with 0.1.2 release gates above.
- [x] Published in 0.1.1: optional Ori Codex/Grok OpenRouter backend; direct adapters remain available.
- [ ] Add protocol translators only with explicit feature contracts and streaming tests.
- [ ] Add remote execution workers only as a separately authorized product scope.
