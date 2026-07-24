# @hasna/machines

Machine fleet management for developers — provision, sync, inspect, and operate multiple development machines from CLI and MCP.

## Binaries

- `machines`: Commander-based CLI for manifest, setup, sync, inspection, and dashboard commands
- `machines-mcp`: MCP server exposing fleet tools to AI agents
- `machines-agent`: lightweight local daemon for heartbeats and runtime reporting

## HTTP mode

Long-lived Streamable HTTP transport for shared agent connections (stdio remains the default):

```bash
machines-mcp --http
# or: MCP_HTTP=1 machines-mcp
# default port: 8821 (override with --port or MCP_HTTP_PORT)
```

Endpoints on `127.0.0.1` only:

- `GET /health` → `{"status":"ok","name":"machines"}`
- `POST /mcp` → MCP Streamable HTTP

HTTP mode rejects browser requests with untrusted `Origin` headers, caps JSON
bodies at `MACHINES_HTTP_MAX_BODY_BYTES` (default 1 MiB), and requires either
`MACHINES_API_KEY` or loopback-only `MACHINES_ALLOW_UNAUTHENTICATED=1`. Use
`MACHINES_HTTP_ALLOWED_ORIGINS=https://ops.example` for an explicit browser
origin allowlist.

## Manifest

`machines.json` is the desired fleet declaration.

```bash
machines manifest init
machines manifest bootstrap
machines manifest add --id linux-dev-01 --platform linux --workspace-path ~/workspace
machines manifest add --id linux-dev-01 --friendly-name "Linux Dev" --platform linux --workspace-path ~/workspace
machines manifest add --id mac-lab-01 --platform macos --workspace-path ~/Workspace --app ghostty:cask
machines manifest friendly-name get linux-dev-01 --json
machines manifest friendly-name set linux-dev-01 "Linux Dev" --approval-token "$TOKEN" --json
machines manifest friendly-name clear linux-dev-01 --approval-token "$TOKEN" --json
machines manifest validate
machines manifest list
```

`id` is the stable machine slug and must not be changed for display purposes.
Use `friendlyName` for user-facing labels. Consumers should display the
topology `display_name` field, which is computed as `friendly_name` when set
and `machine_id` otherwise. Setting or clearing `friendlyName` updates the
machine `updatedAt` timestamp and requires the same scoped mutation approval
model as other manifest writes.

Public packages should keep private fleet state behind an opaque source/ref
boundary. `HASNA_MACHINES_PRIVATE_MANIFEST_REF` (or
`MACHINES_PRIVATE_MANIFEST_REF`) may point at a private backend, but
open-machines only reports the redacted ref and falls back to the local
`machines.json` unless a caller supplies a manifest adapter. The adapter
contract is backend-agnostic and lives in the package root exports; it does not
pull in secrets managers, storage SDKs, or org-specific fleet internals.

## Provision and reconcile

```bash
machines setup --machine linux-dev-01
machines setup --machine linux-dev-01 --json
machines setup --machine linux-dev-01 --apply --yes
machines sync --machine linux-dev-01 --json
machines sync --machine linux-dev-01 --apply --yes
machines doctor --machine linux-dev-01
machines self-test
```

`machines setup` is a dry-run plan by default. The generated playbook favors
idempotent operations (`mkdir -p`, command-existence guards, package-manager
installs) and only executes when both `--apply` and `--yes` are provided.
The default plan also adds update-check/download settings without enabling
automatic OS installation: Linux uses apt periodic download-only settings, and
macOS uses `softwareupdate`/`defaults` with `AutomaticallyInstallMacOSUpdates`
left disabled.
`doctor --json` includes public-safe source/ref diagnostics plus optional
adapter hook results for secrets, configs, monitors, repos, MCPs, and shield
checks. When no adapter is configured, those checks report a skipped fallback
instead of importing private dependencies.
It also reports noninteractive sudo readiness, SSH certificate support, and
GitHub App secret-reference readiness without printing credentials or private
keys.
`machines self-test --json` includes `overall` and `counts` fields so agents
can branch on readiness without scanning every check.

Apple device management belongs in the private deployment layer. The public
setup plan can report enrollment status with `profiles status -type enrollment`,
but it does not enroll devices, install profiles, or publish team identifiers.

## Topology SDK

`@hasna/machines` exposes a compact consumer SDK for other open-core packages
that need machine identity without importing CLI, MCP, agent, installer, or
storage-heavy internals. Consumers that only need the stable app-to-app contract
should import `@hasna/machines/consumer`:

