---
"@hasna/contacts": patch
---

Fold the standalone github.com/hasna/contacts repo into the hasna/apps monorepo as the `@hasna/contacts` member at the npm-published 0.6.36 — four surfaces (CLI, MCP, serve, SDK), own app-level bun.lock for hermetic Docker deploys. The standalone repo is removed once this lands.
