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
- health-check assesses links returned by the service. Signed S3 download links
  use a one-byte ranged GET because their signatures reject HEAD; response bodies
  are cancelled without buffering the object and the request is aborted after
  the check. An unsatisfiable range is checked
  once without Range under the same deadline to support empty files.
  Ordinary share pages retain HEAD
  so a diagnostic does not consume a constrained download. Expired or failed
  links still produce exit 1; this is separate from authenticated API health.
- config show redacts credentials. config set accepts only --expiry and --link-type.
  config test checks authenticated service access.
- link-task, complete-task, task-journal and watch require authenticated
  Todos HTTPS configuration resolved through the shared seam; snapshot-session
  requires the Sessions equivalent. URL overrides must match the configured
  authority and prefix.
- Todos task commands use `/v1/tasks` and the current `{task}` and
  `{history, count}` responses. A failed or malformed task/history read exits
  nonzero; journals never silently omit unavailable history. Journal attachment
  discovery uses the canonical task ID's `task:<id>` tag.
- link-task preserves unrelated metadata and previously linked attachments.
  complete-task checks the task before uploading, then merges evidence using the
  observed task version and verifies the completion acknowledgement. These are
  separate service operations. On a conflict, interruption or partial failure,
  inspect the task and any reported uploaded attachment IDs before retrying.
  No write is automatically retried.
- resolve-evidence resolves each evidence attachment on the configured service.
  A missing attachment is an error; stale links stored in task metadata are not
  used as a fallback.
- watch requires a server exposing `/v1/tasks/stream`. The current Todos v1 server
  does not expose this stream. Unsupported-route and authentication responses
  terminate the command; it never falls back to legacy `/api/tasks` routes.

### Diagnostic transport contract

The healthy `status` / `doctor` report is a stable, parseable contract:

```
Transport: authenticated HTTPS (remote-only; no local fallback)
API: <resolved service origin>
API key source: <source name> (<tier>)
Health: authorized and reachable
Sample records: <n>
```

Consumers key on the `Transport:` line. The `remote-only; no local fallback`
marker is the **replacement for the pre-1.2.0 `Mode:` line**, which was retired
along with the local SQLite / `localhost:3459` fallback; a `Mode:` line is no
longer emitted and nothing in the report implies a local dataset. The
`Preferences:` line was removed (BUG-0048): the resolved local config file is
**non-authoritative for transport** — it holds non-transport preferences only
(`config set --expiry` / `--link-type`) — and naming it in a transport
diagnostic made healthy remote-only CLIs read as unconfigured. Credentials and
the service authority always come from the shared resolver chain above, never
from a local config path. On failure the report is BLOCKED on stderr with exit
1, and states that no local fallback exists.

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
