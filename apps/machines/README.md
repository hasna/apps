# @hasna/machines

Machine fleet management for developers — provision, sync, and manage multiple dev machines from CLI and MCP.

## Planned surface

- `machines`: Commander-based CLI for manifest, setup, sync, and status commands
- `machines-mcp`: MCP server exposing fleet tools to AI agents
- `machines-agent`: lightweight local daemon for heartbeats and runtime reporting

## Manifest

`machines.json` is the desired fleet declaration. Current commands:

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
```

## Applications and tooling

```bash
machines apps list --machine apple03 --json
machines apps plan --machine apple03 --json
machines apps apply --machine apple03 --yes

machines install-claude --machine spark01 --json
machines install-claude --machine spark01 --tool claude codex --apply --yes

machines install-tailscale --machine apple03 --json
machines notifications add --id ops --type webhook --target https://example.com/hook --event sync_failed
machines notifications test --channel ops --json
```

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

## Local development

```bash
bun install
bun test
bun run typecheck
bun run build
bun run src/cli/index.ts --help
```
