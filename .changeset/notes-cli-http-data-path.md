---
"@hasna/notes": patch
---

CLI note commands route through the HTTP API when configured: `notes list`,
`notes get`, `notes create` and `notes delete` now dispatch through
`HASNA_NOTES_API_URL` + `HASNA_NOTES_API_KEY` via the personalnotes/v1 wire
dialect (the plain HTTP client the single-server model specifies) instead of
silently operating on the local store. Fixes the SDK's `resolveNotesClientStore`
(re-export-only imports shadowed local bindings, so the resolver threw
`ReferenceError` on the http path). Adds `notes --version`. The Dockerfile
bakes the public Amazon RDS global CA bundle so the storage kit's verified TLS
(`sslmode=require`) can validate the RDS server certificate in the internal
deployment; the bundle path is served to the kit through `PGSSLROOTCERT`.
