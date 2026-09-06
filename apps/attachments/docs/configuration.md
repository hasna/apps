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

The CLI, MCP and root SDK use /v1. No network, auth or configuration failure
selects local storage. Requests reject redirects and are not retried with
their bodies. MODE/STORAGE_MODE switches, client database URLs, DB_PATH and
--client-mode are retired and read nowhere. Nothing reads `~/.hasna/fleet-env`,
`~/.hasna/cloud`, `~/.config/hasna`, `$XDG_CONFIG_HOME` or any
`~/.attachments/config.json` key store.

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

Client config set accepts only expiry and link-type preferences. API
credentials are injected by the resolver chain, never written to config files.
S3 configuration is server-only.

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
The old local attachments serve command is retired.

Live PostgreSQL verification is NOT established by skipped unit tests.
The contract's pgTestGate requires a separately authorized disposable database;
no production credentials or data should be used for that test.

See canonical-migration.md for the current release gate.