---
"@hasna/contracts": minor
---

Contracts 1.1.0, the fleet-alignment keystone: `ClientResolutionError` with
stable exit codes; the one local door `HASNA_<NAME>_LOCAL` via
`selectsLocalStore()` / `localOptInEnvKey()`, answered before any Keychain or
disk read; `resolveAppHome()` / `appPaths()` for `~/.hasna/<name>` and
`~/.hasna-internal/<name>` with `HASNA_{CONFIG,DATA,STATE,CACHE}_HOME`;
`describeClientTransport()` for `status` / `doctor`; manifest fields `scope`,
`placement.hosted`, `client` and `serviceSurfaces[].dataAccess`; six
report-mode conformance checks with `--strict`; authenticated raw
`transport.fetch`; NodeNext `.js` specifiers on the root declaration graph.
Additive over 1.0.2.