```ts
import {
  MACHINES_CONSUMER_CONTRACT,
  createMachineResolverSnapshot,
  discoverMachineTopology,
  getBrowserPlanFleet,
  getMachineDetails,
  getLocalMachineTopology,
  listMachineTrashPolicies,
  resolveNoteMachineContext,
  resolveMachineRoute,
  resolveMachineWorkspace,
  validateMachinesConsumerEnvelope,
} from "@hasna/machines/consumer";

console.log(MACHINES_CONSUMER_CONTRACT.schema_version);
const topology = discoverMachineTopology();
const local = getLocalMachineTopology();
const details = getMachineDetails("linux-dev-01");
const browserPlanFleet = getBrowserPlanFleet();
const route = resolveMachineRoute("linux-dev-01");
const workspace = resolveMachineWorkspace({
  machineId: "linux-dev-01",
  projectId: "open-knowledge",
  repoName: "open-knowledge",
});
const snapshot = createMachineResolverSnapshot({ route, workspace });
console.log(validateMachinesConsumerEnvelope("resolver_snapshot", snapshot).ok);
```

The SDK merges manifest entries, local heartbeats, SSH route hints, and
`tailscale status --json` peers when Tailscale is available. Consumers such as
`@hasna/knowledge` should treat this package as optional: dynamically import it
when present, and fall back to local probes or app-local machine registries when
it is absent.

Topology, route, workspace, compatibility, and resolver-snapshot JSON include
`schema_version`, package version metadata, capability flags, and cacheability
metadata where downstream apps may persist resolver evidence. The current
consumer contract version is `1`; the exported `MACHINES_CONSUMER_CONTRACT`
records the stable entrypoint, envelope names, schema artifact, field
capabilities, default resolver TTL, and stable exports used by downstream apps
such as `@hasna/knowledge`.

### Agent loop preflight APIs

Agents and scheduled loops should use the compact preflight APIs before writing
custom shell probes. These commands print bounded JSON by default; pass
`--text` for a human summary and `--all` or `--limit/--offset` for pagination.
Private route targets and shell commands remain redacted unless
`--private-metadata` is used on a trusted local surface.

```bash
machines loop-preflight --machine control,worker --cmd 'bun test' --no-tailscale
machines machine-health --project open-machines --repo open-machines
machines routing --machine worker
machines command-matrix --machine worker --cmd 'bun run build'
machines dispatch-smoke --json
machines ops check --all --expect-machine spark01,spark02,apple03 --text
```

The matching SDK exports are `getFleetLoopPreflight()`,
`getFleetMachineHealth()`, `getFleetRouting()`, `getCommandMatrix()`, and
`getDispatchFleetSmoke()`.
The matching MCP tools are `machines_loop_preflight`,
`machines_machine_health`, `machines_routing`, `machines_command_matrix`, and
`machines_dispatch_fleet_smoke`. The loop/health/routing/matrix reports include
`pagination`, `artifacts`/detail refs, compact per-machine rows, and warnings;
the dispatch smoke report uses a fixed bounded target set and includes
per-machine package, route, and daemon-readiness rows.

`machines dispatch-smoke` is a no-mutation diagnostic for open-dispatch
self-healing. It checks the default affected fleet (`local`, `spark01`,
`spark02` through a direct SSH alias when applicable, and `apple03`) while
ignoring `apple01` unless explicitly requested. The JSON envelope includes
`dryRun=true`, `mutates=false`, redaction metadata, per-machine route health,
installed `@hasna/dispatch` command/version status, daemon status output, and
daemon restart readiness without running the mutating restart command.

For `loop_preflight`, top-level `ok` means every machine in the current
selection/page is ready. Candidate schedulers that only need one usable target
should read `summary.any_ready`; strict fleet loops should read
`summary.all_ready`.

`machines ops check` composes health, routing, loop-preflight, and read-only
tmux diagnostics into a loop-safe fleet report. By default it only prints
bounded task suggestions and never mutates tmux or todos. Scheduled loops that
should create remediation tasks must opt in explicitly:

```bash
machines ops check \
  --all \
  --expect-machine spark01,spark02,apple03 \
  --expect-tmux spark01=hasna:1.1 \
  --text \
  --upsert-tasks \
  --todos-project /home/hasna/.hasna/loops \
  --max-task-actions 20
```

Task upserts are deduped with stable `dedupe-*` tags, use argv-safe `todos`
subprocess calls, require `--todos-project`, and remain diagnostic-only: they do
not send keys, kill panes, resurrect panes, or route work through tmux.

Machine data loops should use package commands instead of local shell scripts.
`machines ops db-integrity` scans bounded local roots for SQLite databases and
runs read-only `sqlite3` quick checks. `machines ops state-snapshot` plans
snapshots by default and only writes private snapshot files when `--apply` is
passed. Snapshot writes fail closed unless `sqlite3 .backup` succeeds and the
created snapshot passes verification; the command does not copy live database
files as a fallback because that can lose WAL data.

