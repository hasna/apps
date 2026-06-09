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
const route = resolveMachineRoute("spark01");
const workspace = resolveMachineWorkspace({
  machineId: "spark01",
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
machines route --machine spark01 --json
```

Consumers that need repo paths can resolve trust-aware workspace mappings
without importing the full machines app:

```ts
import { resolveMachineWorkspace } from "@hasna/machines/consumer";

const workspace = resolveMachineWorkspace({
  machineId: "spark01",
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
machines workspace resolve --machine spark01 --project open-knowledge --repo open-knowledge --json
machines workspace doctor --machine spark01 --project open-knowledge --repo open-knowledge --json
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
machines workspace repair --machine spark01 --project open-knowledge --repo open-knowledge --json
machines workspace repair --machine spark01 --project open-knowledge --repo open-knowledge --apply --json
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

Machine backups are preview-only unless `--apply --yes` is passed. The backup
target can be explicit or environment-backed:

```bash
machines backup --bucket fleet-backups --prefix machines --json
HASNA_MACHINES_S3_BUCKET=hasna-xyz-opensource-machines-prod machines backup --json
```

`--bucket` and `--prefix` always win. Without `--bucket`, the backup command
uses `HASNA_MACHINES_S3_BUCKET` or fallback `MACHINES_S3_BUCKET`; prefix uses
`HASNA_MACHINES_S3_PREFIX`, fallback `MACHINES_S3_PREFIX`, or `machines`.
This keeps the open-source CLI local/self-hosted by default while allowing
Hasna deployments to route app-owned backups through canonical storage metadata.

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
