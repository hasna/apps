# CLI reference

This page describes the command tree shipped by `@hasna/emails` 1.3.3. It was
checked against the live `--help` output in both `local` and `self_hosted`
modes. Use `emails <command> --help` for every option and argument; Commander
help is the option-level source of truth.

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
| `daemon` | `status`, `restart` |
| `logs` | `tail` |
| `db` | `migrate`, `status` for the self-hosted Postgres schema. |
| `self-hosted` | `key create/list/rotate/revoke` for operator application keys. |
| `auth` | `signup`, `login`, `logout`, `whoami`, `switch-tenant`, `verify-email`, `bootstrap` |
| `keys` | `list`, `create`, `revoke` tenant-scoped API keys. |
| `ui` | Start the full-screen OpenTUI client. |
| `serve` | Start the local dashboard API or self-hosted service selected by mode. |
| `mcp` | Print or install MCP configuration for Claude Code, Codex, or Gemini. |
| `remove` / `uninstall` | Remove MCP configuration from supported agent clients. |
| `status` | Redacted health and next actions. |
| `stats`, `analytics`, `monitor` | Delivery statistics and monitoring. |
| `doctor` | Diagnostics; `doctor delivery <address>` diagnoses missing inbound mail. |
| `provision` | Registered compatibility namespace; intentionally not implemented (see below). |

Standalone aliases are also shipped for common actions: `addresses`, `log`,
`search`, `show`, `replies`, `conversation`, `test`, `export`, `pull`,
`preview`, `scheduler`, `batch`, `completion`, `verify-email`, `code`, `links`,
`forward`, `reply`, and `whoami`.

## Commands that intentionally refuse

Registration in help does not imply implementation. The following compatibility
and design-target commands fail with an actionable "not implemented in this
build" error in every deployment mode:

- every `emails provision *` subcommand;
- `emails domain connect`, `verify`, `status`, `setup-cloudflare`, and `setup`;
- `emails domains connect`, `verify`, `enable-inbound`, `enable-outbound`, and
  `disable-outbound`;
- `emails address provision`.

Use `emails domains status` for stored domain state, `emails domain check` for
live public DNS, `emails domain adopt` for an already verified provider domain,
and `emails aws setup-inbound` for SES/S3 inbound wiring.

`emails domain add` provisions the full inbound chain by default: it registers
the domain AND ensures the SES receipt rule into the inbound S3 bucket (the
same merge-safe path as `emails aws setup-inbound`). When the receipt rule
cannot be provisioned from the current context (no bucket, no AWS
credentials), it refuses before writing anything rather than registering a
domain that silently bounces its mail; `--send-only` is the explicit opt-out
for domains that should not receive. `emails domain readiness [domain]`
audits the live chain per domain — MX, the active SES receipt rule, the app
registration, and best-effort S3 delivery evidence — reporting each link as
ok / MISSING / unknown with the fix, and exits non-zero when any registered
domain has drifted into the half-provisioned shape.

## Mode differences

The root command names are the same in both modes, but storage and capability
checks may refuse an operation that the selected store cannot perform.
`emails inbox attachments` (cursor-based attachment inventory) is present only
for the hosted client; `emails inbox attachment <email-id>` exists in both
modes. Hosted mode is selected by the shared credential resolver
(`HASNA_EMAILS_API_URL` / `HASNA_EMAILS_API_KEY` or the one-release
`EMAILS_SELF_HOSTED_URL` / `EMAILS_SELF_HOSTED_API_KEY` aliases, the macOS
Keychain items for this app, or `~/.hasna/emails/config/credentials`); local
mode is reached ONLY by an explicit `HASNA_EMAILS_DB_PATH` / `EMAILS_DB_PATH`,
and a local run prints `emails: local mode` on stderr. `emails serve` defaults
to the local dashboard API at `127.0.0.1:3900` in local mode and the
self-hosted `/v1` service at `0.0.0.0:8080` in hosted mode.

## Other shipped bins

`emails-mcp` uses stdio by default. `--http` opts into Streamable HTTP,
`-p/--port` selects the port, and HTTP refuses to start without
`EMAILS_MCP_HTTP_TOKEN`. `--stdio`, `--version`, and `--help` are also
available.

`emails-serve` starts the same mode-selected HTTP service and also ships these
operator commands:

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
| `EMAILS_SELF_HOSTED_URL` | One-release alias for `HASNA_EMAILS_API_URL` (one rung below canonical). |
| `EMAILS_SELF_HOSTED_API_KEY` | One-release alias for `HASNA_EMAILS_API_KEY` (one rung below canonical). |
| `EMAILS_SESSION_TOKEN` | The app's own user session; wins as the bearer credential. |
| `EMAILS_IDP_TOKEN` | The app's own agent identity token; wins over the resolved key. |
| `EMAILS_CLIENT_ENV_SECRET` | Secrets-vault pointer persisting the session/identity tokens (no longer delivers URL or key). |
| `HASNA_EMAILS_DB_PATH` / `EMAILS_DB_PATH` | Explicit local SQLite file — the ONLY way into local mode. |
| `HASNA_HOME` / `HASNA_CONFIG_HOME` | Relocate `~/.hasna/emails/config/credentials`. |
| `HASNA_STATION` | Keychain account (falls back to `hostname -s`, then `$USER`). |

Credential tiers: `--api-key` / `--profile` argument → `HASNA_EMAILS_API_KEY_REF`
pointers → the macOS Keychain items for this app (`api-key` / `api-url`) → the
`~/.hasna/emails/config/credentials` file (0600) → `HASNA_EMAILS_API_KEY`.
Authority: `HASNA_EMAILS_API_URL` → Keychain `api-url` → credentials file → the
shared default gateway once a credential resolves. Nothing configured fails
closed; hosted runs with no credential never fall back to local data.
