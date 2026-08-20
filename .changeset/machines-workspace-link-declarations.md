---
"@hasna/machines": patch
---

Committed export-map declarations (types/) plus an install-time prepare build so workspace-linked consumers (loops, dispatch) resolve @hasna/machines/consumer and the other declared subpaths in a fresh checkout — fixes the deterministic TS2307 at install for wave #670's workspace alignment.
