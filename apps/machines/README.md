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

## Manifest

`machines.json` is the desired fleet declaration.

```bash
machines manifest init
machines manifest bootstrap
machines manifest add --id linux-dev-01 --platform linux --workspace-path ~/workspace
machines manifest add --id mac-lab-01 --platform macos --workspace-path ~/Workspace --app ghostty:cask
machines manifest validate
machines manifest list
```

## Provision and reconcile

```bash
machines setup --machine linux-dev-01 --json
machines setup --machine linux-dev-01 --apply --yes
machines sync --machine linux-dev-01 --json
machines sync --machine linux-dev-01 --apply --yes
machines doctor --machine linux-dev-01
machines self-test
```

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
  getLocalMachineTopology,
  resolveMachineRoute,
  resolveMachineWorkspace,
  validateMachinesConsumerEnvelope,
} from "@hasna/machines/consumer";

console.log(MACHINES_CONSUMER_CONTRACT.schema_version);
const topology = discoverMachineTopology();
const local = getLocalMachineTopology();
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

The package includes `schemas/machines-consumer.schema.json` and also exports
`MACHINES_CONSUMER_SCHEMA_BUNDLE`, `getMachinesConsumerSchemaBundle()`, and
`validateMachinesConsumerEnvelope()`. Downstream apps can use these helpers to
validate route, workspace, compatibility, and resolver-snapshot envelopes
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
machines topology --no-tailscale --json
machines route --machine linux-dev-01 --json
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
machines notifications list
machines notifications test --channel ops
machines notifications test --channel ops --apply --yes
machines notifications dispatch --event manual.test --message "hello fleet"
```

- `email` channels deliver through local `sendmail` or `mail` when available
- `webhook` channels deliver JSON via HTTP POST
- `command` channels execute the configured command with `HASNA_MACHINES_NOTIFICATION_*` env vars

## Runtime Events

`machines runtime tmux-watch` probes tmux with `display-message` and emits shared
events without sending keys, killing panes, or changing tmux state.

```bash
machines runtime tmux-watch %11 --once --json
machines runtime tmux-watch session:0.1 --interval-ms 5000
machines webhooks add https://example.com/hook --id tmux-alerts --type machines.tmux.pane_died
```

When a pane was present and later disappears, the command records
`machines.tmux.pane_died`. With `--once`, a missing pane records
`machines.tmux.pane_missing`; add `--no-deliver` to record without webhook
delivery.

## Dashboard

```bash
machines serve --json
machines serve --host 0.0.0.0 --port 7676
```

The dashboard exposes:

- `/` HTML dashboard
- `/health` health probe
- `/api/status` fleet status JSON
- `/api/manifest` current manifest JSON
- `/api/notifications` notification channel JSON
- `/api/doctor` doctor report JSON
- `/api/self-test` smoke-check JSON
- `/api/apps/status` app inventory JSON
- `/api/apps/diff` app drift JSON
- `/api/install-claude/status` CLI inventory JSON
- `/api/install-claude/diff` CLI drift JSON
- `/api/notifications/test` POST endpoint for test delivery

## Local development

```bash
bun install
bun test
bun run typecheck
bun run build
bun run src/cli/index.ts --help
```
