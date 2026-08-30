# @hasna/contacts

Contact management for AI coding agents — CLI + MCP + Web

[![npm](https://img.shields.io/npm/v/@hasna/contacts)](https://www.npmjs.com/package/@hasna/contacts)
[![License](https://img.shields.io/badge/license-Apache--2.0-blue)](LICENSE)

## Install

```bash
npm install -g @hasna/contacts
```

## CLI Usage

```bash
contacts --help
```

## Audiences, consent, and suppression

Audience segments implement the `hasna.audience.v1` contract (distribution
apps plan): predicate definitions over contact tags, attributes (columns or
custom fields), and group membership, resolved to per-channel recipient lists
that honor consent and suppression.

```bash
contacts audience create beta-testers \
  --name "Beta testers" \
  --predicates '[{"kind":"tag","value":"beta"}]' \
  --policy opt_in
contacts audience list
contacts audience show beta-testers          # hasna.audience.v1 document
contacts audience resolve beta-testers --channel email    # email|telegram|sms
contacts consent set CONTACT_ID --channel email --status opt_in
contacts suppression add someone@example.com --channel email --reason unsubscribe
contacts suppression sync --dry-run          # push unsubscribes to mailery
```

Resolution always excludes archived and `do_not_contact` contacts and
suppressed addresses; the audience `--policy` (`opt_in`, `opt_out`,
`transactional`, `none`) controls how per-channel consent is applied.
`contacts suppression sync` pushes unsynced email suppressions to mailery via
`@hasna/mailery` when it is installed; any other backend can implement the
`SuppressionSyncAdapter` interface exported from the package.

## MCP Server

```bash
contacts-mcp
```

## HTTP mode

Long-lived Streamable HTTP transport (stateless, bind `127.0.0.1` only):

```bash
contacts-mcp --http              # default port 8809
contacts-mcp --http --port 8809
MCP_HTTP=1 contacts-mcp
```

- Health: `GET http://127.0.0.1:8809/health`
- MCP: `http://127.0.0.1:8809/mcp`

The REST server (`contacts-serve`) also exposes `/health` and `/mcp` when running.

## REST API

```bash
contacts-serve
```

`contacts-serve` binds to `127.0.0.1` by default. Use `--host <host>` or
`CONTACTS_HOST=<host>` only when intentionally exposing it beyond loopback.
Shared binds still fail closed unless a valid contacts token is configured and
sent with the request. The unauthenticated local development fallback is disabled
by default and only activates when all of the following are true:

- no contacts API token environment variable is configured
- `CONTACTS_ALLOW_UNAUTHENTICATED_LOOPBACK=1`
- the server is explicitly bound to a loopback host

The fallback does not trust the HTTP `Host` header.

## Storage

Contacts owns its local SQLite storage directly. It does not depend on shared
cloud runtime commands or MCP tools.

```bash
contacts storage status
contacts storage status --json
contacts storage push --tables contacts,companies
contacts storage pull --tables contacts,companies
contacts storage sync
```

Optional cross-machine sync uses contacts-owned PostgreSQL storage. Set one of:

```bash
export HASNA_CONTACTS_POSTGRES_URL="postgres://..."
# or OPEN_CONTACTS_POSTGRES_URL / CONTACTS_POSTGRES_URL
```

Remote PostgreSQL connections require verified TLS for non-local hosts. Local
PostgreSQL development URLs can disable TLS explicitly.

By default, remote sync covers contacts, companies, tags, and the other
non-sensitive relationship tables. `webhooks`, `contact_documents`, and
`contact_health` are excluded until explicitly requested with `--tables` and
`HASNA_CONTACTS_ALLOW_SENSITIVE_SYNC=1`. Sync inserts or updates rows with
timestamp conflict protection. Deletes for `contacts`, `companies`, and `tags`
write `_contacts_tombstones`; push/pull sync carries those tombstones and pull
applies them unless the local row has a newer `updated_at`.

Shared REST/dashboard deployments must set one of
`HASNA_CONTACTS_API_TOKENS`, `OPEN_CONTACTS_API_TOKENS`, or
`CONTACTS_API_TOKENS`. Values are comma-separated `token=scope scope` records.
Supported scopes include `contacts:read`, `contacts:write`,
`contacts:import`, `contacts:export`, `contacts:export:full`,
`documents:read`, `images:read`, `images:write`, `companies:*`, `tags:*`,
`stats:read`, `dashboard:read`, and `mcp:access`. Loopback-only development
without configured tokens remains allowed; shared hosts fail closed.

Server exports are redacted by default: email addresses, phone numbers,
addresses, notes, birthdays, social profiles, and custom fields are withheld.
Full exports require both `contacts:export` and `contacts:export:full`. Export,
import, document file read, image mutation, contact mutation, company mutation,
and tag mutation routes write audit entries. Document attachments are served
only from the managed contacts documents directory and use private `no-store`
cache headers.

`contacts cloud status`, `contacts cloud push`, `contacts cloud pull`, and
`contacts cloud sync` remain compatibility aliases for the contacts-owned
storage commands. They do not load or depend on the deprecated shared cloud
runtime. `contacts cloud feedback` saves feedback locally in the contacts
database.

## Data Directory

On-box data resolves through the XDG dirs per `@hasna/paths`:

- documents, the SQLite store, `config.json` and the vault config live in the
  **XDG data root**: `~/.local/share/hasna/contacts/` (or `$HASNA_DATA_HOME/contacts`).
- the vault session state lives in the **XDG state root**:
  `~/.local/state/hasna/contacts/` (or `$HASNA_STATE_HOME/contacts`).

The legacy `~/.hasna/contacts/` home is never written to; on first use any
pre-existing legacy store is adopted into the XDG roots (never clobbering an
existing XDG store).

## License

Apache-2.0 -- see [LICENSE](LICENSE)
