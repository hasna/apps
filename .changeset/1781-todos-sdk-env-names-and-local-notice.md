---
"@hasna/todos-sdk": patch
---

Document the environment variables this client reads, and say when it is local.

`new TodosClient()` reads `HASNA_TODOS_API_URL` then `TODOS_API_URL` then
`TODOS_URL` for the authority, and `HASNA_TODOS_API_KEY` then `TODOS_API_KEY`
for the credential. The canonical `HASNA_TODOS_*` names always win; the
unprefixed spellings are this package's legacy names, kept as a silent fallback
for one release under the 2026-09-04 ruling (hasna/apps#1720) — which allows
that only for a package that DOCUMENTS them, and this one documented no
environment variable at all. README.md now carries the full table and the
removal notice.

When neither an authority nor a credential is configured the client still
targets `http://localhost:19427`, but it now prints one line to stderr saying
the run is local rather than looking like a working fleet client against an
empty store. The notice is printed once per process and is skipped where there
is no `process.stderr`, so browser and non-bun consumers are unaffected.
