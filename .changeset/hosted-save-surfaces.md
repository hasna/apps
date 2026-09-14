---
"@hasna/recordings": patch
---

Expose the existing validated hosted recording save operation through the
CLI, hosted MCP server and hosted HTTP proxy. Hosted MCP and HTTP save remain
behind the existing explicit `--allow-writes` startup option, and all surfaces
return metadata without private transcript text.
