# @hasna/stations

Machine fleet management for developers — provision, sync, inspect, and operate multiple development stations from CLI and MCP.

## Binaries

- `stations`: Commander-based CLI for manifest, setup, sync, inspection, and dashboard commands
- `stations-mcp`: MCP server exposing fleet tools to AI agents
- `stations-daemon`: lightweight local daemon for heartbeats and runtime reporting

## HTTP mode

Long-lived Streamable HTTP transport for shared agent connections (stdio remains the default):

```bash
stations-mcp --http
# or: MCP_HTTP=1 stations-mcp
# default port: 8821 (override with --port or MCP_HTTP_PORT)
```

Endpoints on `127.0.0.1` only:

- `GET /health` → `{"status":"ok","name":"stations"}`
- `POST /mcp` → MCP Streamable HTTP

HTTP mode rejects browser requests with untrusted `Origin` headers, caps JSON
bodies at `STATIONS_HTTP_MAX_BODY_BYTES` (default 1 MiB), and requires either
`STATIONS_API_KEY` or loopback-only `STATIONS_ALLOW_UNAUTHENTICATED=1`. Use
`STATIONS_HTTP_ALLOWED_ORIGINS=https://ops.example` for an explicit browser
origin allowlist.

## Manifest

`stations.json` is the desired fleet declaration.

```bash
stations manifest init
stations manifest bootstrap
stations manifest add --id linux-dev-01 --platform linux --workspace-path ~/workspace
stations manifest add --id linux-dev-01 --friendly-name "Linux Dev" --platform linux --workspace-path ~/workspace
stations manifest add --id mac-lab-01 --platform macos --workspace-path ~/Workspace --app ghostty:cask
stations manifest friendly-name get linux-dev-01 --json
stations manifest friendly-name set linux-dev-01 "Linux Dev" --approval-token "$TOKEN" --json
stations manifest friendly-name clear linux-dev-01 --approval-token "$TOKEN" --json
stations manifest validate
stations manifest list
```

`id` is the stable machine slug and must not be changed for display purposes.
Use `friendlyName` for user-facing labels. Consumers should display the
topology `display_name` field, which is computed as `friendly_name` when set
and `machine_id` otherwise. Setting or clearing `friendlyName` updates the
machine `updatedAt` timestamp and requires the same scoped mutation approval
model as other manifest writes.

Public packages should keep private fleet state behind an opaque source/ref
boundary. `HASNA_STATIONS_PRIVATE_MANIFEST_REF` (or
`STATIONS_PRIVATE_MANIFEST_REF`) may point at a private backend, but
stations only reports the redacted ref and falls back to the local
`stations.json` unless a caller supplies a manifest adapter. The adapter
contract is backend-agnostic and lives in the package root exports; it does not
pull in secrets managers, storage SDKs, or org-specific fleet internals.

## Provision and reconcile

```bash
stations setup --machine linux-dev-01
stations setup --machine linux-dev-01 --json
stations setup --machine linux-dev-01 --apply --yes
stations sync --machine linux-dev-01 --json
stations sync --machine linux-dev-01 --apply --yes
stations doctor --machine linux-dev-01
stations self-test
```

`stations setup` is a dry-run plan by default. The generated playbook favors
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
`stations self-test --json` includes `overall` and `counts` fields so agents
can branch on readiness without scanning every check.

Apple device management belongs in the private deployment layer. The public
setup plan can report enrollment status with `profiles status -type enrollment`,
but it does not enroll devices, install profiles, or publish team identifiers.

## Package rollout reconcile (`stations reconcile`)

`stations reconcile` compares the desired-state package versions declared in
`stations.json` against the bun global tree (`bun pm ls -g`) and plans
`bun install -g pkg@version` installs/updates. The manifest gains two
backward-compatible fields: a fleet-wide `packages` list applied to every
machine (per-machine `packages` override by name), and a `freeze` list for the
supply-chain freeze gate. Package specs accept optional `version` (the pin),
`appId` (the `hasna.app.v1` join key, defaulting to the `<name>`
convention for `@hasna/*` packages), `bin` (verification CLI, defaulting to
the unscoped package name), `verify` (set `false` for library-only packages
without a CLI: rollouts succeed on install exit code alone, though a declared
`mcpHealthUrl` is still checked), and `mcpHealthUrl`.

```bash
stations reconcile --dry-run --json            # plan only, never executes
stations reconcile --apply --json              # install/update + verify + rollback
stations reconcile --apply --package @hasna/todos
stations reconcile --dry-run --event-json release-published.json
stations reconcile --dry-run --installed-json snapshot.json   # plan against a snapshot
```

