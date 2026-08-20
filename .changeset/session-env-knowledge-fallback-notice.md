---
"@hasna/knowledge": patch
---

fix(knowledge): name the local-SQLite fallback instead of serving it silently. When HASNA_KNOWLEDGE_API_URL is absent, resolveKnowledgeClientTransport now emits one machine-readable JSON notice on stderr per process (`knowledge-local-fallback`) naming the mode switch before serving local — the same family as the merged secrets fix (PR #681 / incident 715558). Incident 715712: a re-provision dropped the hosted pair and items appeared gone at rc=0. URL-without-key keeps failing closed; the notice never fires when the URL selects http.
