---
"@hasna/recordings": patch
---

Add explicit hosted transcript export as UTF-8 plain text through the SDK, CLI,
MCP and hosted HTTP proxy. CLI export creates a new private file without replacing
existing destinations. Ordinary Library reads continue to omit private text.