Reconcile is dry-run by default; `--apply` requires the same scoped mutation
approval model as other mutating commands. Applied actions are verified
(`<bin> --version` must report the target version; declared `hasna-*-mcp`
health endpoints must answer) and roll back to the previously installed
version when verification fails. Every terminal outcome is recorded as a
`hasna.rollout_record.v1` document in `<dataDir>/rollout-records.jsonl` and
emitted through the shared `@hasna/events` envelope as
`release.rollout.started` / `release.rollout.completed` /
`release.rollout.failed` / `app.installed` events.

The loop is also triggerable by a `release.published` event: pipe the event
envelope to `stations reconcile --event-json -` (or a file path). Pinned
manifest versions stay authoritative; packages tracked without a pin adopt the
released version. Programmatic consumers can call `reconcileFromReleaseEvent`
from the package root exports.

### Exact Bun registry candidate

A machine-scoped package can opt into `exactBunRegistry` for an atomic
live-global Bun update. The candidate manifest must contain exactly one target
machine and either one `@hasna/stations` self-upgrade step at order 10 or the
two ordered platform packages: `@hasnaxyz/infinity@1.0.12` at order 10 followed
by `@hasnaxyz/factory@0.6.9` at order 20. The two transaction shapes cannot be
mixed. Each package names its exact archive digest, registry integrity, probe,
rollback mode, and the same immutable source reference. Fleet-wide exact
delivery is rejected.

```bash
stations apps validate --manifest ./candidate.json --machine station01 --json
stations apps plan --manifest ./candidate.json --machine station01 --json
stations apps apply --manifest ./candidate.json --machine station01 \
  --expected-plan-digest <sha256> --yes --approval-token <scoped-token>
stations apps status --manifest ./candidate.json --machine station01 --json
```

The default source provider is Hasna Files. Callers may supply another bounded
source loader for a task attachment, but missing or mismatched references,
sizes, and SHA-256 digests fail before target execution. Source bytes are sent
once through the Stations executor's bounded stdin and are not included in the
plan, status, command, or logs. The target writes them to a mode-0600 temporary
file inside a mode-0700 directory, verifies them again, then executes one exact
`package@version` selector per step.

