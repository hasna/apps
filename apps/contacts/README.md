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
`contact_health` are excluded until explicitly requested with `--tables`. Sync
is a non-destructive merge: it inserts or updates rows and does not propagate
deletes or tombstones.

`contacts cloud status`, `contacts cloud push`, `contacts cloud pull`, and
`contacts cloud sync` remain compatibility aliases for the contacts-owned
storage commands. They do not load or depend on the deprecated shared cloud
runtime. `contacts cloud feedback` saves feedback locally in the contacts
database.

## Data Directory

Data is stored in `~/.hasna/contacts/`.

## License

Apache-2.0 -- see [LICENSE](LICENSE)
