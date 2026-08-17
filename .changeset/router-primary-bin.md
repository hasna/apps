---
"@hasna/router": minor
---

Add the primary `router` bin alongside the legacy `open-router` alias (both point at `dist/cli/index.js`), matching the `@hasna/orgs` dual-bin convention. npm 0.1.0 shipped only `open-router`; this release makes the CLI name match the package name. Help text, serve banner, README, and docs now use `router` as the primary name. No behavior change.