```bash
machines ops db-integrity \
  --root /home/hasna/.hasna,/home/hasna/.codewith \
  --max-dbs 500 \
  --max-size-bytes 2147483648 \
  --report-dir /home/hasna/.hasna/loops/reports/critical-db-integrity-compact \
  --upsert-tasks \
  --todos-project /home/hasna/.hasna/loops \
  --task-list machine-data-db-integrity \
  --max-task-actions 10 \
  --text

machines ops state-snapshot \
  --root /home/hasna/.hasna,/home/hasna/.codewith \
  --snapshot-root /home/hasna/.hasna/loops/snapshots/ops-state \
  --report-dir /home/hasna/.hasna/loops/reports/ops-state-snapshot \
  --max-dbs 200 \
  --max-size-bytes 805306368 \
  --keep-days 14 \
  --apply \
  --upsert-tasks \
  --todos-project /home/hasna/.hasna/loops \
  --task-list machine-data-state-snapshot \
  --max-task-actions 10 \
  --text
```

Both commands write private JSON reports, avoid printing secret values, keep
task creation bounded by default and with `--max-task-actions`, collapse a
missing `sqlite3` dependency into one environment task, and are safe to run from
OpenLoops without tmux dispatch. The default scans are intentionally bounded;
increase `--max-depth`, `--max-dbs`, `--max-size-bytes`, or
`--max-task-actions` only when the loop timeout and report size can absorb the
larger scan.

### Hasna Notes machine list contract

Hasna Notes and similar sidebar consumers should read machine lists from
`discoverMachineTopology()` or `GET /api/topology`. The list defaults to the
latest 10 machines ordered by `updated_at` descending. For View more, pass
`limit` and `offset`:

```bash
machines topology --json
machines topology --limit 10 --offset 10 --json
curl 'http://127.0.0.1:7676/api/topology?limit=10&offset=10&tailscale=false'
```

Each `topology.machines[]` row includes:

- `machine_id`: stable slug/id. Use this for storage, links, mutations, and route/workspace calls.
- `friendly_name`: user-set label or `null`.
- `display_name`: `friendly_name` when present, otherwise `machine_id`. Use this in UI.
- `updated_at`: best known ordering timestamp from manifest updates, heartbeat updates, or live peer data.

The `topology.pagination` object includes `limit`, `offset`, `total`, `count`,
`hasMore`, `nextOffset`, plus snake-case aliases `has_more` and
`next_offset`. Render the first page by default, and request the next page with
`offset=nextOffset` when `hasMore` is true. Callers that explicitly need every
machine can pass `limit: null` in the SDK or `all=true` to the HTTP API, but UI
lists should keep the latest-10 default.

Friendly names can be read and changed through the CLI, SDK, dashboard API,
and MCP:

```bash
machines manifest friendly-name get linux-dev-01 --json
machines manifest friendly-name set linux-dev-01 "Linux Dev" --approval-token "$TOKEN" --json
machines manifest friendly-name clear linux-dev-01 --approval-token "$TOKEN" --json
```

HTTP dashboard API:

- `GET /api/machines/friendly-name?machine=linux-dev-01`
- `POST /api/machines/friendly-name` with `machine_id`, `friendly_name`, and a scoped `approval_token`
- `DELETE /api/machines/friendly-name?machine=linux-dev-01` with a scoped approval token

MCP tools expose the same contract as `machines_friendly_name_get`,
`machines_friendly_name_set`, `machines_friendly_name_clear`, and
`machines_topology` with `limit` and `offset` arguments.

### Hasna Notes ownership and provenance contract

Open-machines does not own note storage. It does expose machine identity,
display-name, sync-target, actor provenance, and per-machine trash metadata that
Hasna Notes can attach to its own note records.

Use `resolveNoteMachineContext()` when a note is created, synced, or rendered in
a unified view:

```ts
const context = resolveNoteMachineContext({
  originMachineId: "linux-dev-01",
  sourceMachineId: "agent-runner-01",
  targetMachineId: "macbook-local",
  syncTargetMachineIds: ["macbook-local"],
  actor: {
    actor_type: "agent",
    agent_id: "notes-agent",
    agent_name: "Notes Agent",
    source: "agent",
  },
});
```

The `note_machine_context` envelope includes these stable fields:

- `origin_machine_id`: machine that owns/originated the note.
- `source_machine_id`: machine where the note event or sync source came from; defaults to `origin_machine_id`.
- `target_machine_id`: machine the note is being synced to, when applicable.
- `origin_machine`, `source_machine`, `target_machine`: references with `machine_id`, `friendly_name`, `display_name`, `updated_at`, `known`, and `manifest_declared`.
- `sync_target_machine_ids` and `sync_targets`: machines that should receive or display synced copies.
- `actor`: `actor_type`, `actor_id`, `actor_name`, `agent_id`, `agent_name`, `source`, and `display_name`.

Consumers should render machine labels from each reference's `display_name`,
which already falls back to `machine_id`. If a note references a machine that is
not currently in topology, the reference still uses the requested machine id,
sets `known: false`, and adds a warning such as
`unknown_machine:sync_target:linux-dev-99`.