The target requires the configured Bun executable path, the canonical npm
registry (explicitly configured or Bun's omitted default), and the seven-day
release-age quarantine before mutation. Its exclusion policy may contain
additional exact package names only when every required exclusion remains.
The two npm credential reference names remain station-local and are consumed
only by `secrets exec`; credential values are never serialized by Stations.
Each step must prove package JSON, Bun lock registry integrity, SDK import, and
CLI help with one structured
`stations.bun_package_probe.v1` object. A preimage of the Bun global tree, bin
directory, and Bun configuration is taken before step one. Any step or probe
failure restores that complete preimage and reports only bounded reason codes.

### Supply-chain freeze gate (`stations freeze`)

Frozen packages are never installed or updated by reconcile; they surface as
`freeze-blocked` plan actions and blocked rollout records (ported from the
skill-package-update incident-freeze rule).

```bash
stations freeze add left-pad --reason "supply-chain incident #7" --json
stations freeze add left-pad --until 2026-08-01T00:00:00Z
stations freeze check left-pad        # exit 1 while frozen
stations freeze list --json
stations freeze remove left-pad
```

Freeze entries live in `<dataDir>/freeze.json` and can also be declared
fleet-wide in the manifest `freeze` list; `until` timestamps expire
automatically.

## Topology SDK

`@hasna/stations` exposes a compact consumer SDK for other open-core packages
that need machine identity without importing CLI, MCP, agent, installer, or
storage-heavy internals. Consumers that only need the stable app-to-app contract
should import `@hasna/stations/consumer`:

```ts
import {
  STATIONS_CONSUMER_CONTRACT,
  createMachineResolverSnapshot,
  discoverMachineTopology,
  getBrowserPlanFleet,
  getMachineDetails,
  getLocalMachineTopology,
  listMachineTrashPolicies,
  resolveNoteMachineContext,
  resolveMachineRoute,
  resolveMachineWorkspace,
  validateStationsConsumerEnvelope,
} from "@hasna/stations/consumer";

console.log(STATIONS_CONSUMER_CONTRACT.schema_version);
const topology = discoverMachineTopology();
const local = getLocalMachineTopology();
const details = getMachineDetails("linux-dev-01");
const browserPlanFleet = getBrowserPlanFleet();
const route = resolveMachineRoute("linux-dev-01");
const workspace = resolveMachineWorkspace({
  machineId: "linux-dev-01",
  projectId: "knowledge",
  repoName: "knowledge",
});
const snapshot = createMachineResolverSnapshot({ route, workspace });
console.log(validateStationsConsumerEnvelope("resolver_snapshot", snapshot).ok);
```

The SDK merges manifest entries, local heartbeats, SSH route hints, and
`tailscale status --json` peers when Tailscale is available. Consumers such as
`@hasna/knowledge` should treat this package as optional: dynamically import it
when present, and fall back to local probes or app-local machine registries when
it is absent.

Topology, route, workspace, compatibility, and resolver-snapshot JSON include
`schema_version`, package version metadata, capability flags, and cacheability
metadata where downstream apps may persist resolver evidence. The current
consumer contract version is `1`; the exported `STATIONS_CONSUMER_CONTRACT`
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
stations loop-preflight --machine control,worker --cmd 'bun test' --no-tailscale
stations machine-health --project stations --repo stations
stations routing --machine worker
stations command-matrix --machine worker --cmd 'bun run build'
stations dispatch-smoke --json
stations ops check --all --expect-machine spark01,spark02,apple03 --text
```

The matching SDK exports are `getFleetLoopPreflight()`,
`getFleetMachineHealth()`, `getFleetRouting()`, `getCommandMatrix()`, and
`getDispatchFleetSmoke()`.
The matching MCP tools are `stations_loop_preflight`,
`stations_machine_health`, `stations_routing`, `stations_command_matrix`, and
`stations_dispatch_fleet_smoke`. The loop/health/routing/matrix reports include
`pagination`, `artifacts`/detail refs, compact per-machine rows, and warnings;
the dispatch smoke report uses a fixed bounded target set and includes
per-machine package, route, and daemon-readiness rows.

`stations routing` reports route reachability only. `stations command-matrix`
and `stations loop-preflight` additionally run a bounded read-only `true` probe
through the selected command route. `can_run` is true only when that probe
executes successfully, so an online Tailscale peer that rejects SSH
authentication remains routable but is blocked for command execution. Probe
results expose only a bounded status and exit code; route targets, commands,
and SSH stderr remain redacted on public output.

`stations dispatch-smoke` is a no-mutation diagnostic for dispatch
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

`stations ops check` composes health, routing, loop-preflight, and read-only
tmux diagnostics into a loop-safe fleet report. By default it only prints
bounded task suggestions and never mutates tmux or todos. Scheduled loops that
should create remediation tasks must opt in explicitly:

```bash
stations ops check \
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
`stations ops db-integrity` scans bounded local roots for SQLite databases and
runs read-only `sqlite3` quick checks. `stations ops state-snapshot` plans
snapshots by default and only writes private snapshot files when `--apply` is
passed. Snapshot writes fail closed unless `sqlite3 .backup` succeeds and the
created snapshot passes verification; the command does not copy live database
files as a fallback because that can lose WAL data.

```bash
stations ops db-integrity \
  --root /home/hasna/.hasna,/home/hasna/.codewith \
  --max-dbs 500 \
  --max-size-bytes 2147483648 \
  --report-dir /home/hasna/.hasna/loops/reports/critical-db-integrity-compact \
  --upsert-tasks \
  --todos-project /home/hasna/.hasna/loops \
  --task-list machine-data-db-integrity \
  --max-task-actions 10 \
  --text

stations ops state-snapshot \
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
latest 10 stations ordered by `updated_at` descending. For View more, pass
`limit` and `offset`:

```bash
stations topology --json
stations topology --limit 10 --offset 10 --json
curl 'http://127.0.0.1:7676/api/topology?limit=10&offset=10&tailscale=false'
```

Each `topology.stations[]` row includes:

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
stations manifest friendly-name get linux-dev-01 --json
stations manifest friendly-name set linux-dev-01 "Linux Dev" --approval-token "$TOKEN" --json
stations manifest friendly-name clear linux-dev-01 --approval-token "$TOKEN" --json
```

HTTP dashboard API:

- `GET /api/stations/friendly-name?machine=linux-dev-01`
- `POST /api/stations/friendly-name` with `machine_id`, `friendly_name`, and a scoped `approval_token`
- `DELETE /api/stations/friendly-name?machine=linux-dev-01` with a scoped approval token

MCP tools expose the same contract as `stations_friendly_name_get`,
`stations_friendly_name_set`, `stations_friendly_name_clear`, and
`stations_topology` with `limit` and `offset` arguments.

### Hasna Notes ownership and provenance contract

Stations does not own note storage. It does expose machine identity,
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
- `sync_target_machine_ids` and `sync_targets`: stations that should receive or display synced copies.
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
stations notes context --origin-machine linux-dev-01 --source-machine agent-runner-01 --actor-type agent --agent-name "Notes Agent" --source agent --json
stations notes trash-policies --limit 10 --offset 0 --json
curl 'http://127.0.0.1:7676/api/notes/machine-context?origin_machine_id=linux-dev-01&source_machine_id=agent-runner-01&actor_type=agent&agent_name=Notes%20Agent&source=agent'
curl 'http://127.0.0.1:7676/api/notes/trash-policies?limit=10&offset=0'
```

MCP exposes `stations_notes_context` and `stations_notes_trash_policies` with
the same field names. These fields are the coordination contract for notes:
store stable ids in note records, show `display_name`, and use pagination
metadata for any machine-backed lists.

### Hasna Notes machine details contract

For right-click View details, Hasna Notes should call `getMachineDetails(id)`,
`GET /api/stations/details?machine=<id>`, `stations details --machine <id>
--json`, or MCP `stations_details`.

The `machine_details` envelope is a friendly, consumer-safe view. It includes:

- `machine_id` and `slug`: stable machine id for storage and links.
- `friendly_name` / `friendlyName`: present only when a user label is set.
- `display_name` / `displayName`: always present; uses friendly name first, then `machine_id`.
- `known`: whether stations found the machine in topology.
- `status`: `state`, neutral `label`, `online`, and optional seen timestamps.
- `platform`, `machine_type`, `role`, `roles`, `machine_capabilities`, and `tags` when known.
- `updated_at`, `last_seen_at`, and `timestamps.recent_sync_at` / `recent_sync_status` when known.
- `source`: `authority`, `metadata_source`, `manifest_declared`, `heartbeat_present`, `topology_entry`, and `local`.
- `display_metadata`: only safe whitelisted display metadata such as type, role, owner, team, region, environment, and capabilities.

Fallback behavior:

- UI label: render `display_name`; it already falls back from friendly name to slug/id.
- Status: when no heartbeat or online signal is known, render `status.label` as `Unknown`.
- Optional fields are omitted when absent rather than filled with raw/internal data.
- Missing stations still return `machine_id`, `slug`, `display_name`, `known: false`, neutral unknown status, and `unknown_machine:details:<id>` in `warnings`.

Raw route targets, hostnames, local paths, secrets, private heartbeat details,
and sensitive metadata keys are not part of the default details view.

### BrowserPlan fleet contract

Open-chrome owns BrowserPlan. Stations exposes the stable machine/fleet
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
stations browserplan fleet --json
stations browserplan fleet --machine machine001,machine002 --json
stations browserplan fleet --machine machine001 --check-installs --json
curl 'http://127.0.0.1:7676/api/browserplan/fleet?machine=machine001,machine002'
```

MCP exposes the same envelope as `stations_browserplan_fleet` with
`machine_ids`, `include_tailscale`, and `check_installs` arguments.

The `browserplan_fleet` envelope includes:

- `target.name`: `browserplan-machine001-machine011`.
- `target.machine_ids`: the full BrowserPlan target ids `machine001` through `machine011`.
- `target.excluded_machine_ids` / `install_target_excludes`: `spark01` and `spark02`.
- `coverage`: `expected`, `returned`, `known`, `missing`, `unreachable`, and `excluded_requested`. When `machineIds` filters are supplied, `expected` is the selected BrowserPlan target count; `target.machine_ids` still documents the full fixed target.
- `stations[]`: `machine_id`, `slug`, `friendly_name` / `friendlyName`, `display_name` / `displayName`, `known`, `eligible`, `eligibility_reasons`, `platform`, `os`, `user`, `workspace`, `tags`, `updated_at`, `status`, `reachability`, `daemon`, `install_state`, `operation_hooks`, and `warnings`.
- `operation_contract.stable_surfaces`: SDK, CLI, API, and MCP names that expose this shape.

Machine ids are unambiguous. `machine001` and `machine002` are BrowserPlan fleet
targets and are distinct from `spark01` and `spark02`. `spark01` and `spark02`
are never returned as BrowserPlan stations; if requested, they appear in
`coverage.excluded_requested` with a warning.

For UI labels, render each machine's `display_name`; it already falls back from
friendly name to stable id. `status.label` uses `Online`, `Offline`, or neutral
`Unknown`. Optional metadata is omitted or nullable when stations does not
know it.

`operation_hooks` are contracts, not command execution. BrowserPlan/open-chrome
owns the concrete remote commands for profile setup, headed launch, headless
launch, daemon/supervisor status, tab/session inventory, and app install/update.
`app_install_update` installs from the `@hasna/open-chrome` npm package (`bun
install -g @hasna/open-chrome@0.1.0`), not from a git checkout. The version is
pinned on purpose, not floating — npm is the sole artifact for that package, so a
moved dist-tag would reach the fleet through `bun install -g`.
`validateStationsConsumerEnvelope` accepts that shape with any bare version or
tag, plus the exact pre-retirement checkout template for backward compatibility,
and rejects everything else — including anything chained after a valid install.
Note that `daemon_status`, `tab_inventory` and `supervisor_status` advertise
commands the published `0.1.0` artifact does not dispatch; they report ready but
print usage and exit 0.
Stations owns route resolution and exposes the safe runner pattern:
`runMachineCommand()` in the SDK, `stations ssh --machine <id> --cmd
<browserplan-owned command> --json` in the CLI, and MCP `stations_ssh_resolve`.
Private route details are still omitted unless a trusted local operator surface
opts into private metadata.

Install state is cheap by default: `install_state.checked` is `false` and
capabilities are `unknown`. Callers that need BrowserPlan/chrome/bun/git state
must opt in with SDK `includeInstallState: true`, CLI `--check-installs`, API
`check_installs=true`, or MCP `check_installs: true`; remote probe failures
return warnings and blocked hooks instead of throwing.

The package includes `schemas/stations-consumer.schema.json` and also exports
`STATIONS_CONSUMER_SCHEMA_BUNDLE`, `getStationsConsumerSchemaBundle()`, and
`validateStationsConsumerEnvelope()`. Downstream apps can use these helpers to
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
must be rejected before resolver output is trusted, global `stations` CLI-only
fallback, and no-SDK/no-CLI unavailable diagnostics.

CLI and MCP expose the same topology view:

```bash
stations topology --json
stations topology --limit 10 --offset 10 --json
stations topology --no-tailscale --json
stations route --machine linux-dev-01 --json
stations ssh --machine linux-dev-01 --private-metadata
```

## Screen sharing

Open Screen Sharing (VNC) to any machine using its best live route — no stale
IP bookmarks. The route resolver picks the current LAN address or Tailscale name
automatically, so it keeps working even when DHCP rotates a machine's IP.

```bash
stations screen demo-mac-01                # open Screen Sharing.app → vnc://<user>@<live-route>
stations screen demo-mac-01 --print        # print the vnc:// URL instead of opening
stations screen demo-mac-01 --json         # full resolution detail (route, confidence, user)
stations screen --all                      # open every reachable machine
stations screen --all --print              # list resolved vnc:// URLs for the whole fleet
stations screen-credentials --all --check-secret
```

Enable Remote Management / Screen Sharing on a fresh macOS machine over SSH
(kickstart + SRP + legacy VNC password so user-password auth works from
Screen Sharing.app and Apple Remote Desktop):

```bash
secrets set stations/screen-sharing/screen-demo-mac-01-vnc-password "$VNC_PASSWORD" --type password
stations screen-enable --machine demo-mac-01 --user operator \
  --vnc-password-secret stations/screen-sharing/screen-demo-mac-01-vnc-password
stations screen-enable --machine demo-mac-01 --user operator --print   # show the SSH command, don't run it
```

The legacy VNC protocol honors only the first 8 password characters. The
password is read through the `secrets` CLI and piped over SSH stdin; it is not
embedded in generated command text. If `--vnc-password-secret` is omitted,
stations defaults to
`stations/screen-sharing/screen-<machine>-vnc-password`, or the namespace set in
`HASNA_STATIONS_SCREEN_SECRET_NAMESPACE`. The user comes from the manifest
(`metadata.user`) when present, or `--user`.

For GitHub automation, prefer GitHub App installation tokens over personal user
tokens. Public manifests and docs should store only opaque secret references
for the app id/private key material; private adapters or `secrets` should
resolve those references at runtime.
`screen-credentials` verifies the resolved user and secret key for a machine or
the full fleet without printing secret values.

Consumers that need repo paths can resolve trust-aware workspace mappings
without importing the full stations app:

```ts
import { resolveMachineWorkspace } from "@hasna/stations/consumer";

const workspace = resolveMachineWorkspace({
  machineId: "linux-dev-01",
  projectId: "knowledge",
  repoName: "knowledge",
});

console.log(workspace.paths.project_root.path);
console.log(workspace.paths.open_files_root.path);
```

The resolver returns the machine workspace root, project repo root,
open-files root, current/primary flags, trust/auth status, and redacted
diagnostics. It uses explicit manifest metadata first and deterministic
workspace inference second; consumers can still pass manual overrides.

```bash
stations workspace resolve --machine linux-dev-01 --project knowledge --repo knowledge --json
stations workspace doctor --machine linux-dev-01 --project knowledge --repo knowledge --json
```

`workspace resolve` and `workspace doctor` include JSON-friendly
`diagnostics` and `repair_hints`. Diagnostics classify missing manifests,
unresolved roots, inferred roots, local stale paths, untrusted stations, and
unknown auth. Repair hints include the dry-run command plus the matching
`--apply` command so downstream apps can surface the next step without
depending on stations internals.

If a resolver result reports inferred or unresolved project/open-files roots,
repair the manifest metadata explicitly. The command previews changes by
default and only writes when `--apply` is passed:

```bash
stations workspace repair --machine linux-dev-01 --project knowledge --repo knowledge --json
stations workspace repair --machine linux-dev-01 --project knowledge --repo knowledge --apply --json
```

## Compatibility SDK

Open-core consumers can use `@hasna/stations` to preflight a peer before
attempting app-level sync:

```ts
import { checkMachineCompatibility } from "@hasna/stations/consumer";

const report = checkMachineCompatibility({
  machineId: "linux-dev-01",
  commands: [{ command: "bun" }],
  packages: [{ name: "@example/knowledge", command: "knowledge", expectedVersion: "0.2.29" }],
  workspaces: [{
    label: "knowledge",
    path: "/srv/workspaces/knowledge",
    expectedPackageName: "@example/knowledge",
    expectedVersion: "0.2.29",
  }],
});
```

The compatibility report checks command availability, package-backed CLI
versions, workspace paths, and package metadata without printing secrets.
`knowledge` uses this as an optional preflight before machine sync, and falls
back to its own local checks if `@hasna/stations` is not installed.

CLI and MCP expose the same shape:

```bash
stations compatibility --machine linux-dev-01 \
  --command bun \
  --package @example/knowledge:knowledge:0.2.29 \
  --workspace knowledge=/srv/workspaces/knowledge:@example/knowledge:0.2.29 \
  --json
```

## Storage

Stations stores runtime data locally in SQLite under its data directory and includes repo-owned PostgreSQL migrations for remote storage deployments.

```bash
stations storage status --json
HASNA_STATIONS_DATABASE_URL=postgres://... stations storage push --tables agent_heartbeats --json
stations storage pull --json
stations storage sync --json
```

Configure database storage with `HASNA_STATIONS_DATABASE_URL` or fallback
`STATIONS_DATABASE_URL`. The server data backend is `sqlite | postgresql`,
selected by the presence of that variable — deployment modes were removed, so
any set storage-mode variable (`HASNA_STATIONS_STORAGE_MODE`,
`HASNA_STATIONS_MODE`, or the `STATIONS_*` aliases) is rejected with an error
naming the variable. Clients route to the hosted HTTP API when both
`HASNA_STATIONS_API_URL` and `HASNA_STATIONS_API_KEY` are set, and use the
local SQLite store otherwise.

Remote PostgreSQL storage is fail-closed for TLS. Non-loopback database hosts
default to verified TLS, and `sslmode=disable`, `ssl=false`,
`sslmode=no-verify`, or `HASNA_STATIONS_DATABASE_SSL_REJECT_UNAUTHORIZED=0`
are rejected. For loopback development databases only, set
`HASNA_STATIONS_ALLOW_INSECURE_DATABASE_TLS=1` to permit disabled or
non-verified TLS.

## Fleet daemon

`stations-daemon` can run as a managed heartbeat daemon. The daemon writes local
SQLite heartbeat rows and can optionally push those rows to PostgreSQL storage
for cross-network fleet dashboards.

```bash
stations-daemon --once --json
stations-daemon --interval-ms 30000
HASNA_STATIONS_DATABASE_URL=postgres://... stations-daemon --storage-push --interval-ms 30000
stations-daemon --doctor-summary --once --json
```

For a simple phase-one fleet without PostgreSQL storage, the primary machine can
actively collect public heartbeat rows over SSH and import them into its local
OpenStations SQLite database:

```bash
stations heartbeat collect --machine spark02 --machine machine001 --json
stations heartbeat collector-command --machine spark01 --machine spark02
```

This runs `stations-daemon --once` on each target using the normal route
resolver. It does not install or start persistent services. `stations topology`
treats stale `online` heartbeat rows as offline, so a one-time import is not
allowed to look live forever. If a target reports a stable local hostname
instead of its fleet id, declare that hostname in manifest
`metadata.heartbeatAliases`; route fields such as `hostname`, `tailscaleName`,
and `sshAddress` are not trusted as heartbeat identity. The collector still
stores the canonical fleet id.

OpenLoops heartbeat collector loops should install the command emitted by
`stations heartbeat collector-command`. Pass explicit low-latency collector
targets for one-minute loops; without `--machine`, the planner defaults to the
local machine only so a slow all-fleet collection cannot outlive the heartbeat
freshness window. The emitted command uses a 90000ms per-machine timeout,
fails the loop run when any selected import fails (`collect` always exits
non-zero on any failed import), and includes the trusted local mutation
environment for the scheduled collector:

```bash
HASNA_STATIONS_ALLOW_MUTATIONS=1 stations heartbeat collect --machine spark01 --machine spark02 --timeout-ms 90000 --json
```

Do not schedule `stations topology --all --json` as the heartbeat collector; it
only reads existing topology rows and does not import fresh heartbeat rows.

Service lifecycle commands are dry-run plans by default and support macOS
`launchd` plus Linux `systemd` user or system services:

```bash
stations daemon install --platform macos --mode user --storage-push --doctor-summary --json
stations daemon install --platform linux --mode user --storage-push --json
stations daemon status --platform linux --mode user --json
stations daemon logs --platform macos --mode user
stations daemon restart --platform linux --mode user --apply --yes
stations daemon uninstall --platform linux --mode user --apply --yes
```

Install plans include generated service-file content and the exact lifecycle
commands. They do not embed raw database URLs or secrets; storage and private
settings are represented as environment variable names or safe placeholders.
`--apply` only executes when paired with `--yes`.

By default heartbeat facts are public-safe. Hostnames, usernames, serials,
private IPs, Tailscale DNS names, database URLs, and secret-like values should
not appear in public output. Operators that need private fleet facts can opt in
locally with `--private-metadata` or `HASNA_STATIONS_PRIVATE_METADATA=1`; do
not share private-mode JSON in OSS issues or docs.

HTTP dashboard/API and MCP private reads require a second operator-side gate:
set `HASNA_STATIONS_ALLOW_PRIVATE_OUTPUT=1` and pass the explicit
`privateMetadata=true` query parameter or MCP `private_metadata` argument. The
caller flag alone is ignored.

Default status and SSH-resolution output is public-safe: local paths, machine
identifiers, route targets, and generated SSH commands are redacted unless
private output is explicitly requested. CLI commands that print raw SSH targets
require `--private-metadata`.

Doctor summaries are also opt-in with `--doctor-summary` or
`HASNA_STATIONS_AGENT_DOCTOR_SUMMARY=1`. The daemon records a compact
ok/warn/fail count plus redacted blockers and avoids optional private adapters
inside the heartbeat loop.

`stations topology`, `stations route`, `stations serve`, and `stations-mcp`
consume the same heartbeat rows. When Tailscale is available, route resolution
still uses `tailscale status --json` and falls back to Tailscale routes when LAN
or SSH routes are not verified.

Machine backups are preview-only unless `--apply --yes` is passed. The backup
target can be explicit or environment-backed:

```bash
stations backup --bucket fleet-backups --prefix stations --json
STATIONS_S3_BUCKET=fleet-backups stations backup --json
```

`--bucket` and `--prefix` always win. Without `--bucket`, the backup command
uses `HASNA_STATIONS_S3_BUCKET` or fallback `STATIONS_S3_BUCKET`; prefix uses
`HASNA_STATIONS_S3_PREFIX`, fallback `STATIONS_S3_PREFIX`, or `stations`.
This keeps the open-source CLI local/self-hosted by default while allowing
deployments to route app-owned backups through explicit storage metadata.

## Applications and tooling

```bash
stations apps list --machine mac-lab-01
stations apps status --machine mac-lab-01
stations apps diff --machine mac-lab-01
stations apps plan --machine mac-lab-01 --json
stations apps apply --machine mac-lab-01 --yes

stations install-claude status --machine linux-dev-01
stations install-claude diff --machine linux-dev-01
stations install-claude plan --machine linux-dev-01 --tool claude codex --json
stations install-claude apply --machine linux-dev-01 --tool claude codex --yes

stations install-tailscale --machine mac-lab-01 --json
```

Custom apps can declare separate exact install and probe commands through the
typed manifest JSON accepted by `stations manifest add --from-stdin`. The
probe must exit successfully and emit either `installed=0` or both
`installed=1` and a non-empty `version=<value>` line:

```json
{
  "name": "skills",
  "manager": "custom",
  "packageName": "@hasna/skills",
  "installCommand": "bun install -g @hasna/skills@0.1.61",
  "probeCommand": "if version=$(skills --version 2>/dev/null); then printf 'installed=1\\nversion=%s\\n' \"$version\"; else printf 'installed=0\\n'; fi",
  "expectedVersion": "0.1.61"
}
```

`installCommand` and `probeCommand` must be declared together and are included
in the mutation plan digest. When `expectedVersion` is present, another version
is reported but does not count as installed. Legacy custom entries without
these fields retain their existing `packageName` install plus `command -v`
probe behavior. To roll back, replace the install command and expected version
with the exact earlier version; the changed plan requires fresh approval.

## Notifications

```bash
stations notifications add --id ops --type webhook --target https://example.com/hook --event sync_failed
stations notifications add --id cmd --type command --target /bin/sh --arg -c --arg 'printf "%s\n" "$HASNA_STATIONS_NOTIFICATION_EVENT"'
stations notifications list
stations notifications test --channel ops
stations notifications test --channel ops --apply --yes
stations notifications dispatch --event manual.test --message "hello fleet"
```

- `email` channels deliver through local `sendmail` or `mail` when available
- `webhook` channels deliver JSON via HTTP POST
- `command` channels execute an explicit command executable plus optional `--arg`
  values with `HASNA_STATIONS_NOTIFICATION_*` env vars; use `/bin/sh -c ...`
  explicitly if a shell is required

## Runtime Events

`stations runtime tmux-watch` probes tmux with `display-message` and emits shared
events without sending keys, killing panes, or changing tmux state.

```bash
stations runtime tmux-watch %11 --once --json
stations runtime tmux-watch session:0.1 --interval-ms 5000 --approval-token "$TOKEN"
stations runtime tmux-hook-plan --trusted-local-mutation --json
stations runtime tmux-hook-plan --approval-token "$TOKEN"
stations webhooks add https://example.com/hook --id tmux-alerts --type stations.tmux.pane_died
```

When a pane was present and later disappears, the command records
`stations.tmux.pane_died`. With `--once`, a missing pane records
`stations.tmux.pane_missing`; add `--no-deliver` to record without webhook
delivery. Runtime event delivery requires a scoped mutation approval token; local
no-deliver recording remains available for diagnostics.

`stations runtime tmux-hook-plan` prints a native tmux `pane-died` hook command
for operators that prefer tmux hooks over polling. It is read-only and does not
install hooks. Pass `--approval-token` when you want the generated hook command
to be scoped to a short-lived approval token, or pass
`--trusted-local-mutation` to generate a process-local
`HASNA_STATIONS_ALLOW_MUTATIONS=1` prefix for local event recording.

## Fleet hostnames (`stations hosts`)

Make every fleet machine reachable by its bare name from any other machine —
`curl http://machine001:3000` works the same on every box — without depending on
Tailscale MagicDNS being configured. `stations hosts` writes a managed block into
`/etc/hosts` for each machine in the manifest, choosing the best address:

1. `metadata.lanAddress` from the manifest, when it is on the local machine's `/24`
2. the peer's live direct Tailscale LAN endpoint (`CurAddr`) on the local `/24`
3. the peer's tailnet IP (`100.64.0.0/10`) — always routable, auto-routed over the
   LAN when co-located

```bash
stations hosts            # dry-run plan (default)
stations hosts plan -j    # JSON plan
stations hosts apply      # write /etc/hosts (uses sudo when the file is root-owned)
stations hosts plan --no-warm   # skip discovering LAN endpoints (faster, tailnet IPs)
```

By default the command first runs `tailscale ping` against online peers so their
LAN endpoints become visible and same-LAN stations resolve to their `192.168.x.x`
address (true LAN-direct) instead of the tailnet IP. Off-LAN or offline peers fall
back to the tailnet IP. The local machine is skipped. The managed block is delimited
by markers, so re-running `apply` only rewrites that block and leaves the rest of
`/etc/hosts` untouched.

### Direct @hasna/events bins

`@hasna/events` is a dependency of `@hasna/stations` and publishes its own
dependency-owned `events` and `hasna-events` binaries. Package managers may
install those aliases into an application's top-level `node_modules/.bin`, but
they are not part of the `@hasna/stations` command surface, release scripts,
daemon plans, MCP tools, or approval model. Use `stations events` and
`stations webhooks` for stations-scoped event operations; those commands enforce
stations mutation approval and bind scoped tokens to canonical arguments.

## Dashboard

```bash
stations serve --json
stations serve --port 7676
# Explicitly expose beyond loopback only on a trusted network:
stations serve --host 0.0.0.0 --port 7676
```

The dashboard exposes:

- `/` HTML dashboard
- `/health` health probe
- `/api/status` fleet status JSON
- `/api/topology` manifest, heartbeat, SSH, LAN, and Tailscale topology JSON
- `/api/routes` resolved route JSON for known stations
- `/api/stations/friendly-name` get, set, or clear a machine display label
- `/api/stations/details` consumer-safe machine details JSON
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
