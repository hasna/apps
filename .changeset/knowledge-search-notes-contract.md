---
'@hasna/knowledge': patch
---

Fix `knowledge search` against the hosted API: restore the `/v1/notes/search` client contract (regression from 0.2.114, which called a `/v1/search` endpoint the server never implemented).