For per-machine trash metadata, use `listMachineTrashPolicies()`:

```ts
const trash = listMachineTrashPolicies({ limit: 10, offset: 0 });
```

Each `machine_trash_policies.policies[]` row includes `machine_id`,
`friendly_name`, `display_name`, `updated_at`, `enabled`, `retention_days`,
`delete_after_days`, `trash_path`, `source`, and `metadata_keys`. The list uses
the same `pagination` object as topology. Manifest metadata can provide policy
settings under `metadata.notes_trash`, `metadata.notesTrash`,
`metadata.note_trash`, `metadata.noteTrash`, or `metadata.trash`; camelCase and
snake_case retention fields are accepted. Missing metadata returns
`source: "default"` with nullable settings so Hasna Notes can apply its own
default policy.

Equivalent read-only surfaces:

```bash
machines notes context --origin-machine linux-dev-01 --source-machine agent-runner-01 --actor-type agent --agent-name "Notes Agent" --source agent --json
machines notes trash-policies --limit 10 --offset 0 --json
curl 'http://127.0.0.1:7676/api/notes/machine-context?origin_machine_id=linux-dev-01&source_machine_id=agent-runner-01&actor_type=agent&agent_name=Notes%20Agent&source=agent'
curl 'http://127.0.0.1:7676/api/notes/trash-policies?limit=10&offset=0'
```

MCP exposes `machines_notes_context` and `machines_notes_trash_policies` with
the same field names. These fields are the coordination contract for open-notes:
store stable ids in note records, show `display_name`, and use pagination
metadata for any machine-backed lists.

### Hasna Notes machine details contract

For right-click View details, Hasna Notes should call `getMachineDetails(id)`,
`GET /api/machines/details?machine=<id>`, `machines details --machine <id>
--json`, or MCP `machines_details`.

The `machine_details` envelope is a friendly, consumer-safe view. It includes:

- `machine_id` and `slug`: stable machine id for storage and links.
- `friendly_name` / `friendlyName`: present only when a user label is set.
- `display_name` / `displayName`: always present; uses friendly name first, then `machine_id`.
- `known`: whether open-machines found the machine in topology.
- `status`: `state`, neutral `label`, `online`, and optional seen timestamps.
- `platform`, `machine_type`, `role`, `roles`, `machine_capabilities`, and `tags` when known.
- `updated_at`, `last_seen_at`, and `timestamps.recent_sync_at` / `recent_sync_status` when known.
- `source`: `authority`, `metadata_source`, `manifest_declared`, `heartbeat_present`, `topology_entry`, and `local`.
- `display_metadata`: only safe whitelisted display metadata such as type, role, owner, team, region, environment, and capabilities.

Fallback behavior:

- UI label: render `display_name`; it already falls back from friendly name to slug/id.
- Status: when no heartbeat or online signal is known, render `status.label` as `Unknown`.
- Optional fields are omitted when absent rather than filled with raw/internal data.
- Missing machines still return `machine_id`, `slug`, `display_name`, `known: false`, neutral unknown status, and `unknown_machine:details:<id>` in `warnings`.

Raw route targets, hostnames, local paths, secrets, private heartbeat details,
and sensitive metadata keys are not part of the default details view.

### BrowserPlan fleet contract

Open-chrome owns BrowserPlan. Open-machines exposes the stable machine/fleet
contract that BrowserPlan can consume to select targets and route BrowserPlan-
owned remote commands:

```ts
const fleet = getBrowserPlanFleet({
  machineIds: ["machine001", "machine002"],
  includeTailscale: false,
  includeInstallState: false,
});
```

Equivalent read-only surfaces:

```bash
machines browserplan fleet --json
machines browserplan fleet --machine machine001,machine002 --json
machines browserplan fleet --machine machine001 --check-installs --json
curl 'http://127.0.0.1:7676/api/browserplan/fleet?machine=machine001,machine002'
```

MCP exposes the same envelope as `machines_browserplan_fleet` with
`machine_ids`, `include_tailscale`, and `check_installs` arguments.

The `browserplan_fleet` envelope includes:

- `target.name`: `browserplan-machine001-machine011`.
- `target.machine_ids`: the full BrowserPlan target ids `machine001` through `machine011`.
- `target.excluded_machine_ids` / `install_target_excludes`: `spark01` and `spark02`.
- `coverage`: `expected`, `returned`, `known`, `missing`, `unreachable`, and `excluded_requested`. When `machineIds` filters are supplied, `expected` is the selected BrowserPlan target count; `target.machine_ids` still documents the full fixed target.
- `machines[]`: `machine_id`, `slug`, `friendly_name` / `friendlyName`, `display_name` / `displayName`, `known`, `eligible`, `eligibility_reasons`, `platform`, `os`, `user`, `workspace`, `tags`, `updated_at`, `status`, `reachability`, `daemon`, `install_state`, `operation_hooks`, and `warnings`.
- `operation_contract.stable_surfaces`: SDK, CLI, API, and MCP names that expose this shape.

