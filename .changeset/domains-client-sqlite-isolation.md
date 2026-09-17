---
"@hasna/domains": patch
---

Keep `bun:sqlite` out of the Domains CLI, MCP, and SDK bundles by isolating the SQLite-backed `LocalStore` in a fixture-only module and avoiding namespace-style dynamic imports that defeat tree-shaking. Hosted authority, credentials, and `/v1` routing are unchanged.
