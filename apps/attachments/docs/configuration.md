# Configuration and deployment

## Clients

Every hosted surface resolves its credential and authority through the ONE
shared resolver in `@hasna/contracts` (pinned exact `1.0.2`), fresh on every
call. The chain, per call:

1. an explicit argument (`--api-key` / `--profile`, or the SDK's
   `credentials` option);
2. a deliberate env pointer — `HASNA_ATTACHMENTS_API_KEY_OVERRIDE`,
   `HASNA_PROFILE`, `HASNA_ATTACHMENTS_API_KEY_REF`;
3. the macOS Keychain — `hasna.credentials.attachments.api-key` /
   `.api-url`, account `HASNA_STATION`, else `hostname -s`, else `USER`;
4. disk — `~/.hasna/attachments/config/credentials` (owner-only 0400/0600;
   `HASNA_HOME` / `HASNA_CONFIG_HOME` move the root);
5. `HASNA_ATTACHMENTS_API_KEY` — a legitimate tier below disk.

| Env variable | Meaning |
|---|---|
| `HASNA_ATTACHMENTS_API_URL` | HTTPS service origin or path prefix. Blank, conflicting or invalid = error. |
| `HASNA_ATTACHMENTS_API_KEY` | API key. Blank or conflicting = error. |
| `HASNA_ATTACHMENTS_API_KEY_OVERRIDE` | Deliberate per-process override; outranks disk. |
| `HASNA_ATTACHMENTS_API_KEY_REF` | Secrets-vault pointer, resolved at request time through @hasna/secrets. |
| `HASNA_PROFILE` | Names which identity's credential file to use. |
| `ATTACHMENTS_API_URL` / `ATTACHMENTS_API_KEY` | Legacy unprefixed aliases; accepted below the canonical names for one release only. |

With a credential resolved and no URL, the fleet gateway
`https://api.hasna.com/attachments` applies (clients append `/v1`), so a key
alone is a complete configuration. URLs must not contain userinfo, query
strings or fragments. Keys must not contain whitespace or control characters.
Credentials are never included in diagnostics and never writable to config
files.

The CLI, MCP and root SDK use /v1 in hosted mode. No network, auth or
configuration failure selects local storage: the on-box store is reachable ONLY
through the deliberate local opt-in, never as a fallback. The retired
`*_MODE` / `*_STORAGE_MODE` words are inert (nothing reads them),
`--client-mode` always fails, and a client never opens a raw server DSN
(`HASNA_ATTACHMENTS_DATABASE_URL` stays server-only). Nothing reads
`~/.hasna/fleet-env`, `~/.hasna/cloud`, `~/.config/hasna`, `$XDG_CONFIG_HOME`
or any `~/.attachments/config.json` key store.

### Local transport (on-box store)

Every command works in the local transport too, selected by the SAME store
seam the hosted transport uses (`resolveStore`) — decided BEFORE the resolver,
so a local run never reads the Keychain or a credential file:

| Env variable | Meaning |
|---|---|
| `HASNA_ATTACHMENTS_DB_PATH` / `ATTACHMENTS_DB_PATH` | Explicit on-box SQLite file — precedence 1: selects local even with a full API configuration. |
| `HASNA_ATTACHMENTS_LOCAL=1` / `ATTACHMENTS_LOCAL=1` | Local opt-in flag — selects local ONLY when the environment configures no authority or credential. |

A local run prints one mandatory stderr line —
`attachments: LOCAL mode — serving the on-box SQLite store (...), not the hosted fleet.` —
so it can never be mistaken for a hosted one. The default database lives under
the @hasna/paths data root (`HASNA_DATA_HOME` or `~/.local/share/hasna/attachments/db.sqlite`
on Linux); object bytes default to `~/.hasna/attachments/objects` and can be
re-pointed through the on-box `config.json` (`storage.localDir`), with an S3
backend supported by the same config (see `attachments config set` and the MCP
`configure_s3` tool). Presigned uploads in local mode are minted from the
on-box S3 configuration; in hosted mode the `/v1` service mints them.

`@hasna/attachments/sdk` exports `resolveAttachmentsSdkTransport` and
`createAttachmentsApiClient`: the generated client with the resolver behind
it, re-resolved on every request. An explicit `baseUrl` without an `apiKey`
never borrows the ambient fleet key — it fails `ATTACHMENTS_CREDENTIAL_MISSING`
instead of silently authenticating as another authority's identity.

Configuration preferences use @hasna/paths config resolution (`HASNA_CONFIG_HOME`,
XDG defaults on Linux, Application Support on macOS). Importing a client does
not create directories or migrate data. Existing `~/.hasna`, `~/.attachments`
and `~/.open-attachments` content is preserved in place and is not
authoritative for credentials.

Client `config set` accepts expiry and link-type preferences plus on-box S3
details (bucket/region, static keys or an AWS profile, optional endpoint) used
by local-transport presigned uploads. API credentials are injected by the
resolver chain, never written to config files. The hosted path needs no client
S3 configuration at all — the service mints presigned URLs.

Todos and Sessions workflows resolve the `todos` / `sessions` service chains
through the same shared seam (Keychain item, credential file, env pair,
default gateway) fresh per call; explicit command URLs must remain inside the
configured service URL.

## Service

Run attachments-serve with HASNA_ATTACHMENTS_DATABASE_URL (or a matching
ATTACHMENTS_DATABASE_URL alias), a valid postgres:// or postgresql:// URL naming
a host and database. An absent, blank, conflicting or non-PostgreSQL URL is fatal.
No storage mode selector is needed or accepted.

Configure HASNA_ATTACHMENTS_API_SIGNING_KEY (or HASNA_API_SIGNING_KEY), object
storage and public share URL on the service. The API-key verifier is the
strict `@hasna/contracts` 1.0.2 middleware wired through the store's
`keyStatus` hook, so revocation state is enforced per request. Terminate HTTPS
before the HTTP listener using your deployment's approved TLS boundary.
Use attachments-serve --help for explicit migration/startup options.
The old `attachments serve` command returns as the on-box HTTP server
(`attachments serve` starts it; run `attachments-serve` for the PostgreSQL
service executable).

Live PostgreSQL verification is NOT established by skipped unit tests.
The contract's pgTestGate requires a separately authorized disposable database;
no production credentials or data should be used for that test.

See canonical-migration.md for the current release gate.