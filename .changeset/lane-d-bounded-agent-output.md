---
"@hasna/contacts": minor
"@hasna/conversations": minor
"@hasna/events": minor
"@hasna/repos": minor
"@hasna/secrets": minor
---

Bound high-cardinality CLI and MCP responses for agent-facing reads. Contacts, Conversations, and Repos now start MCP with a reduced core tool inventory while retaining their legacy complete inventories behind the explicit `HASNA_<APP>_MCP_PROFILE=full` escape hatch. Contacts, Conversations channel listings, Events listings, Repos listings, and Secrets metadata listings now emit compact cursored pages by default; explicit `--full` or `full: true` keeps the prior full-record forms available when compatibility or forensic detail is required.
