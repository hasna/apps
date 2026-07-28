# OpenAutomations Repo And Package Plan

Date: 2026-07-07

This plan records the current shipped `@hasna/automations` repository state
after the 2026-06-28 scaffold and follow-up publish work. It supersedes the
older pre-scaffold planning note that assumed no daemon existed yet.

## Current State

- Package: `@hasna/automations` version `0.1.3`.
- License and OSS files: Apache-2.0 `LICENSE`, `README.md`, `SECURITY.md`, and
  `CONTRIBUTING.md` are present and included in the npm package file allowlist.
- Runtime target: Bun ESM package with TypeScript declarations emitted into
  `dist`.
- Current Hasna package dependency: `@hasna/actions` is the only shipped peer
  and local dev dependency. There is no direct package dependency on
  `@hasna/events`, `@hasna/loops`, `@hasna/connectors`, or `@hasna/cloud` on
  the GitHub `main` base for this plan.
- Product ownership: OpenAutomations owns automation specs, trigger
  materialization, durable automation runs, deterministic queued action rows,
  approval gates, DLQ/replay, webhook route metadata, and daemon leases.
- Non-goals: OpenAutomations does not own agent workflow admission, task or PR
  queues, external provider credentials, or cross-app durable event history.

The shipped scaffold is a real product surface, not a placeholder. The daemon
is part of the current package and should not be removed without a separate
implementation task and release plan.

## Package Exports

`package.json` currently publishes these import subpaths:

- `@hasna/automations`: primary SDK entrypoint from `src/index.ts`.
- `@hasna/automations/store`: local durable store implementation.
- `@hasna/automations/paths`: data-directory and daemon path helpers.
- `@hasna/automations/runtime`: runtime binding descriptors, currently for
  OpenLoops handoff.
- `@hasna/automations/cli`: CLI runner entrypoint for tests and embedding.
- `@hasna/automations/daemon`: daemon runner and webhook server entrypoint.

Keep the root export as the default supported SDK surface. The subpath exports
are useful for integration tests and targeted embedding, but future expansion
should avoid turning CLI or daemon internals into a broad compatibility
promise. Add new subpaths only when they map to a stable integration boundary.

Current package metadata needs one follow-up decision before the next publish:
the worktree remote is `https://github.com/hasna/automations.git`, while the
package `repository`, `homepage`, and `bugs` URLs point at
`hasna/open-automations`. Confirm the canonical GitHub repository name and
align package metadata in a focused implementation task.

## CLI Bin Surface

The package currently exposes two bins:

- `automations`: primary operator CLI.
- `automations-daemon`: daemon CLI.

The `automations` CLI should remain the stable local operator surface for:

- `status` and `init`.
- `spec example`.
- `validate`, `create`, `list`, and `simulate`.
- `queue claim`, `queue complete`, `queue fail`, `queue approve`, and
  `queue reject`.
- `dlq list` and `dlq replay`.
- `webhooks create`, `list`, `show`, `enable`, `disable`, `archive`,
  `rotate-secret`, `test`, and `event`.
- `runtimes`.

The `automations-daemon` CLI should remain the stable daemon surface for:

- `status`.
- `run`, including `--once` for tests and smoke checks.
- `serve` for signed HTTP webhook ingress.

Do not add scheduler or agent workflow commands to the Automations CLI. Those
belong in OpenLoops. If Automations needs to trigger an agentic workflow, it
should expose a deterministic queue row or an explicit event-envelope handoff
that another runtime consumes.

## SDK Surface

The root SDK currently re-exports:

- All public domain and runtime types from `src/types.ts`.
- `AutomationsStore`, `exampleAutomationSpec`,
  `normalizeWebhookRequestToEvent`, and `validateAutomationSpec`.
- Store helper types such as `AutomationsStoreOptions`,
  `CreateWebhookRouteInput`, and `EnqueueActionInput`.
- Path helpers such as `automationsDataDir`, `automationsDbPath`,
  `daemonLogPath`, `daemonPidFilePath`, and `ensureAutomationsDataDir`.
- Runtime binding helpers `createOpenLoopsRuntimeBinding` and
  `listDefaultRuntimeBindings`.

Keep `EventEnvelopeLike` structural. That lets OpenEvents deliveries enter
Automations without making OpenEvents durable storage or transport APIs part of
the core Automations dependency graph. Keep queued action invocation and result
types aligned with `@hasna/actions`; actions are the core contract layer for
what Automations materializes and workers execute.

Future SDK work should split along stable boundaries:

- A recipe/compiler layer can be added after the domain model task lands.
- An optional OpenEvents adapter can compile subscriptions or normalize
  deliveries, but should not make OpenEvents the source of durable automation
  state.
- An optional OpenLoops adapter can claim queue rows or consume exported event
  envelopes, but should not make Automations call agent workflows implicitly.
- Optional connector/provider adapters can resolve external capabilities into
  action manifests or secret references, but Automations should not own raw
  connector credentials.

## MCP Plan

There is no shipped `automations-mcp` bin, no `./mcp` export, and no direct
MCP dependency in `@hasna/automations` today. That is intentional for the
current scaffold.

