# @hasna/machines

Machine fleet management for developers — provision, sync, inspect, and operate multiple development machines from CLI and MCP.

## Binaries

- `machines`: Commander-based CLI for manifest, setup, sync, inspection, and dashboard commands
- `machines-mcp`: MCP server exposing fleet tools to AI agents
- `machines-agent`: lightweight local daemon for heartbeats and runtime reporting

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
