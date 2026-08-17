---
"@hasna/slides": patch
---

Guard the `postinstall` script so it skips the dashboard `bun install` when `dashboard/package.json` is absent. The published tarball ships only `dashboard/dist` (verified via `npm pack --dry-run`: `dashboard/package.json` is absent), so every `npm install @hasna/slides` consumer previously failed postinstall when `bun install --frozen-lockfile` ran inside a dashboard directory with no package.json or lockfile. In-repo installs (where the dashboard workspace files exist) are unchanged.