Defer MCP implementation to the existing MCP/dashboard planning task after the
CLI and SDK contracts stabilize. Until that task lands, the MCP placeholder is
documentation only: consumers should use the CLI, SDK, daemon HTTP webhook
surface, or explicit OpenLoops handoff.

If an MCP server is later added, it should be a separate bin and subpath export
with a narrow tool set over stable Automations operations. It should not bypass
queue leases, approval gates, DLQ behavior, secret-reference rules, or runtime
ownership boundaries.

## Dependency Direction

### `@hasna/actions`

Direction: core dependency.

OpenAutomations depends on OpenActions for portable action contracts, action
queue status, invocation, approval, result, error, and DLQ types. This
dependency is correctly represented as the package peer and local dev
dependency. Keep this as the main contract between automation materialization
and deterministic execution.

### `@hasna/events`

Direction: upstream ingress and optional adapter boundary.

OpenEvents is trigger ingress. OpenAutomations should continue accepting
OpenEvents-compatible envelopes structurally through `EventEnvelopeLike` and
webhook normalization. It should not own OpenEvents channels, replay logs,
transport configuration, or event storage. A later compiler task may generate
OpenEvents subscriptions or an adapter package, but the Automations core should
not depend on OpenEvents unless that task proves a stable contract is needed.

### `@hasna/loops`

Direction: optional runtime and workflow handoff boundary.

OpenLoops owns agent workflow invocation, admission, run artifacts, and loop
scheduling. OpenAutomations may expose deterministic action queue rows that an
OpenLoops worker claims, or export normalized event envelopes for explicit
operator routing into `loops events handle generic`. OpenAutomations should not
embed OpenLoops scheduling or control-plane logic.

### `@hasna/connectors`

Direction: external provider and credential boundary.

OpenConnectors owns connector installation, provider-specific API clients,
MCP/server surfaces, and credential lifecycle. OpenAutomations should reference
action ids, input payloads, and secret references rather than importing
Connectors directly. A later adapter can translate connector capabilities into
OpenActions manifests or action execution bindings, but raw connector secrets
must stay outside Automations state.

### `@hasna/cloud`

Direction: not a current package dependency.

The GitHub `main` base for this plan uses `bun:sqlite` directly in the store
and does not declare `@hasna/cloud` in `peerDependencies` or `devDependencies`.
Do not add `@hasna/cloud` from this planning task. If a later storage-boundary
task wants shared storage adapters, it should add a deliberate adapter plan,
dependency decision, docs update, validation, and release note.

## Docs And Tests

Current docs:

- `README.md` documents package install, SDK example, CLI commands, daemon
  commands, data-root overrides, product boundaries, runtime model, webhook
  ingress, and explicit OpenLoops handoff. Its install example matches the
  current package peer dependency shape: `@hasna/automations` plus
  `@hasna/actions`.
- `CONTRIBUTING.md` records Bun validation and the rule that runtime
  integrations must not move product ownership into OpenLoops.
- `SECURITY.md` records private reporting and secret-reference expectations.
- This plan documents the current package and integration direction.

Current test coverage:

- Store initialization, status, automation spec persistence, event
  materialization, queue rows, replay requests, daemon heartbeat, webhook
  routes, idempotency, dependencies, approval gates, stale runner guards, and
  spec validation.
- CLI help, status, spec examples, daemon status/run, concurrent fresh DB
  initialization, create/list/simulate/claim/fail/replay, runtime listing, and
  webhook route commands.
- Daemon HTTP webhook serving, raw-body HMAC verification, and deterministic
  failure responses.

Recommended validation for package-surface changes:

```sh
bun test
bun run typecheck
bun run build
bun run src/cli/index.ts --help
bun run src/daemon/index.ts --help
git diff --check
```

Before any commit or publish, also run the staged secrets scan required by the
repository workflow.

## Follow-Up Map

Keep these existing planning and implementation tracks:

- `4e9e2f9d`: define the AutomationRecipe domain model.
- `2bacc4b1`: design the compiler to OpenEvents and OpenLoops boundaries.
- `1459a133`: design approval and policy flow.
- `feae83a6`: design Automations CLI and SDK evolution.
- `dc48c754`: plan MCP and dashboard after CLI stabilization.
- `40cefcfe`: design observability and audit timeline.
- `d6dd5932`: adopt shared contract types for work runs, decisions, and
  evidence references.
- `60b574ab`: converge deterministic queue handoff and `loops events handle`
  reaction paths without merging product ownership.
- `1248913a`: wire schedule, manual, and API triggers.
- `050a9c85`: implement per-step `when` condition evaluation.
- `54eecc38`: investigate duplicate packed `dist/cli/index.js` listing.
- `20a990d1`: add repeatable webhook release smoke checks.

Create or keep one focused follow-up for the metadata discrepancy if no
deduped task already exists:

- Align `@hasna/automations` package repository, homepage, and bugs URLs with
  the canonical GitHub remote before the next publish.

Do not mutate `open-actions`, `open-events`, `open-loops`, or
`open-connectors` from this repository plan. Cross-repo integration work should
be tracked as separate todos tasks with explicit acceptance criteria and
dedupe fingerprints.
