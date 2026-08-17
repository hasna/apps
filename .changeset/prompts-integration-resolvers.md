---
"@hasna/prompts": patch
---

Add cross-app integration resolvers to the render engine: `{{todo:...}}`, `{{channel:...}}`, `{{knowledge:...}}`, `{{memento:...}}`, and `{{file:...}}` refs resolve through each owning package's SDK (todos/conversations/knowledge/mementos/files) with fixed, versioned, redacted projections, named fail-closed error codes, a permissive `--allow-unresolved-integrations` preview, render receipts, and a new `prompts_resolve` MCP tool. The owning packages remain optional runtime peers; when one is not installed the ref fails closed with the app's UNAVAILABLE code.
