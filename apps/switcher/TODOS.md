---
id: "switcher-todos"
title: "Switcher implementation and release checklist"
type: "task-checklist"
owner: "codex-fixer"
created_at: "2026-09-05T12:35:04.768Z"
updated_at: "2026-09-05T15:00:05.316596+00:00"
status: "released"
source_task: "01a07181-ca8d-70c1-99a2-b276dc5770f3"
---

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

Current verification details and limitations are recorded in `RELEASE.md`. Container manifests have been parsed; a Docker engine is unavailable on this station, so container runtime verification remains open.

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