Machine ids are unambiguous. `machine001` and `machine002` are BrowserPlan fleet
targets and are distinct from `spark01` and `spark02`. `spark01` and `spark02`
are never returned as BrowserPlan machines; if requested, they appear in
`coverage.excluded_requested` with a warning.

For UI labels, render each machine's `display_name`; it already falls back from
friendly name to stable id. `status.label` uses `Online`, `Offline`, or neutral
`Unknown`. Optional metadata is omitted or nullable when open-machines does not
know it.

`operation_hooks` are contracts, not command execution. BrowserPlan/open-chrome
owns the concrete remote commands for profile setup, headed launch, headless
launch, daemon/supervisor status, tab/session inventory, and app install/update.
Open-machines owns route resolution and exposes the safe runner pattern:
`runMachineCommand()` in the SDK, `machines ssh --machine <id> --cmd
<browserplan-owned command> --json` in the CLI, and MCP `machines_ssh_resolve`.
Private route details are still omitted unless a trusted local operator surface
opts into private metadata.

Install state is cheap by default: `install_state.checked` is `false` and
capabilities are `unknown`. Callers that need BrowserPlan/chrome/bun/git state
must opt in with SDK `includeInstallState: true`, CLI `--check-installs`, API
`check_installs=true`, or MCP `check_installs: true`; remote probe failures
return warnings and blocked hooks instead of throwing.

The package includes `schemas/machines-consumer.schema.json` and also exports
`MACHINES_CONSUMER_SCHEMA_BUNDLE`, `getMachinesConsumerSchemaBundle()`, and
`validateMachinesConsumerEnvelope()`. Downstream apps can use these helpers to
validate topology, route, workspace, compatibility, resolver-snapshot,
project-assignment, note-machine-context, machine-trash-policy, and
machine-details, and BrowserPlan fleet envelopes
without importing CLI, MCP, agent, installer, or storage-heavy internals.

The package also ships a downstream conformance fixture for consumers that want
to verify their optional adapter boundary without copying app-specific smoke
tests:

```bash
bun scripts/consumer-conformance.mjs --json
```

It exercises four shapes: local SDK import, a fake future SDK contract that
must be rejected before resolver output is trusted, global `machines` CLI-only
fallback, and no-SDK/no-CLI unavailable diagnostics.

CLI and MCP expose the same topology view:

```bash
machines topology --json
machines topology --limit 10 --offset 10 --json
machines topology --no-tailscale --json
machines route --machine linux-dev-01 --json
machines ssh --machine linux-dev-01 --private-metadata
```

## Screen sharing

Open Screen Sharing (VNC) to any machine using its best live route — no stale
IP bookmarks. The route resolver picks the current LAN address or Tailscale name
automatically, so it keeps working even when DHCP rotates a machine's IP.

```bash
machines screen demo-mac-01                # open Screen Sharing.app → vnc://<user>@<live-route>
machines screen demo-mac-01 --print        # print the vnc:// URL instead of opening
machines screen demo-mac-01 --json         # full resolution detail (route, confidence, user)
machines screen --all                      # open every reachable machine
machines screen --all --print              # list resolved vnc:// URLs for the whole fleet
machines screen-credentials --all --check-secret
```

Enable Remote Management / Screen Sharing on a fresh macOS machine over SSH
(kickstart + SRP + legacy VNC password so user-password auth works from
Screen Sharing.app and Apple Remote Desktop):

```bash
secrets set machines/screen-sharing/screen-demo-mac-01-vnc-password "$VNC_PASSWORD" --type password
machines screen-enable --machine demo-mac-01 --user operator \
  --vnc-password-secret machines/screen-sharing/screen-demo-mac-01-vnc-password
machines screen-enable --machine demo-mac-01 --user operator --print   # show the SSH command, don't run it
```

The legacy VNC protocol honors only the first 8 password characters. The
password is read through the `secrets` CLI and piped over SSH stdin; it is not
embedded in generated command text. If `--vnc-password-secret` is omitted,
machines defaults to
`machines/screen-sharing/screen-<machine>-vnc-password`, or the namespace set in
`HASNA_MACHINES_SCREEN_SECRET_NAMESPACE`. The user comes from the manifest
(`metadata.user`) when present, or `--user`.

For GitHub automation, prefer GitHub App installation tokens over personal user
tokens. Public manifests and docs should store only opaque secret references
for the app id/private key material; private adapters or `open-secrets` should
resolve those references at runtime.
`screen-credentials` verifies the resolved user and secret key for a machine or
the full fleet without printing secret values.

Consumers that need repo paths can resolve trust-aware workspace mappings
without importing the full machines app:

