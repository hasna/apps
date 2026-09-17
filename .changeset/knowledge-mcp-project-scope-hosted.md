---
"@hasna/knowledge": patch
---

Resolve hosted MCP item stores before creating a project-scoped local workspace, so project-scoped reads using the canonical Knowledge API leave no `config.json`, SQLite, JSON, or workspace-directory residue. Add real published-bin coverage for the canonical 0600 credential file, exact `/knowledge/v1` routing, compact search output, bounded context packs, and complete local-root isolation.
