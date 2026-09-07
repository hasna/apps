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
endpoint, no local database, no client DSN and no fallback. Run
`attachments <command> --help` for the exact options.

| Env variable | Meaning |
|---|---|
| `HASNA_ATTACHMENTS_API_URL` | HTTPS service origin or path prefix. Blank, conflicting or invalid = error. |
| `HASNA_ATTACHMENTS_API_KEY` | API key. Blank or conflicting = error. |
| `HASNA_ATTACHMENTS_API_KEY_OVERRIDE` | Deliberate per-process override; outranks disk. |
| `HASNA_ATTACHMENTS_API_KEY_REF` | Secrets-vault pointer, resolved at request time. |
| `HASNA_PROFILE` | Names which identity's credential file to use. |
| `ATTACHMENTS_API_URL` / `ATTACHMENTS_API_KEY` | Legacy aliases, one release only. |

## Remote workflows

- upload accepts explicit files, HTTPS source URLs, or stdin with --filename.
  Expiry, link type, tag, password, encryption, download limits and email gates
  are forwarded to the service. --internal changes share-link metadata, not the
  authenticated API destination.
- list, download, delete, link, clean and report use the remote Store adapter.
  Download writes only the explicitly requested output file.
- presign and completion workflows request authorization from the remote service;
  clients do not require S3 credentials.
- status, doctor and whoami verify authenticated access with a bounded list request.
  They return BLOCKED on configuration, authentication or transport failure, and
  report the credential tier and source that resolved (never the value).
  whoami does not invent an identity from local files.
- config show redacts credentials. config set accepts only --expiry and --link-type.
  config test checks authenticated service access.
- link-task, complete-task, task-journal and watch require authenticated
  Todos HTTPS configuration resolved through the shared seam; snapshot-session
  requires the Sessions equivalent. URL overrides must match the configured
  authority and prefix.

Metadata-only agent attribution and user preferences are non-authoritative local
state. Configuration resolution uses @hasna/paths; no legacy dataset is imported.

## Retired surfaces

--client-mode always fails. Client database/storage mode settings, client S3
configuration, local storage flags and the old attachments serve command are
retired. `*_MODE` / `*_STORAGE_MODE` switches, `~/.hasna/fleet-env`,
`~/.hasna/cloud`, `~/.config/hasna`, `$XDG_CONFIG_HOME` and any
`~/.attachments/config.json` key store are read nowhere.
Use the separately configured attachments-serve service executable.
The inherited Events command set is not part of this client.

See [configuration](configuration.md) for the resolver chain, aliases,
validation and service startup.