```ts
import { resolveMachineWorkspace } from "@hasna/machines/consumer";

const workspace = resolveMachineWorkspace({
  machineId: "linux-dev-01",
  projectId: "open-knowledge",
  repoName: "open-knowledge",
});

console.log(workspace.paths.project_root.path);
console.log(workspace.paths.open_files_root.path);
```

The resolver returns the machine workspace root, project repo root,
open-files root, current/primary flags, trust/auth status, and redacted
diagnostics. It uses explicit manifest metadata first and deterministic
workspace inference second; consumers can still pass manual overrides.

```bash
machines workspace resolve --machine linux-dev-01 --project open-knowledge --repo open-knowledge --json
machines workspace doctor --machine linux-dev-01 --project open-knowledge --repo open-knowledge --json
```

`workspace resolve` and `workspace doctor` include JSON-friendly
`diagnostics` and `repair_hints`. Diagnostics classify missing manifests,
unresolved roots, inferred roots, local stale paths, untrusted machines, and
unknown auth. Repair hints include the dry-run command plus the matching
`--apply` command so downstream apps can surface the next step without
depending on open-machines internals.

If a resolver result reports inferred or unresolved project/open-files roots,
repair the manifest metadata explicitly. The command previews changes by
default and only writes when `--apply` is passed:

```bash
machines workspace repair --machine linux-dev-01 --project open-knowledge --repo open-knowledge --json
machines workspace repair --machine linux-dev-01 --project open-knowledge --repo open-knowledge --apply --json
```

## Compatibility SDK

Open-core consumers can use `@hasna/machines` to preflight a peer before
attempting app-level sync:

```ts
import { checkMachineCompatibility } from "@hasna/machines/consumer";

const report = checkMachineCompatibility({
  machineId: "linux-dev-01",
  commands: [{ command: "bun" }],
  packages: [{ name: "@example/knowledge", command: "knowledge", expectedVersion: "0.2.29" }],
  workspaces: [{
    label: "open-knowledge",
    path: "/srv/workspaces/open-knowledge",
    expectedPackageName: "@example/knowledge",
    expectedVersion: "0.2.29",
  }],
});
```

The compatibility report checks command availability, package-backed CLI
versions, workspace paths, and package metadata without printing secrets.
`knowledge` uses this as an optional preflight before machine sync, and falls
back to its own local checks if `@hasna/machines` is not installed.

CLI and MCP expose the same shape:

```bash
machines compatibility --machine linux-dev-01 \
  --command bun \
  --package @example/knowledge:knowledge:0.2.29 \
  --workspace open-knowledge=/srv/workspaces/open-knowledge:@example/knowledge:0.2.29 \
  --json
```

## Storage

Machines stores runtime data locally in SQLite under its data directory and includes repo-owned PostgreSQL migrations for remote storage deployments.

```bash
machines storage status --json
HASNA_MACHINES_DATABASE_URL=postgres://... machines storage push --tables agent_heartbeats --json
machines storage pull --json
machines storage sync --json
```

Configure database storage with `HASNA_MACHINES_DATABASE_URL` or fallback
`MACHINES_DATABASE_URL`. Optional storage mode env vars are
`HASNA_MACHINES_STORAGE_MODE` or `MACHINES_STORAGE_MODE` with `local`,
`hybrid`, or `remote`.

Remote PostgreSQL storage is fail-closed for TLS. Non-loopback database hosts
default to verified TLS, and `sslmode=disable`, `ssl=false`,
`sslmode=no-verify`, or `HASNA_MACHINES_DATABASE_SSL_REJECT_UNAUTHORIZED=0`
are rejected. For loopback development databases only, set
`HASNA_MACHINES_ALLOW_INSECURE_DATABASE_TLS=1` to permit disabled or
non-verified TLS.

## Fleet daemon

`machines-agent` can run as a managed heartbeat daemon. The daemon writes local
SQLite heartbeat rows and can optionally push those rows to PostgreSQL storage
for cross-network fleet dashboards.

```bash
machines-agent --once --json
machines-agent --interval-ms 30000
HASNA_MACHINES_DATABASE_URL=postgres://... machines-agent --storage-push --interval-ms 30000
machines-agent --doctor-summary --once --json
```

For a simple phase-one fleet without PostgreSQL storage, the primary machine can
actively collect public heartbeat rows over SSH and import them into its local
OpenMachines SQLite database:

```bash
machines heartbeat collect --machine spark02 --machine machine001 --json
machines heartbeat collector-command --machine spark01 --machine spark02
```

This runs `machines-agent --once` on each target using the normal route
resolver. It does not install or start persistent services. `machines topology`
treats stale `online` heartbeat rows as offline, so a one-time import is not
allowed to look live forever. If a target reports a stable local hostname
instead of its fleet id, declare that hostname in manifest
`metadata.heartbeatAliases`; route fields such as `hostname`, `tailscaleName`,
and `sshAddress` are not trusted as heartbeat identity. The collector still
stores the canonical fleet id.

