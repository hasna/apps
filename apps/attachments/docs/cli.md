# CLI reference

Inject HASNA_ATTACHMENTS_API_URL and HASNA_ATTACHMENTS_API_KEY through the approved
environment/secret manager before using remote operations. No default endpoint,
local database or client DSN is supported. Run attachments <command> --help for
the exact options.

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
  They return BLOCKED on configuration, authentication or transport failure.
  whoami does not invent an identity from local files.
- config show redacts credentials. config set accepts only --expiry and --link-type.
  config test checks authenticated service access.
- link-task, complete-task, task-journal and watch require explicit authenticated
  Todos HTTPS configuration. snapshot-session requires the Sessions equivalent.
  URL overrides must match the configured authority and prefix.

Metadata-only agent attribution and user preferences are non-authoritative local
state. Configuration resolution uses @hasna/paths; no legacy dataset is imported.

## Retired surfaces

--client-mode always fails. Client database/storage mode settings, client S3
configuration, local storage flags and the old attachments serve command are
retired. Use the separately configured attachments-serve service executable.
The inherited Events command set is not part of this client.

See [configuration](configuration.md) for aliases, validation and service startup.
