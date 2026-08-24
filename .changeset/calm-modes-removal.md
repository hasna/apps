---
"@hasna/projects": patch
---

Remove the deployment-mode surface (2026-07-29 doctrine): client transport is selected by API URL + API key presence only; URL-only or key-only configuration fails closed instead of silently falling back to local; legacy `*_STORAGE_MODE` / `*_MODE` selectors are inert; `/version` and root server responses no longer emit a mode field; `ProjectStore.mode` renamed to `transport` (`local | http`); README/docs scrubbed of banned mode vocabulary. Resource-link operation modes (`add | reconcile`) are preserved.
