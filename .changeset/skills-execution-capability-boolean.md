---
"@hasna/skills": patch
---

Accept boolean private execution capability reports while keeping publication and separately approved execution independent.

Widen publication recovery `executionEnabled` from literal false to `boolean | null`: existing recovery receipts report null because they do not contain a server capability observation. Align CLI/MCP output and guidance so publication is not confused with execution authorization.
