---
"@hasna/telephony": minor
---

Keep `bun:sqlite` out of the Telephony CLI, MCP, SDK, and hosted server bundles. The SQLite implementation is emitted separately and loaded only through a runtime gate that re-validates the explicit local opt-in; canonical hosted authority, credential resolution, and `/v1` routing remain unchanged.
