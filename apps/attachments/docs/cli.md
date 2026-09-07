# CLI reference

Credentials and the service authority resolve through the ONE shared
`@hasna/contracts` client chain (pinned exact `1.0.2`), fresh per invocation:
`HASNA_ATTACHMENTS_API_KEY_OVERRIDE` / `HASNA_PROFILE` /
`HASNA_ATTACHMENTS_API_KEY_REF`, the macOS Keychain item
`hasna.credentials.attachments.api-key`, `~/.hasna/attachments/config/credentials`
(0600), then `HASNA_ATTACHMENTS_API_URL` / `HASNA_ATTACHMENTS_API_KEY`
(legacy unprefixed aliases accepted below the canonical names for one release).
With a credential resolved and no URL, the fleet gateway
`https://api.hasna.com/attachments` applies. Hosted mode with no resolvable
credential exits non-zero naming every tier it consulted — there is no default
endpoint and no fallback. Run `attachments <command> --help` for the exact
options.

| Env variable | Meaning |
|---|---|
| `HASNA_ATTACHMENTS_API_URL` | HTTPS service origin or path prefix. Blank, conflicting or invalid = error. |
| `HASNA_ATTACHMENTS_API_KEY` | API key. Blank or conflicting = error. |
| `HASNA_ATTACHMENTS_API_KEY_OVERRIDE` | Deliberate per-process override; outranks disk. |
| `HASNA_ATTACHMENTS_API_KEY_REF` | Secrets-vault pointer, resolved at request time. |
| `HASNA_PROFILE` | Names which identity's credential file to use. |
| `ATTACHMENTS_API_URL` / `ATTACHMENTS_API_KEY` | Legacy aliases, one release only. |

## Local transport

Every command also runs against the on-box SQLite store under the DELIBERATE
local opt-in — the same store seam, decided before the resolver is consulted:

| Env variable | Meaning |
|---|---|
| `HASNA_ATTACHMENTS_DB_PATH` / `ATTACHMENTS_DB_PATH` | Explicit on-box SQLite file — precedence-1 local selector, wins even over a full API configuration. |
| `HASNA_ATTACHMENTS_LOCAL=1` / `ATTACHMENTS_LOCAL=1` | Local opt-in flag — selects local only when the environment configures no authority or credential. |

A local run prints one stderr line — `attachments: LOCAL mode — serving the
on-box SQLite store (...), not the hosted fleet.` — so it can never be
mistaken for a hosted run. Object bytes land under the on-box object dir
(`storage.localDir`, default `~/.hasna/attachments/objects`); with S3 details
configured (`attachments config set --bucket … --region …`, or the MCP
`configure_s3` tool) local presigned uploads are minted from that on-box
configuration. In hosted mode the service mints presigned URLs and no client
S3 configuration is needed or used.

## Remote workflows

- upload accepts explicit files, HTTPS source URLs, or stdin with --filename.
  Expiry, link type, tag, password, encryption, download limits and email gates
  are forwarded to the service. --internal changes share-link metadata, not the
  authenticated API destination.
- list, download, delete, link, clean and report use the remote Store adapter.
  Download writes only the explicitly requested output file.
- presign and completion workflows request authorization from the remote service;
  clients do not require S3 credentials.
- status, doctor and whoami verify store access with a bounded list request
  and report the transport: authenticated HTTPS (with the credential tier and
  source that resolved — never the value) or local (on-box SQLite path). They
  return BLOCKED on configuration, authentication or transport failure.
  whoami does not invent an identity from local files.
- config show redacts credentials. config set accepts --expiry and --link-type
  plus the on-box S3 details used by local presigned uploads (--bucket, --region,
  paired --access-key/--secret-key, --profile, --endpoint); API credentials are
  injected by the resolver chain and never writable to config files.
  config test checks store access and names the transport that answered.
- link-task, complete-task, task-journal and watch require authenticated
  Todos HTTPS configuration resolved through the shared seam; snapshot-session
  requires the Sessions equivalent. URL overrides must match the configured
  authority and prefix.

Metadata-only agent attribution and user preferences are non-authoritative local
state. Configuration resolution uses @hasna/paths; no legacy dataset is imported.

## Retired surfaces

--client-mode always fails. Client database URLs (raw server DSNs) are never
accepted on a client; `*_MODE` / `*_STORAGE_MODE` switches, `~/.hasna/fleet-env`,
`~/.hasna/cloud`, `~/.config/hasna`, `$XDG_CONFIG_HOME` and any
`~/.attachments/config.json` key store are read nowhere.
Use `attachments serve` for the app's on-box HTTP server or the separately
configured attachments-serve service executable.
The inherited Events command set is not part of this client.

See [configuration](configuration.md) for the resolver chain, aliases,
validation and service startup.