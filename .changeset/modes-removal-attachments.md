---
"@hasna/attachments": patch
---

refactor(attachments): remove the local/self_hosted/cloud deployment-mode concept — the client selects its backend from the env pair (HASNA_ATTACHMENTS_API_URL + _API_KEY, fail-closed on partial config), the server selects sqlite or postgresql from HASNA_ATTACHMENTS_DATABASE_URL, and the vendored storage kit is regenerated at contracts 0.8.7 (mode module retired)