OpenLoops heartbeat collector loops should install the command emitted by
`machines heartbeat collector-command`. Pass explicit low-latency collector
targets for one-minute loops; without `--machine`, the planner defaults to the
local machine only so a slow all-fleet collection cannot outlive the heartbeat
freshness window. The emitted command uses a 90000ms per-machine timeout,
fails the loop run when any selected import fails (`collect` always exits
non-zero on any failed import), and includes the trusted local mutation
environment for the scheduled collector:

```bash
HASNA_MACHINES_ALLOW_MUTATIONS=1 machines heartbeat collect --machine spark01 --machine spark02 --timeout-ms 90000 --json
```

Do not schedule `machines topology --all --json` as the heartbeat collector; it
only reads existing topology rows and does not import fresh heartbeat rows.

Service lifecycle commands are dry-run plans by default and support macOS
`launchd` plus Linux `systemd` user or system services:

```bash
machines daemon install --platform macos --mode user --storage-push --doctor-summary --json
machines daemon install --platform linux --mode user --storage-push --json
machines daemon status --platform linux --mode user --json
machines daemon logs --platform macos --mode user
machines daemon restart --platform linux --mode user --apply --yes
machines daemon uninstall --platform linux --mode user --apply --yes
```

Install plans include generated service-file content and the exact lifecycle
commands. They do not embed raw database URLs or secrets; storage and private
settings are represented as environment variable names or safe placeholders.
`--apply` only executes when paired with `--yes`.

By default heartbeat facts are public-safe. Hostnames, usernames, serials,
private IPs, Tailscale DNS names, database URLs, and secret-like values should
not appear in public output. Operators that need private fleet facts can opt in
locally with `--private-metadata` or `HASNA_MACHINES_PRIVATE_METADATA=1`; do
not share private-mode JSON in OSS issues or docs.

HTTP dashboard/API and MCP private reads require a second operator-side gate:
set `HASNA_MACHINES_ALLOW_PRIVATE_OUTPUT=1` and pass the explicit
`privateMetadata=true` query parameter or MCP `private_metadata` argument. The
caller flag alone is ignored.

Default status and SSH-resolution output is public-safe: local paths, machine
identifiers, route targets, and generated SSH commands are redacted unless
private output is explicitly requested. CLI commands that print raw SSH targets
require `--private-metadata`.

Doctor summaries are also opt-in with `--doctor-summary` or
`HASNA_MACHINES_AGENT_DOCTOR_SUMMARY=1`. The daemon records a compact
ok/warn/fail count plus redacted blockers and avoids optional private adapters
inside the heartbeat loop.

`machines topology`, `machines route`, `machines serve`, and `machines-mcp`
consume the same heartbeat rows. When Tailscale is available, route resolution
still uses `tailscale status --json` and falls back to Tailscale routes when LAN
or SSH routes are not verified.

Machine backups are preview-only unless `--apply --yes` is passed. The backup
target can be explicit or environment-backed:

```bash
machines backup --bucket fleet-backups --prefix machines --json
MACHINES_S3_BUCKET=fleet-backups machines backup --json
```

`--bucket` and `--prefix` always win. Without `--bucket`, the backup command
uses `HASNA_MACHINES_S3_BUCKET` or fallback `MACHINES_S3_BUCKET`; prefix uses
`HASNA_MACHINES_S3_PREFIX`, fallback `MACHINES_S3_PREFIX`, or `machines`.
This keeps the open-source CLI local/self-hosted by default while allowing
deployments to route app-owned backups through explicit storage metadata.

## Applications and tooling

```bash
machines apps list --machine mac-lab-01
machines apps status --machine mac-lab-01
machines apps diff --machine mac-lab-01
machines apps plan --machine mac-lab-01 --json
machines apps apply --machine mac-lab-01 --yes

machines install-claude status --machine linux-dev-01
machines install-claude diff --machine linux-dev-01
machines install-claude plan --machine linux-dev-01 --tool claude codex --json
machines install-claude apply --machine linux-dev-01 --tool claude codex --yes

machines install-tailscale --machine mac-lab-01 --json
```

## Notifications

```bash
machines notifications add --id ops --type webhook --target https://example.com/hook --event sync_failed
machines notifications add --id cmd --type command --target /bin/sh --arg -c --arg 'printf "%s\n" "$HASNA_MACHINES_NOTIFICATION_EVENT"'
machines notifications list
machines notifications test --channel ops
machines notifications test --channel ops --apply --yes
machines notifications dispatch --event manual.test --message "hello fleet"
```

- `email` channels deliver through local `sendmail` or `mail` when available
- `webhook` channels deliver JSON via HTTP POST
- `command` channels execute an explicit command executable plus optional `--arg`
  values with `HASNA_MACHINES_NOTIFICATION_*` env vars; use `/bin/sh -c ...`
  explicitly if a shell is required

## Runtime Events

`machines runtime tmux-watch` probes tmux with `display-message` and emits shared
events without sending keys, killing panes, or changing tmux state.

