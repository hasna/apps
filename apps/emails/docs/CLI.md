# CLI reference

This page describes the current command tree shipped by `@hasna/emails`. Use
`emails <command> --help` for every option and argument; Commander help is the
option-level source of truth. Ordinary CLI, terminal UI, and MCP operations are
hosted API clients. Explicit storage-library and standalone-server compatibility
surfaces are documented separately below.

## Global options

`emails` accepts `--json`, `--quiet`, `--verbose`, `--version`, and `--help`.
With `--json`, successful structured output is written to stdout and structured
errors are written to stderr.

## Root command tree

| Root command | Subcommands or purpose |
| --- | --- |
| `provider` | `add`, `list`, `remove`, `update`, `status`, `check`, `sync` |
| `domain` | `add`, `connect`, `adopt`, `readiness`, `list`, `dns`, `verify`, `status`, `usable`, `move-provider`, `remove`, `check`, `setup-cloudflare`, warming commands, `available`, `buy`, `purchase-status`, `list-registered`, `setup` |
| `domains` | `list`, `status`, `add`, `connect`, `dns`, `verify`, `check`, `enable-inbound`, `enable-outbound`, `disable-outbound` |
| `address` | `add`, `list`, `owner`, ownership changes/history, `suggest`, `provision`, `verify`, `set-verified`, `remove`, `suspend`, `activate`, `quota` |
| `send` | Send one message; supports templates, attachments, scheduling, tracking, and idempotency options where the selected store supports them. |
| `email` | `list`, `search`, `show`, `replies`, `thread`, `send` |
| `webhook` | `listen` for provider event webhooks. |
| `template` | `add`, `list`, `show`, `remove` |
| `contact` / `contacts` | `list`, `suppress`, `unsuppress` |
| `group` | `create`, `list`, `show`, `members`, `add`, `remove-member`, `delete` |
| `sequence` | `create`, `list`, `show`, `pause`, `archive`, enrollment commands, and `step add/list/remove` |
| `schedule` / `scheduled` | `list`, `cancel`, `run` |
| `inbox` | Code waiting, list/search/read, mailbox/source status, state changes, attachments, deletion, S3 sync, realtime setup/watch, SMTP listen, and local open. |
| `owner` | `register`, `list`, `addresses` |
| `alias` | `add`, `catch-all`, `global`, `list`, `remove`, `resolve` |
| `sendkey` | `create`, `list`, `revoke`, `check` |
| `send-intent` | `uncertain`, `reconcile` |
| `forwarding` | `add`, `list`, `enable`, `disable`, `remove`, `run`, `explain` |
| `aws` | `setup-inbound`, `status` |
| `agent` | `context` |
| `daemon` | `start`, `status`, `restart` |
| `logs` | `tail` |
| `db` | `migrate`, `status` for the self-hosted Postgres schema. |
| `self-hosted` | `key create/list/rotate/revoke` for operator application keys. |
| `auth` | `signup`, `login`, `logout`, `whoami`, `switch-tenant`, `verify-email`, `bootstrap` |
| `keys` | `list`, `create`, `revoke` tenant-scoped API keys. |
| `ui` | Start the full-screen OpenTUI client. |
| `serve` | Start the compatibility server command; server storage follows `EMAILS_DATABASE_URL`. |
| `mcp` | Print or install MCP configuration for Claude Code, Codex, or Gemini. |
| `remove` / `uninstall` | Remove MCP configuration from supported agent clients. |
| `status` | Redacted health and next actions. |
| `stats`, `analytics`, `monitor` | Delivery statistics and monitoring. |
| `doctor` | Diagnostics; `doctor delivery <address>` diagnoses missing inbound mail. |
| `provision` | `status`, durable `up`, `job`, `retry`, and `daemon` provisioning workflows. |

Standalone aliases are also shipped for common actions: `addresses`, `log`,
`search`, `show`, `replies`, `conversation`, `test`, `export`, `pull`,
`preview`, `scheduler`, `batch`, `completion`, `verify-email`, `code`, `links`,
`forward`, `reply`, and `whoami`.

## Capability-gated commands

Current domain and address orchestration is implemented through authenticated
`/v1` routes. `emails domain connect`, `setup-cloudflare`, and `setup`,
`emails address provision`, and `emails provision up|job|retry|daemon` return
durable server receipts and refuse when the selected server is too old or lacks
the required provider binding. They never substitute local state for a refused
or unavailable API operation.

`emails domain add` provisions the full inbound chain by default: it registers
the domain and ensures the SES receipt rule into the inbound S3 bucket. When the
current operator context cannot prove that route, it refuses before creating a
half-configured domain; `--send-only` is the explicit opt-out. `emails domain
readiness [domain]` audits MX, provider routing, app registration, and available
delivery evidence, reporting each link as `ok`, `MISSING`, or `unknown`.

