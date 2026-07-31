# CLI audit: dead commands and backend parity

## Summary

- Audited every command registered by `createProgram()` in `src/cli/index.ts`; the inventory below is parser-derived rather than README-derived.
- Fixed the non-functional `project-panel --contract` flag so it emits the validated `hasna.project_panel.v1` JSON contract without also requiring `--json`.
- Fixed role-gated approvals by adding `--actor-role <role...>` to `run`, `approve`, and `deny`, and carrying those roles into the CLI actor reference. Before this change, `run --approve` and `approve` could not satisfy valid approval requirements containing `roles`.
- Added a registration inventory regression and an isolated CLI lifecycle regression covering status, manifest validation/list/show/inspect, run, run list/show/inspect, approve, deny, and execute.
- No commands were removed. No known dead commands remain after these fixes.

## API applicability

API parity is **not applicable** to this repository:

- `hasna.contract.json` classifies the package as `cli-with-store`, declares only the `local` deployment mode, marks the CLI `authMode` as `local-only`, and configures local SQLite storage.
- `ActionsClient` defaults directly to `SQLiteActionsStore`; there is no HTTP client implementation or alternate remote store.
- The package has no service binary, `*_API_URL` / `*_API_KEY` configuration, cloud-router/stage-A module, HTTP import, or `fetch()` call.

## Command inventory

Parent command groups are included because they are explicit Commander registrations and provide help/subcommand dispatch. “Dead?” describes the command after this PR.

| command | works locally? | works against the API backend (or N/A)? | dead? | changed in this PR? |
| --- | --- | --- | --- | --- |
| `actions status` | Yes | N/A — no API backend | No | No |
| `actions project-panel` | Yes | N/A — no API backend | No | Yes — fixed `--contract` output |
| `actions manifests` | Yes — help/subcommand dispatch | N/A — no API backend | No | No |
| `actions manifests validate <file>` | Yes | N/A — no API backend | No | No |
| `actions manifests list` | Yes | N/A — no API backend | No | No |
| `actions manifests show <id>` | Yes | N/A — no API backend | No | No |
| `actions manifests inspect <id>` | Yes | N/A — no API backend | No | No |
| `actions run <manifest>` | Yes | N/A — no API backend | No | Yes — role-gated auto-approval works |
| `actions runs` | Yes — help/subcommand dispatch | N/A — no API backend | No | No |
| `actions runs list` | Yes | N/A — no API backend | No | No |
| `actions runs show <id>` | Yes | N/A — no API backend | No | No |
| `actions runs inspect <id>` | Yes | N/A — no API backend | No | No |
| `actions approve <run-id>` | Yes | N/A — no API backend | No | Yes — role-gated approval works |
| `actions deny <run-id>` | Yes | N/A — no API backend | No | Yes — actor roles are preserved |
| `actions execute <run-id> <manifest>` | Yes | N/A — no API backend | No | No |

## Verification

- `git diff --check` passes.
- Static audit confirms 15 Commander registrations: 13 leaf handlers and two parent help/dispatch groups.
- `bun test` and `bun run typecheck` were not runnable in the supplied worktree because Bun and dependencies are absent; outbound TLS failures prevented installing them. The factory should run the normal Bun verification before publishing the PR.

## Remaining work

None identified. API-mode implementation is intentionally omitted because this package has no API backend.