```bash
machines runtime tmux-watch %11 --once --json
machines runtime tmux-watch session:0.1 --interval-ms 5000 --approval-token "$TOKEN"
machines runtime tmux-hook-plan --trusted-local-mutation --json
machines runtime tmux-hook-plan --approval-token "$TOKEN"
machines webhooks add https://example.com/hook --id tmux-alerts --type machines.tmux.pane_died
```

When a pane was present and later disappears, the command records
`machines.tmux.pane_died`. With `--once`, a missing pane records
`machines.tmux.pane_missing`; add `--no-deliver` to record without webhook
delivery. Runtime event delivery requires a scoped mutation approval token; local
no-deliver recording remains available for diagnostics.

`machines runtime tmux-hook-plan` prints a native tmux `pane-died` hook command
for operators that prefer tmux hooks over polling. It is read-only and does not
install hooks. Pass `--approval-token` when you want the generated hook command
to be scoped to a short-lived approval token, or pass
`--trusted-local-mutation` to generate a process-local
`HASNA_MACHINES_ALLOW_MUTATIONS=1` prefix for local event recording.

## Fleet hostnames (`machines hosts`)

Make every fleet machine reachable by its bare name from any other machine —
`curl http://machine001:3000` works the same on every box — without depending on
Tailscale MagicDNS being configured. `machines hosts` writes a managed block into
`/etc/hosts` for each machine in the manifest, choosing the best address:

1. `metadata.lanAddress` from the manifest, when it is on the local machine's `/24`
2. the peer's live direct Tailscale LAN endpoint (`CurAddr`) on the local `/24`
3. the peer's tailnet IP (`100.64.0.0/10`) — always routable, auto-routed over the
   LAN when co-located

```bash
machines hosts            # dry-run plan (default)
machines hosts plan -j    # JSON plan
machines hosts apply      # write /etc/hosts (uses sudo when the file is root-owned)
machines hosts plan --no-warm   # skip discovering LAN endpoints (faster, tailnet IPs)
```

By default the command first runs `tailscale ping` against online peers so their
LAN endpoints become visible and same-LAN machines resolve to their `192.168.x.x`
address (true LAN-direct) instead of the tailnet IP. Off-LAN or offline peers fall
back to the tailnet IP. The local machine is skipped. The managed block is delimited
by markers, so re-running `apply` only rewrites that block and leaves the rest of
`/etc/hosts` untouched.

### Direct @hasna/events bins

`@hasna/events` is a dependency of `@hasna/machines` and publishes its own
dependency-owned `events` and `hasna-events` binaries. Package managers may
install those aliases into an application's top-level `node_modules/.bin`, but
they are not part of the `@hasna/machines` command surface, release scripts,
daemon plans, MCP tools, or approval model. Use `machines events` and
`machines webhooks` for machines-scoped event operations; those commands enforce
machines mutation approval and bind scoped tokens to canonical arguments.

## Dashboard

```bash
machines serve --json
machines serve --port 7676
# Explicitly expose beyond loopback only on a trusted network:
machines serve --host 0.0.0.0 --port 7676
```

The dashboard exposes:

- `/` HTML dashboard
- `/health` health probe
- `/api/status` fleet status JSON
- `/api/topology` manifest, heartbeat, SSH, LAN, and Tailscale topology JSON
- `/api/routes` resolved route JSON for known machines
- `/api/machines/friendly-name` get, set, or clear a machine display label
- `/api/machines/details` consumer-safe machine details JSON
- `/api/browserplan/fleet` BrowserPlan machine001-machine011 target contract JSON
- `/api/notes/machine-context` note origin/source/target machine and actor provenance JSON
- `/api/notes/trash-policies` per-machine note trash retention metadata JSON
- `/api/daemon/status` daemon heartbeat rows
- `/api/manifest` current manifest JSON
- `/api/notifications` notification channel JSON
- `/api/webhooks` shared event webhook channel JSON
- `/api/events` shared event JSON
- `/api/doctor` doctor report JSON
- `/api/self-test` smoke-check JSON
- `/api/apps/status` app inventory JSON
- `/api/apps/diff` app drift JSON
- `/api/install-claude/status` CLI inventory JSON
- `/api/install-claude/diff` CLI drift JSON
- `/api/events`, `/api/notifications/test`, `/api/webhooks/test` POST mutation routes require scoped dashboard mutation approval tokens

## Local development

```bash
bun install
bun test
bun run typecheck
bun run build
bun run src/cli/index.ts --help
```

## Release, security, and community

- License: Apache-2.0. See [LICENSE](LICENSE).
- Release notes: [CHANGELOG.md](CHANGELOG.md).
- Security reporting and package safety model: [SECURITY.md](SECURITY.md).
- Contribution guide: [CONTRIBUTING.md](CONTRIBUTING.md).
- Community expectations: [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md).
