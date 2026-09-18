---
"@hasna/mementos": minor
---

Serve the immutable memory audit log through strict, versioned hosted `/v1` contracts. Audit trails and exports now use stable `created_at` plus `id` cursor ordering, server-authenticated cursors, bounded pages, fixed snapshots, truthful completeness receipts, and exact filter validation; audit statistics are snapshot-consistent. MCP, root-library, and SDK clients validate every entry and envelope and fail closed on malformed successful responses instead of returning empty compliance results from a local store. Adds typed OpenAPI and SDK surfaces while preserving the existing hosted authority, machine registry, lock, profile, and explicit-local boundaries.
