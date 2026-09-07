# @hasna/contacts

Contact management for AI coding agents — CLI + MCP + authenticated HTTP API

[![npm](https://img.shields.io/npm/v/@hasna/contacts)](https://www.npmjs.com/package/@hasna/contacts)
[![License](https://img.shields.io/badge/license-Apache--2.0-blue)](LICENSE)

## Install

```bash
npm install -g @hasna/contacts
```

## Configure the client

Every CLI, MCP, and package data operation flows through one `Store`
abstraction whose transport is chosen automatically:

- a resolved authenticated HTTPS `/v1` authority (via the shared
  `@hasna/contracts` client chain, hasna/apps#1720, resolved fresh on every
  request) selects the hosted API transport;
- otherwise commands read and write the on-box SQLite store at the XDG data
  path (`~/.local/share/hasna/contacts/contacts.db`, or
  `HASNA_CONTACTS_DB_PATH`).

The storage-mode axis is retired: no `*_MODE` switch, DB-path selector, or DSN
gates, redirects, or refuses a command — every command works in either
transport.

Once a contacts API key resolves from any tier, the authority defaults to the
fleet gateway `https://api.hasna.com/contacts` — no URL configuration is
needed on a station. The credential tiers, in order:

1. explicit arguments / deliberate pointers — `HASNA_CONTACTS_API_KEY_OVERRIDE`, `HASNA_PROFILE`, `HASNA_CONTACTS_API_KEY_REF` (secrets vault)
2. macOS Keychain — `hasna.credentials.contacts.api-key` / `.api-url`, account `HASNA_STATION` → `hostname -s` → `$USER`
3. disk — `~/.hasna/contacts/config/credentials` (owner-only 0400/0600, `HASNA_CONTACTS_API_KEY=…` or the `HASNA_CONTACTS_API_URL=…` alias)
4. environment — `HASNA_CONTACTS_API_KEY`

| Env var | Meaning |
|---|---|
| `HASNA_CONTACTS_API_URL` | Explicit API base URL (HTTPS; overrides the fleet gateway). Legacy alias: `CONTACTS_API_URL`. |
| `HASNA_CONTACTS_API_KEY` | API key (env tier). Legacy alias: `CONTACTS_API_KEY`. |
| `HASNA_CONTACTS_API_KEY_OVERRIDE` | Deliberate per-run override that outranks the Keychain and disk. |
| `HASNA_CONTACTS_API_KEY_REF` | Secrets-vault pointer (`namespace/app/live/api_key`); terminal when unresolvable. |
| `HASNA_PROFILE` | Selects which identity (`credentials-<profile>`) the disk tier reads. |
| `HASNA_STATION` | Keychain account when set; else short hostname, then `$USER`. |
| `HASNA_HOME` | Replaces `~` for the `~/.hasna/…` credential/disk root. |
| `HASNA_CONFIG_HOME` | Replaces `~/.hasna/<app>/config` entirely. |

```bash
# Fully explicit:
export HASNA_CONTACTS_API_URL="https://contacts.example.com"
export HASNA_CONTACTS_API_KEY="…"     # or configure the Keychain/disk tiers
contacts connection --json
```

Without a resolved API authority and key, commands use the local SQLite store;
`contacts connection` reports `transport: "unconfigured"` for the API half and
`active_transport: "local"` for the store the commands actually use.
`HASNA_CONTACTS_STORAGE_MODE`, `CONTACTS_STORAGE_MODE`, contacts DB-path
variables, and contacts database URLs are inert in client processes — they
never switched a transport and now do nothing (the DB-path variables still
select the local SQLite file). PostgreSQL URLs belong to `contacts-serve` and
the migration task.

## CLI Usage

```bash
contacts status            # CLI version, resolved /v1 authority + sources, active transport, record counts
contacts status --json
contacts --help
```

`contacts status` reports the authority the shared resolver actually decided
(`api`, the `/v1` base URL) and where each half came from — `api_url_source`,
`api_key_source`, `api_key_tier`: an env key name, a Keychain item reference,
a credentials-file path, or `default` for the fleet gateway; never a value.
It answers even on a box without an API key: an unconfigured client reports
storage `local (sqlite)` with live local counts (a failed request on a
configured box reports storage `error` with the failure message) instead of
crashing, so agents can observe the configuration drift the command exists to
expose. `status` and `connection` are diagnostics and exit 0 with that report;
every data verb works against whichever transport is active.

## SDK

```ts
import { createContactsClient, ContactsV1Client } from "@hasna/contacts/sdk";

// Through the fleet resolver — the same @hasna/contracts chain the CLI and MCP
// server use: credential and authority resolved at construction, the key
// re-resolved on every request, the authority pinned. Nothing resolving throws.
const client = createContactsClient();
const { contacts } = await client.listContacts();

// Explicit pin: a caller-supplied baseUrl always requires a caller-supplied
// apiKey — the SDK never attaches an ambient credential to it.
const pinned = new ContactsV1Client({ baseUrl: "https://contacts.example.com", apiKey: "…" });
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

The client has two automatic transports: the hosted `/v1` API (PostgreSQL on
the server) when an API authority and key resolve, or the on-box SQLite store
at the XDG data path (`~/.local/share/hasna/contacts/contacts.db`, or
`HASNA_CONTACTS_DB_PATH`) when no API configuration resolves. PostgreSQL is a
server-only transport the client never opens. Inspect the value-free connection
state with:

```bash
contacts connection --json
```

SQLite files from retired releases are never auto-adopted or silently ignored:
the live client reads and writes only its own data path, and the explicit
migration aid only inspects and copies files it is pointed at:

```bash
contacts legacy inspect --json
contacts legacy preserve --source /exact/path/contacts.db \
  --output /existing/directory/contacts.db.pre-https.20260901
```

If a SQLite WAL, journal, or shared-memory sidecar is present, preservation
refuses to proceed until every legacy process is stopped and the old client has checkpointed the database. To move
portable contact records, use a legacy release against the preserved copy to
export JSON, then run `contacts import exported.json`; import writes into
whichever transport is active. Existing files are never overwritten.

Preservation rejects source, ancestor, or output replacement races and verifies
the copied bytes with SHA-256 and stable output metadata before success. If a copy
fails after output creation, any private partial output is left untouched and
reported as unverified for manual inspection; the command never deletes a
pathname that another process might have replaced.

## License

Apache-2.0 -- see [LICENSE](LICENSE)
