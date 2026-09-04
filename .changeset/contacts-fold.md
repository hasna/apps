---
"@hasna/contacts": none
---

Applied release record: this earlier fold is included in the prepared 0.7.0 release alongside the canonical-client minor. No additional patch bump is scheduled.

Fold the standalone github.com/hasna/contacts repo into the hasna/apps monorepo as the `@hasna/contacts` member at the npm-published 0.6.36 — four surfaces (CLI, MCP, serve, SDK), own app-level bun.lock for hermetic Docker deploys. The standalone repo is removed once this lands.
