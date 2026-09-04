---
"@hasna/contracts": none
---

The 2.0.0 MAJOR is APPLIED in this change across all three version surfaces
(`package.json` version, `hasna.contract.json` kitVersion, and the
`CONTRACTS_PACKAGE_VERSION` constant) plus the changelog. This release record
schedules no additional bump: keeping `major` here would queue 3.0.0 on top of
the already-applied 2.0.0. It is a MAJOR because the project-manifest schema
drops defaults from a `.strict()` object — a manifest that validated at 1.0.0
now throws — and a break of that shape may not ship in a minor.

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
required inputs supplied by the projects app. The operator key routes scope
revoke to the calling app, so an operator for one app can no longer revoke
another app's key by kid on a shared key store.
