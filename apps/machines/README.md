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
machines manifest add --id spark01 --platform linux --workspace-path ~/workspace
machines manifest add --id apple03 --platform macos --workspace-path ~/Workspace --app ghostty:cask
machines manifest validate
machines manifest list
```

## Provision and reconcile

```bash
machines setup --machine spark01 --json
machines setup --machine spark01 --apply --yes
machines sync --machine spark01 --json
machines sync --machine spark01 --apply --yes
machines doctor --machine spark01
machines self-test
```

## Topology SDK

`@hasna/machines` exposes a compact topology SDK for other open-core packages
that need machine identity without importing CLI internals. Consumers that only
need the stable app-to-app contract should import `@hasna/machines/consumer`:

```ts
import { discoverMachineTopology, getLocalMachineTopology, resolveMachineRoute } from "@hasna/machines/consumer";

const topology = discoverMachineTopology();
const local = getLocalMachineTopology();
const route = resolveMachineRoute("spark01");
```

The SDK merges manifest entries, local heartbeats, SSH route hints, and
`tailscale status --json` peers when Tailscale is available. Consumers such as
`@hasna/knowledge` should treat this package as optional: dynamically import it
when present, and fall back to local probes or app-local machine registries when
it is absent.

Topology, route, and compatibility JSON include `schema_version`, package
version metadata, and capability flags. The current consumer contract version is
`1`.

CLI and MCP expose the same topology view:

```bash
machines topology --json
machines topology --no-tailscale --json
machines route --machine spark01 --json
```

## Compatibility SDK

Open-core consumers can use `@hasna/machines` to preflight a peer before
attempting app-level sync:

```ts
import { checkMachineCompatibility } from "@hasna/machines/consumer";

const report = checkMachineCompatibility({
  machineId: "spark01",
  commands: [{ command: "bun" }],
  packages: [{ name: "@hasna/knowledge", command: "knowledge", expectedVersion: "0.2.29" }],
  workspaces: [{
    label: "open-knowledge",
    path: "/home/hasna/workspace/hasna/opensource/open-knowledge",
    expectedPackageName: "@hasna/knowledge",
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
machines compatibility --machine spark01 \
  --command bun \
  --package @hasna/knowledge:knowledge:0.2.29 \
  --workspace open-knowledge=/home/hasna/workspace/hasna/opensource/open-knowledge:@hasna/knowledge:0.2.29 \
  --json
```

## Storage

Machines stores runtime data locally in SQLite under the Hasna data directory and includes repo-owned PostgreSQL migrations for remote storage deployments.

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

## Applications and tooling

```bash
machines apps list --machine apple03
machines apps status --machine apple03
machines apps diff --machine apple03
machines apps plan --machine apple03 --json
machines apps apply --machine apple03 --yes

machines install-claude status --machine spark01
machines install-claude diff --machine spark01
machines install-claude plan --machine spark01 --tool claude codex --json
machines install-claude apply --machine spark01 --tool claude codex --yes

machines install-tailscale --machine apple03 --json
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
