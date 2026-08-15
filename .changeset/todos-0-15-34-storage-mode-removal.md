---
"@hasna/todos": patch
---

Remove the deprecated storage-mode env selection (owner deprecation, 2026-07-29 deployment-modes removal). The client now routes on `HASNA_TODOS_API_URL` + `HASNA_TODOS_API_KEY` alone; any storage-mode var now hard-errors instead of silently selecting a backend. Breaking/behavioral change: configurations still setting the deprecated var must drop it before upgrading to 0.15.34.
