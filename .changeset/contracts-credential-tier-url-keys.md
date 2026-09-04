---
"@hasna/contracts": none
---

The 1.1.0 minor is APPLIED in this change across all three version surfaces
(`package.json` version, `hasna.contract.json` kitVersion, and the
`CONTRACTS_PACKAGE_VERSION` constant) plus the changelog. This release record
schedules no additional bump: keeping `minor` here would queue 1.2.0 on top of
the already-applied 1.1.0.

Client credential resolution treats the process environment as a first-class
tier and drops the DEPRECATED notice for it (the notice is reserved for a
retired disk layer), adding an optional macOS Keychain tier below it that is
enabled only by an explicit `HASNA_STATION` in the supplied environment. A
shared `resolveApiBase()`/`joinApiPath()` accepts the gateway's path-prefixed
base URLs and stops `.origin` from dropping the app prefix; a shared status
surface prints `API: <base>/v1` and carries `api_url` in JSON. Signing secrets
and database URLs are trimmed on read on both sides of the HMAC. The serve kit
gains an operator-only key lifecycle route (mint/list/read/revoke, gated on
`<app>:keys.admin`). The project-manifest schema no longer defaults its layout
paths into the retired singular in-repo project directory; those locations are
required inputs supplied by the projects app.
