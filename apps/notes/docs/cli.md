# Hasna Notes CLI reference

`notes` — authenticated HTTPS client for the notes service (personalnotes/v1
dialect at the `/v1` authority root).

## Usage

```
notes list [--json] [--limit 10] [--cursor value] [--include-deleted]
notes get <id> [--json]
notes create [--title text] [--body text | --body-file path] [--label name ...] [--json]
notes update <id> [--title text] [--body text | --body-file path] [--label name ...] [--json]
notes delete <id> [--yes|--force] [--json]
notes archive <id> [--json]
notes restore <id> [--json]
notes labels list [--json]
notes labels assign <note-id> <name> [--json]
notes labels unassign <note-id> <name> [--json]
notes markdown commands [--json]
notes markdown render <id> [--json]
notes markdown plain-text <id> [--json]
notes markdown apply-command <command-id> --text markdown [--selection-start n] [--selection-end n] [--url href] [--json]
notes storage status [--json]
notes storage migrate-legacy-path --source legacy|nested|server-nested (--dry-run|--yes --plan-fingerprint <sha256>) [--json]
```

## Client configuration

Resolved per request through `@hasna/contracts` (hasna/apps#1720).

| Variable | Role | Notes |
|---|---|---|
| `HASNA_NOTES_API_URL` | authority | Defaults to the fleet gateway `https://api.hasna.com/notes`. |
| `HASNA_NOTES_API_KEY` | key (env tier) | Read below Keychain and disk. |
| `HASNA_NOTES_API_KEY_OVERRIDE` | deliberate key | Outranks everything; never falls through. |
| `HASNA_PROFILE` | identity | Selects `credentials-<profile>`. |
| `HASNA_NOTES_API_KEY_REF` | vault pointer | Resolved through the secrets SDK at request time. |
| `HASNA_HOME` / `HASNA_CONFIG_HOME` | layout | Replace `~/.hasna` / the config root. |
| `HASNA_NOTES_DATABASE_URL` | server-only | Presence in a client process fails closed. |

Keychain item `hasna.credentials.notes.api-key` (and `api-url`), then
`~/.hasna/notes/config/credentials`, then the env tier. Missing configuration
exits non-zero and never touches a local store.

## Exit codes

- `0` — success (including confirmation-gated flows that ran with `--yes`).
- `1` — configuration/transport/server error; the message names the consulted
  credential tiers, never a value.
- `2` — destructive action refused without confirmation in a non-interactive
  context (JSON mode answers `{"ok":false,"requiresConfirmation":true}` with
  exit code `0`).

## Server surface

`notes-serve` — self-hosted PostgreSQL server (see `server/README.md`).
`notes-mcp` — stdio MCP server exposing the same remote-safe operations.