Provider-owned mutations remain capability- and authorization-gated. A command
appearing in help does not imply that every deployed server or principal may run
it; use the returned refusal and `emails <command> --help` rather than falling
back to a local database.

## Client and server storage boundaries

Storage and capability checks fail closed when the selected authority cannot
serve an operation.
`emails inbox attachments` (cursor-based attachment inventory) is present only
for the hosted client; `emails inbox attachment <email-id>` exists in both
modes. Hosted mode is selected by the shared credential resolver
(`HASNA_EMAILS_API_URL` / `HASNA_EMAILS_API_KEY`, the macOS
Keychain items for this app, or `~/.hasna/emails/config/credentials`; the retired
`EMAILS_SELF_HOSTED_*` aliases are refused by name); the local store is reached
ONLY through the standard opt-in `HASNA_EMAILS_LOCAL=1` (alias `EMAILS_LOCAL=1`) with
no API authority or credential configured — a `HASNA_EMAILS_DB_PATH` /
`EMAILS_DB_PATH` alone only names the file and is refused — and a local run
prints one `emails: LOCAL mode — …` line on stderr. The `emails` and
`emails-mcp` bins are hosted-only and reject both local selectors. Automatic storage-library selection requires the explicit local opt-in. Direct
low-level constructors with a caller-owned Database remain explicit compatibility
surfaces and do not invoke automatic selection.
The standalone `emails-serve` server has a separate backend contract:
`EMAILS_DATABASE_URL` selects PostgreSQL for `/v1`; the loopback SQLite dashboard
requires the explicit `HASNA_EMAILS_LOCAL=1` (or `EMAILS_LOCAL=1`) opt-in with
`EMAILS_DATABASE_URL` unset. Missing both settings refuses startup.

## Other shipped bins

`emails-mcp` uses stdio by default. `--http` opts into Streamable HTTP,
`-p/--port` selects the port, and HTTP refuses to start without
`EMAILS_MCP_HTTP_TOKEN`. `--stdio`, `--version`, and `--help` are also
available.

`emails-serve` starts the server backend selected by `EMAILS_DATABASE_URL` and
also ships these operator commands:

- `ingest-worker`
- `ingest-s3-backfill`
- `attachment-repair-canary`
- `attachment-repair-ledger`
- `inbound-provenance-audit`
- `inbound-provenance-fence`

Run `emails-serve --help` before an operator workflow; these commands have
strict environment, provenance, and argument requirements.

## Environment reference (hosted client)

The hosted Emails API client resolves its authority and credential through the
shared `@hasna/contracts` resolver, fresh on every request:

| Variable | Role |
|---|---|
| `HASNA_EMAILS_API_URL` | Canonical hosted API origin. Overrides the Keychain `api-url` item and the credentials file. |
| `HASNA_EMAILS_API_KEY` | Canonical hosted API key (one of the resolver's credential tiers). |
| `EMAILS_SELF_HOSTED_URL` | RETIRED: refused by name; set `HASNA_EMAILS_API_URL`. |
| `EMAILS_SELF_HOSTED_API_KEY` | RETIRED: refused by name; set `HASNA_EMAILS_API_KEY`. |
| `EMAILS_SESSION_TOKEN` | The app's own user session; wins as the bearer credential. |
| `EMAILS_IDP_TOKEN` | The app's own agent identity token; wins over the resolved key. |
| `EMAILS_CLIENT_ENV_SECRET` | Secrets-vault pointer persisting the session/identity tokens (no longer delivers URL or key). |
| `HASNA_EMAILS_LOCAL` / `EMAILS_LOCAL` | The ONLY client-side local opt-in (storage library); honoured only with no API authority or credential configured. |
| `HASNA_EMAILS_DB_PATH` / `EMAILS_DB_PATH` | Location of the local SQLite file under the opt-in; alone it selects nothing. |
| `HASNA_HOME` / `HASNA_CONFIG_HOME` | Relocate `~/.hasna/emails/config/credentials`. |
| `HASNA_STATION` | Keychain account (falls back to `hostname -s`, then `$USER`). |

Credential tiers: the deliberate `HASNA_EMAILS_API_KEY_OVERRIDE` / `HASNA_PROFILE`
selections (a blank override or an absent profile refuses; a
`HASNA_EMAILS_API_KEY_REF` vault pointer is refused by name, because this client
cannot complete it per request) → the macOS Keychain items for this app
(`api-key` / `api-url`) → the `~/.hasna/emails/config/credentials` file (0600,
`credentials-<profile>` under `HASNA_PROFILE`) → `HASNA_EMAILS_API_KEY`. There are
no `--api-key` / `--profile` resolver flags on the `emails` CLI.
Authority: `HASNA_EMAILS_API_URL` → Keychain `api-url` → credentials file → the
shared default gateway once a credential resolves. Nothing configured fails
closed; hosted runs with no credential never fall back to local data.
