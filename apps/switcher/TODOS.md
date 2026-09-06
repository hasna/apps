---
id: "switcher-todos"
title: "Switcher full adapter and installed CLI delivery checklist"
type: "task-checklist"
owner: "codex-fixer"
created_at: "2026-09-05T12:35:04.768Z"
updated_at: "2026-09-06T17:11:49.882018+00:00"
status: "active"
source_task: "01a07181-ca8d-70c1-99a2-b276dc5770f3"
---

# Active goal: complete adapters and installed CLI delivery

User directive, 2026-09-05: “create TODOS.md and let's add full todos for all the missing adapters everything must be built in full and start a goal to ship and test live”. Tracking task: `1fb71b94-93b1-466f-a44b-0bcdaa710804`. Owner: `01a07181-ca8d-70c1-99a2-b276dc5770f3`. Canonical directive: `~/Workspace/scratch/universal-harness-switcher/directives/2026-09-05-01a07181-complete-switcher-adapters.md`.

Switcher **0.1.2 is published and installed**. [PR #1836](https://github.com/hasna/apps/pull/1836) merged reviewed source `61c0ca1b241043567bd7349a2810012db9c41b46` as `24681fa7552584c39c6bbcf7107faa6dd2f885e3` after all nine checks passed (the optional external review was skipped). npm publication at `2026-09-06T16:47:17.965Z` has SHA-1 `3952926c933700c8e5a56130bc3cb3c56bb01969`. All **50 installed package files** match the reviewed archive. The normal station `switcher`, `switcher-serve` and `switcher-mcp` commands resolve to 0.1.2; the previous installation and quarantine policy are preserved.

The release includes **14 native adapters, two optional Ori paths and 24 provider presets**, an HTTP API and typed `./sdk`, and SQLite/PostgreSQL self-hosting. It adds the missing adapters, corrects routing/argument authority and cleanup, preserves Gemini generation methods, bounds catalog retries, sanitizes reflected operator credentials in remote SDK errors, and supplies native installation guidance. Native harness installation and an approved provider credential remain prerequisites; Switcher owns provider/profile creation, automatic discovery and the local API lifecycle.

The published source passed **167 package tests / 1,799 assertions**, including real PostgreSQL and installed native opt-ins, **147 root tests / 560 assertions**, **43 affected builds**, frozen locks and generated/artifact/manifest/secret guards. Registry-installed Node 26.8.1 and Bun 1.3.14 CLI/API/SDK/server/standalone MCP checks pass. No Hasna MCP server was registered. The exact runtime bytes also passed both Compose storage backends, persistence, 0.1.1→0.1.2→0.1.1→0.1.2 and container recreation. Old 0.1.1 clients read preserved data but reject unsupported new harness writes and generation-method updates.

Registry live acceptance and native catalog observations are recorded in [COMPATIBILITY.md](COMPATIBILITY.md). The [evidence index](docs/verification-evidence.json) distinguishes published bytes from historical candidates and provider access limits. Evidence files live under `~/Workspace/scratch/universal-harness-switcher`; these are local provenance locators, not files included in the npm archive. The user's original `switcher-deepseek` session on `deepseek.sock` remains preserved.

The rejected archive `453bc3d6180a523286ab10f0a0154316cbf75672` was never published. Its SDK error reflection finding was corrected and independently rechecked before this release. Earlier baseline and 0.1.1 reports retain their original artifact identities; their provider observations are not relabeled as 0.1.2 registry tests.

## Completion contract

The released `switcher launch HARNESS --provider PROVIDER --model MODEL` path owns API lifecycle, credential resolution and automatic discovery for supported built-in providers. No external supervisor or manually maintained replacement catalog is needed for DeepSeek/OpenRouter. Explicit operator deployment catalogs remain necessary where the provider has no deployment-list API. Remote API failures never fall back silently.

A checkbox closes only its stated contract. K01–K10 track the expanded 0.1.2 delivery; external prerequisites and extensions remain explicitly open below. Source fixtures do not establish registry or live-provider acceptance. Model-list APIs, visual pickers and actual request selection are separate claims. The [compatibility matrix](COMPATIBILITY.md) records each native interface and upstream limitation.

### Newly reproduced adapter regressions

- [x] R01 OpenCode 2: prevent global, project, per-model and per-agent endpoint/header overrides from changing the selected provider authority; preserve native JSONC/YAML permissions, prompts, AGENTS instructions and existing session data. Verify the actual native full catalog after initialization settles. Exact correction `0574a1c` has independent source/native approval: all three protocol fixtures pass tool/read/deleted-file resume, per-agent deny enforcement, exact complete native catalog, zero hostile requests and no credential files; nine focused tests / 30 assertions pass. Published 0.1.1 acceptance is R06; expanded shared-code rechecks passed under K02/K07.
- [x] R02 Implementation verified: foreground supervision, delayed readiness, six signal/callback orderings, long-TMPDIR fallback and native file/resume pass; final combined/installed acceptance is complete under K01/K07.
- [x] R03 Corrected JSONC, root/agent deny and native grammar checks pass; all three integrated native tool/resume paths pass. Exact combined/package acceptance passed under K01/K07.
- [x] R04 Six source CLI protocol/auth/no-auth read/resume cells and native catalog/second selection pass. Literal api-key followup passes direct Chat/Responses and bridged Messages; exact package/live acceptance is complete under K02/K07.
- [x] R05 Cline implementation and all three controlled ACP read/resume/second-model paths pass; installed baseline DeepSeek read/deleted-file resume also passes. Registry release passed K04–K07.
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
- [x] B04 Resolve executable paths and versions; doctor and missing-launch errors identify each native executable, verified version and official installation instructions. `--executable` selects an explicitly installed path. Switcher does not install or upgrade native harnesses.
- [x] B05 Provide JSON plans, typed error codes/status, nonzero exits, dry-run/doctor guidance and bounded secret-safe API errors; SDK/CLI/API/MCP error-path probes pass.
- [x] B06 Keep noninteractive automation deterministic: explicit missing credential/model errors, no hidden prompts or paid discovery probes.
- [x] B07 Install the actual package CLI onto a test PATH and verify its bin/shebang/runtime resolution; include a normal station install within quarantine rules.
- [x] B08 Verify fresh-home and repeated installed commands, persistence, package upgrade/restart and rollback through the recorded registry and container checks.
- [x] B09 Document one-command DeepSeek and OpenRouter examples plus local and remote API modes; remove dependency on external setup scripts.

## C. Local API lifecycle and remote API behavior

- [x] C01 Start an authenticated loopback API automatically for the configured local mode; keep CLI/SDK application operations HTTP-only.
- [x] C02 Keep generated local operator credentials in memory or an approved secure store; no token files, plaintext env files or secret-bearing launch arguments.
- [x] C03 Use only `~/.hasna/switcher` or an explicit home override for user data; keep acceptance fixtures in Workspace scratch.
- [x] C04 Own one authenticated in-process API per local command, with an ephemeral port and bundled server version; expose health/readiness/version. Close it when the command ends. The 60-second server idle timeout applies to connections, not process lifetime. There is no detached daemon or stale-PID reuse contract.
- [x] C05 Prevent startup races and stale-PID/port reuse from attaching to or stopping an unrelated process.
- [x] C06 Verify concurrent launches, shared SQLite access and independent profiles without cross-session credential/config contamination.
- [x] C07 Honor explicitly configured remote API URL/auth; fail on remote errors without creating a local fallback store.
- [x] C08 Keep the local API alive for the command and stop only owned services/bridges/children on normal exit, signals, timeout and startup failure. Shared lifecycle fixtures and installed native cleanup pass; SIGKILL/escaped descendants are outside this guarantee.
- [x] C09 Expose status/doctor, health/readiness/version and redacted reachability errors. CLI lifecycle is per-command; explicit self-hosting uses switcher-serve and its supervisor, without an invented background-daemon control API.
- [x] C10 Keep the public SDK free of local process and database dependencies; expose server capabilities/version for compatible clients.

## D. Credential and authentication adapters

- [x] D01 Support explicit provider environment references and standard provider variable aliases without copying values into persistent provider records.
- [x] D02 Add a configured approved-vault resolver so existing credentials can be used by the installed command without an outside launch wrapper.
- [x] D03 Support macOS Keychain and approved-vault resolution plus Linux runtime environment injection. Registry launches exercised station Keychain-backed vault access; exact-release Linux container tests verify environment resolution and missing-value rejection. No alternative fleet credential store is created.
- [x] D04 Separate local credential locators from remote API data and keep operator/provider/catalog credentials independently scoped.
- [x] D05 Bearer, x-api-key, literal api-key and credentialless compatible endpoints have validated protocol/header contracts and native fixtures; live account coverage remains provider-specific.
- [ ] D06 Extension: define native subscription/OAuth passthrough where appropriate. Current provider mode deliberately does not extract or pool native login credentials; it is not a subscription-account switcher.
- [ ] D07 Diagnostic extension: distinguish provider-reported revoked/expired and vault stale/rotation states when reliable metadata is available. Current code reports missing/inaccessible bindings and terminal lookup/upstream authorization errors without automatic account switching; it does not infer why a provider returned 401/403.
- [x] D08 Validate catalog/inference authority before credential resolution or attachment; reject redirects and require a separate explicit credential reference for another catalog origin. Negative fixtures pass.
- [x] D09 Verify Switcher-owned API/SDK/CLI/MCP errors, generated configuration, argv, run metadata and sanitized live evidence do not expose credentials. Raw native stdout/PTY remains controlled by the native harness; Switcher does not promise to censor arbitrary native output.
- [x] D10 Ensure child harnesses receive only the credentials they require; strip unrelated fleet, provider and cloud secrets.

## E. Provider registry and built-in presets

Each preset must declare supported inference protocols, inference/catalog base URLs, catalog parser/pagination, auth style, credential aliases, metadata provenance and tested status. Static model names are not a replacement for discovery. A provider's optional endpoint must not be advertised before validation.

- [x] E01 Implement a shared typed provider registry exposed consistently by CLI, API and SDK; validate user endpoint overrides.
- [x] E02 DeepSeek built-in discovery uses its root models endpoint separately from Anthropic inference, preserves exact IDs and exposes unknown metadata. Registry live launches and the three-entry native catalog pass without manual import.
- [x] E03 OpenRouter preserves the all-modality catalog, exact IDs and metadata across declared M/R/C routes. Registry Codex returned 363 compatible IDs from 581 entries; direct and Ori bounded live cells pass.
- [x] E04 Implement Anthropic Messages auth/headers and paginated catalog; preserve known metadata and reject unsupported native-auth pooling. Authenticated 11-model discovery passes; direct paid inference is blocked by insufficient provider credits (X01).
- [x] E05 Implement distinct OpenAI Responses/Chat routes and catalog capability unknowns. Authenticated 133-model discovery and Codex/gpt-5-nano read/resume pass on historical candidate 453bc3d6; this is not a registry-3952926c provider replay.
- [x] E06 Implement xAI routes/catalog/auth with exact IDs. Authenticated 12-model discovery and native Grok read/deleted-file resume in owned tmux pass on historical candidate 453bc3d6; account/model entitlement is specific to those calls.
- [x] E07 Implement Ollama discovery, compatible endpoint/no-auth configuration and missing-server/model errors; deterministic contracts pass. An actual local deployment remains X03.
- [x] E08 Implement LM Studio compatible discovery and authenticated/credentialless configuration; deterministic contracts pass. Actual running-server acceptance remains X03.
- [x] E09 Implement vLLM explicit operator URLs and separately declared compatible routes; deterministic route/auth contracts pass. Actual deployment/model/tool-parser acceptance remains X03.
- [x] E10 Implement LiteLLM/custom gateway prefixes, independent discovery URL/auth and explicit protocols; deterministic authority and header contracts pass. Actual operator deployments remain X03.
- [x] E11 Implement documented presets/parsers for Mistral, Groq, Cerebras, Together, Fireworks, Moonshot/Kimi, DashScope/Qwen, Z.AI, MiniMax and SiliconFlow. Per-provider account/region/catalog prerequisites and incomplete live access remain X04; no entitlement is inferred from preset existence.
- [x] E12 Implement explicit native Gemini and Google-compatible Chat contracts, plus Azure v1 C/R literal api-key with deployment-aware/manual catalogs. Gemini live acceptance is separate from Google Chat/Azure access (X02). Bedrock/Vertex native identity remains X05; compatible gateways do not add cloud authentication.
- [x] E13 Provide the validated custom-provider path with explicit protocol/auth/catalog authority and capability fields; common domain/authority fixtures and documented custom-provider examples cover the extension seam.
- [x] E14 Record finite provider acceptance and account/deployment prerequisites in COMPATIBILITY. Execute authorized relevant cells; retain missing access as X01–X05, without claiming paid inference for every provider/model/harness permutation.

## F. Catalog discovery and model metadata

- [x] F01 Add independent catalog base URL/path and parser/auth metadata to the provider schema, API, generated SDK and both database upgrade paths.
- [x] F02 Normalize inference/version path conventions centrally; cover DeepSeek's split path, custom prefixes and optional version suffixes.
- [x] F03 Implemented bounded native OpenAI/Anthropic/Ollama/Gemini/Mistral/Together/Fireworks/DashScope catalog parsers and their documented pagination contracts; no usable catalog is claimed for unsupported endpoints.
- [x] F04 Verify refresh, retry/backoff, rate limits, bounded response/page sizes, cache freshness, offline behavior and upstream changes. Refresh uses at most two transient retries per catalog page, honors valid `Retry-After` delays, enforces 20-second request and 60-second aggregate deadlines, preserves the last committed snapshot on failure, and keeps launch fail-closed while cached model listing remains available offline. Loopback regressions cover HTTP-date and numeric delays, network recovery, terminal responses, oversized delays, pagination deadlines and snapshot retention.
- [x] F05 Preserve exact model IDs and remote/manual metadata provenance. Registry catalog equality and model selection verify IDs; no implicit model alias migration is performed.
- [x] F06 Populate capability/context/reasoning/modalities only from documented catalog fields or explicit overrides; leave unknowns unknown. Preserve Gemini generation methods and reject explicitly incompatible entries.
- [x] F07 Generate native catalogs from compatible entries and retain the complete provider catalog in CLI/API. Explicit incompatible Gemini generation methods are now excluded; unknown capabilities remain unknown. Upstream native listing/picker differences remain documented.
- [x] F08 Verify controlled native second-model requests retain exact model, provider and auth authority. Registry catalog and selection checks are separately recorded; Pro dry-run/picker selection without inference is not a paid request test.
- [x] F09 Reject missing/ineligible exact IDs and stale plan fingerprints with model_missing, model_ineligible or plan_changed; never silently substitute a renamed/removed model. No automatic alias migration or unsupported deprecation metadata is inferred.
- [x] F10 Manual catalogs remain explicit for custom/deployment providers; built-ins discover automatically where documented. Azure foundation-model definitions are never treated as deployment inventory.

## G. Native harness adapters

- [x] G01 Claude Code: native preset, compatible catalog/picker configuration, exact selected/default/subagent mapping and metadata warnings pass. Unknown context/reasoning stays unknown; native subscription credentials are not extracted or pooled.
- [x] G02 Claude Code: registry DeepSeek tool/read/deleted-file fresh resume passes; controlled Messages stream/cancellation/permission/config fixtures cover shared behavior. Anthropic paid account access remains X01.
- [x] G03 Codex: provider configuration, full compatible ModelInfo catalog, conservative reasoning/context mapping and exact selected IDs pass. Registry model/list returned all 363 eligible OpenRouter IDs; native subscription pooling remains D06.
- [x] G04 Codex: registry OpenRouter Responses and Ori task/resume pass; controlled direct/compatible Responses tools/stream/cancellation and routing isolation pass. Historical OpenAI/gpt-5-nano provider acceptance retains its original candidate identity.
- [x] G05 Grok: protocol-specific bridge/catalog/auth and exact model IDs pass with per-session isolation; registry DeepSeek and Ori/OpenRouter task/resume pass.
- [x] G06 Grok: bridge lifetime/resume and overlay cleanup pass. Launch-state removal occurs in a separate finally even when bridge cleanup rejects; owned-resource cleanup is independently verified.
- [x] G07 OpenCode 2: version/schema/package detection, full compatible provider catalog, stable provider identity and isolated configuration pass. Registry visual picker showed all three DeepSeek IDs and selected Pro without inference.
- [x] G08 OpenCode 2: all declared controlled wire/auth routes, hostile global/project/agent routing negatives, preserved native permissions and bridge-safe resume pass. Registry DeepSeek read/deleted-file resume retained the exact proof token with additional answer formatting.
- [x] G09 Preserve supported native cwd/settings, terminal resize/stdin/TTY, permission controls and exit status through the shared runner and native fixtures; reserve routing override flags using each native parser contract.
- [x] G10 Verify shared SIGINT/SIGTERM, timeout, failed spawn, bridge and finalization failures, plus adapter-specific lifecycle regressions and installed cleanup. No Windows parity or SIGKILL/escaped-process guarantee is claimed.
- [x] G11 Verify concurrent shared-database fixtures, independent profiles and native model/resume behavior without global provider mutation. Actual OMP/Prime registry processes overlapped for 2.569 seconds in separate homes; this is not shared-database paid-native concurrency.
- [x] G12 Document the existing adapter interfaces, version detection, protocols, catalog/authority preparation and cleanup/fixture acceptance in CONTRIBUTING-ADAPTERS.md.
- [x] G13 Inventory additional harnesses from Ori/local evidence and add explicit adapter tasks for supported launch interfaces; keep the named four mandatory.
- [x] G14 Published 0.1.1 Pi native adapter and registry DeepSeek tool/deleted-file same-session resume pass; remaining unverified interactive behavior is listed in COMPATIBILITY.
- [x] G15 Prime implementation, foreground supervision, short runtime fallback, native read/deleted-file resume, exact RPC catalog and second-model request pass; installed baseline DeepSeek acceptance passes. Final registry repetition passed K07.
- [x] G16 DeepSeek Harness: direct native `dsh` web/headless/ACP adapter with isolated catalog, all three wire protocols and persistent sessions/attachments. Installed official 0.1.2-rc.1 fixtures verify nine protocol/auth tool/resume cells and browser catalog/auth/trust/shutdown. SDK/custom profiles and Ori's setup-only command are rejected. Independent integration review and registry real-provider acceptance passed; image attachment round-trip remains unverified.
- [x] G17 Hermes Chat/Responses/Messages controlled read/resume and selected-provider inventory pass; installed baseline DeepSeek Chat read/resume passes. Built-in free/MOA rows remain visible. Native auxiliary title generation can warn HTTP400 on DeepSeek Chat json_schema; main execution and fallback naming work. Registry repetition passed K07.
- [x] G18 Legacy OpenCode 1.18.29 has its own executable/schema and reviewed permissions/argument contract. All three controlled protocol paths and installed baseline DeepSeek read/resume/catalog pass. Registry repetition passed K07.
- [x] G19 OMP 18.1.11 native catalog, model selection, six protocol/auth/no-auth paths and RPC switches pass; installed baseline DeepSeek read/deleted-file resume passes. Literal api-key Messages uses the public bridge. Registry repetition passed K07.
- [x] G20 Kilo 7.5.15 integration has exact independent source review reconciled to final source; all three controlled protocol paths, cancellation, permissions and installed baseline DeepSeek read/resume/catalog pass. Native project MCP may use the ephemeral bridge token; it never receives the upstream credential. Registry repetition passed K07.
- [x] G21 Cline 3.0.61 ACP permissioned tool loops, full catalog, three protocols and second-model request pass; installed baseline DeepSeek read/deleted-file resume passes. Registry repetition passed K07.
- [x] G22 Gemini CLI0.58.0 native generateContent implementation, routing/trust/config hardening, cancellation and controlled native catalog pass. Installed baseline Gemini Flash-Lite read/deleted-file resume passes. Final generation-method fix is independently reviewed; final archive catalog/read/deleted-file resume now passes; registry repetition passed K07.
- [x] G23 Aider 0.86.2 has independent review and 16 controlled native Chat/Responses/Messages edit/history/catalog launches; installed baseline DeepSeek edit/deleted-file history continuation passes. Responses is buffered and native listings include built-in definitions. Registry repetition passed K07; unclaimed platforms remain separate.

## H. Ori and protocol adaptation

- [x] H01 Inspect the installed Ori command contract/version and implement an optional built-in backend using supported interfaces (Codex/Grok subset; other pairs rejected explicitly).
- [x] H02 Validate Ori provider/model limits, executable mapping including opencode2, argument passthrough, exit codes and catalog ownership.
- [x] H03 Keep direct adapters available; reject unsupported Ori/provider combinations explicitly and never route DeepSeek through OpenRouter silently.
- [x] H04 Add Ori dry-run/configuration, subprocess tests and live acceptance with the installed package command.
- [x] H05 Declare exact M/R/C/G combinations and reject unsupported harness/protocol/backend pairs before native spawn. Ori remains the supported Codex/Grok OpenRouter subset.
- [x] H06 Implement required opt-in compatibility adapters or supported external gateways for missing native protocol combinations; no implicit translation/fallback.
- [x] H07 Verify shared same-wire stream ordering, opaque tool IDs/arguments/results, error/usage/reasoning forwarding and cancellation; adapter-specific mappings have native fixtures. No general protocol translator is shipped.
- [x] H08 Document and enforce changed-boundary payload contracts; opaque compatible-wire parallel tools/content are forwarded. Unknown multimodal capability stays unknown. Cross-provider session/reasoning migration, DSH image round-trip and universal advanced-feature parity remain unclaimed.

## I. API, SDK, storage and self-hosting

- [x] I01 Extend OpenAPI and generated SDK for provider registry, discovery settings, capabilities, credential references and launch diagnostics; verify drift.
- [x] I02 Verified SQLite/PostgreSQL data preservation through 0.1.0→0.1.1 and 0.1.1→final 0.1.2→0.1.1→0.1.2. Providers/profiles/catalogs/runs and generation-method metadata persist; old clients deliberately reject unsupported new writes.
- [x] I03 Preserve transactional plan fingerprints, optimistic concurrency, durable idempotency and referential integrity with all new provider/launch fields.
- [x] I04 Run the same contract suite against real SQLite and PostgreSQL, including concurrent process startup.
- [x] I05 Final archive Docker image passes SQLite/PostgreSQL health, restart persistence, upgrades, rollback/re-upgrade and owned cleanup. Existing user services and the Docker VM remain intact.
- [x] I06 Verify hosted/remote API use from a separate CLI process and prevent remote API requests from executing local commands without the local launcher.
- [x] I07 Resolve the deprecated contracts → secrets → events → paths dependency chain through the owning contract boundary; published Contracts 1.0.2 and independent ordinary consumer acceptance prove removal without overrides or legacy-peer flags.
- [x] I08 All 50 registry-installed files match reviewed bytes. CLI, serve, standalone MCP and Node/Bun SDK/API checks pass, including generation-method and negative error contracts. No Hasna MCP server was registered.
- [x] I09 Keep remote execution workers as a separately identified product architecture; account for authentication, worker enrollment and process ownership before advertising remote launches.

## J. Automated and live acceptance

- [x] J01 DeepSeek inference/catalog split is reproduced and fixed; installed 0.1.1 and expanded baseline launch through the built-in flow without a replacement catalog or external API setup.
- [x] J02 Add clean-environment subprocess tests for first launch, secure auth resolution, autostart, repeat launch, config persistence and remote-mode failure.
- [x] J03 Record all 24 advertised preset contracts and their deterministic direct/shared/parser/schema/negative evidence in the J03/J04 matrix. Shared implementations are tested at their common boundary; dedicated hosted-provider and operator-deployment live gaps remain explicit in X01–X05.
- [x] J04 Shared negative fixtures cover missing credentials, 401/403/404/429/5xx, unfinished streams, malformed catalogs, redirects and unavailable services. Revoked-versus-expired and stale/rotation diagnosis is not inferred from authorization errors; that extension remains D07.
- [x] J05 Maintain the finite COMPATIBILITY matrix with separately identified configured, controlled-native, real-provider, catalog/selection, resume and release outcomes; do not equate protocol fixtures with provider entitlement.
- [x] J06 Run DeepSeek + Claude via the installed `switcher` command in ephemeral tmux with no external supervisor or catalog import; verify full native list, model change and proof-file tool loop.
- [x] J07 Complete the finite required four-harness DeepSeek/OpenRouter registry paths plus Ori, and retain separate OpenAI/xAI historical direct-provider evidence. Other account/local-deployment acceptance remains X01–X05; fixtures are not cloud entitlement evidence.
- [x] J08 Run the optional Ori backend through the installed CLI and verify its declared model/provider boundaries.
- [x] J09 Pass real SQLite/PostgreSQL contracts and exact-runtime Compose persistence/upgrade/rollback tests, shared-database concurrency fixtures, native interruption/resume and installed cleanup. Actual concurrent paid-native runs used separate homes/databases.
- [x] J10 Use approved runtime credential resolution and bounded live prompts; record Anthropic insufficient credits and absent/unsuitable other account/deployment access explicitly. No key rotation or automatic account switch occurred.
- [x] J11 Preserve the user's existing DeepSeek session; use separate task-owned tmux sockets, directories, databases and ports for acceptance.
- [x] J12 Verify the documented direct launch path through the normal installed command with fresh isolated configuration, built-in discovery and owned API; native executable installation and approved credential binding are explicit prerequisites.

## K. Ship and close — expanded 0.1.2

Published 0.1.2 completed the source/publication gates. Final registry and documentation closure are recorded separately.

- [x] K01 Independent revised source/artifact reviews approve source 61c0ca1b and archive 3952926c after the SDK error-reflection correction, catalog retry checks and native-installation guidance review.
- [x] K02 Published source passes 167 package tests / 1,799 assertions with PostgreSQL/native opt-ins, 147 root tests / 560 assertions, 43 affected builds and generated/type/artifact/conformance/frozen-lock guards.
- [x] K03 Apply only the owned Changesets patch to 0.1.2, update changelog/version/generated API and reproducible root/app lockfiles; unrelated main package versions remain intact.
- [x] K04 Required staged scans passed before source commits/pushes; PR #1836 merged source 61c0ca1b as 24681fa7 after all nine checks succeeded. Documentation follow-up gates are K08.
- [x] K05 Announced intent, verified version absence, published with npm via protected vault injection and verified 2026-09-06T16:47:17.965Z timestamp and archive SHA-1 3952926c.
- [x] K06 Normal installed switcher/serve/mcp commands report 0.1.2. Ordinary npm resolved Contracts 1.0.2 without optional Secrets/Events/Paths; all 50 files match; prior install and quarantine are preserved.
- [x] K07 All 14 native adapters plus two Ori paths passed task/deleted-file fresh-process continuation on registry archive 3952926c, using the actual installed CLI and owned tmux. Full package identity and native catalog/selection boundaries are recorded in COMPATIBILITY and the evidence index.
- [x] K08 Reconcile PLAN/TODOS/COMPATIBILITY/evidence and add the adapter contribution contract. Independent documentation review and package allowlist/50-file identity checks are recorded; this documentation PR supplies the final CI/merge record.
- [x] K09 Confirm publication and the final 16-path registry matrix in the required thread/task; verify owned native acceptance resources are gone and preserve the original user DeepSeek session.
- [ ] K10 Terminal handoff: close the external task/goal after this documentation PR merges. Source, publication and installed matrix gates have passed; the terminal status is recorded in task 1fb71b94-93b1-466f-a44b-0bcdaa710804 and the goal, without rewriting immutable release evidence.

## External acceptance prerequisites

These are unverified access/deployment cells, not passing tests or unfinished compatible-wire adapter implementations. The finite release goal explicitly retains missing credentials as visible prerequisites.

- [ ] X01 Anthropic paid native Claude acceptance: the authorized attempt returned insufficient credits before any tool work. No retry, account switch or billing change is authorized by a generic quota-reset message.
- [ ] X02 Azure real resource/deployment inventory and Google-compatible Chat account acceptance: fixtures pass; the actual deployment/route is unverified.
- [ ] X03 Ollama, LM Studio, vLLM and LiteLLM/operator gateways: supply reachable configured deployments with installed models and actual native tool capabilities before live acceptance.
- [ ] X04 Remaining provider-specific accounts: obtain purpose-appropriate usable access and required region/workspace/catalog information. Archived or other-project catalog access does not authorize paid inference.
- [ ] X05 Native Bedrock/Vertex identity and invocation adapters: separate cloud-auth extension requiring verified identity, region/project/location and model permissions; compatible gateways are the current explicit integration boundary.

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
- [x] Expanded adapters are implemented and published in 0.1.2; their exact installed acceptance is K07.
- [x] Published in 0.1.1: optional Ori Codex/Grok OpenRouter backend; direct adapters remain available.
- [ ] Add protocol translators only with explicit feature contracts and streaming tests.
- [ ] Add remote execution workers only as a separately authorized product scope.
