# @hasna/contacts

Contact management for AI coding agents — CLI + MCP + authenticated HTTP API

[![npm](https://img.shields.io/npm/v/@hasna/contacts)](https://www.npmjs.com/package/@hasna/contacts)
[![License](https://img.shields.io/badge/license-Apache--2.0-blue)](LICENSE)

## Install

```bash
npm install -g @hasna/contacts
```

## Configure the client

Every CLI, MCP, and package data operation uses one authenticated HTTPS `/v1`
authority. There is no built-in hosted URL and no local database fallback.

```bash
export HASNA_CONTACTS_API_URL="https://contacts.example.com"
# Provision the API key through the @hasna/contracts credential chain. For
# example, put HASNA_CONTACTS_API_KEY in the shared fleet/config credential chain,
# or configure HASNA_CONTACTS_API_KEY_REF for the secrets client.
contacts connection --json
```

An absent or invalid URL/key fails closed. `HASNA_CONTACTS_STORAGE_MODE`,
`CONTACTS_STORAGE_MODE`, contacts DB-path variables, and contacts database URLs
are rejected in client processes. PostgreSQL URLs belong only to
`contacts-serve` and the migration task.

## CLI Usage

```bash
contacts status            # CLI version, API endpoint, storage mode, record counts
contacts status --json
contacts --help
```

`contacts status` answers even on a box without an API key: an unconfigured
client reports storage `unconfigured` (a failed request on a configured box
reports storage `error` with the failure message) instead of crashing, so
agents can observe the configuration drift the command exists to expose.


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

The REST server is a separate authenticated `/v1` surface.

## REST API

```bash
contacts-serve
```

`contacts-serve` binds to `127.0.0.1` by default. Use `--host <host>` or
`CONTACTS_HOST=<host>` only when intentionally exposing it beyond loopback. The
server requires PostgreSQL configuration and API-key signing configuration;
readiness fails closed when either is unavailable.

## Storage and legacy data

The client never opens SQLite or PostgreSQL. The server owns PostgreSQL and all
authoritative data remains server-side. Inspect the value-free connection state
with:

```bash
contacts connection --json
```

Retired local databases are never auto-adopted or silently ignored. The
explicit migration aid only inspects and copies them; it never opens, changes,
deletes, or selects one as the live store:

```bash
contacts legacy inspect --json
contacts legacy preserve --source /exact/path/contacts.db \
  --output /existing/directory/contacts.db.pre-https.20260901
```

If a SQLite WAL, journal, or shared-memory sidecar is present, preservation
refuses to proceed until every legacy process is stopped and the old client has checkpointed the database. To move
portable contact records, use a legacy release against the preserved copy to
export JSON, then run `contacts import exported.json` with the HTTPS client
configured. Existing files are never overwritten.

Preservation rejects source, ancestor, or output replacement races and verifies
the copied bytes with SHA-256 and stable output metadata before success. If a copy
fails after output creation, any private partial output is left untouched and
reported as unverified for manual inspection; the command never deletes a
pathname that another process might have replaced.

## License

Apache-2.0 -- see [LICENSE](LICENSE)
