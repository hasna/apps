---
"@hasna/todos": patch
---

fix(todos): name the local-SQLite fallback instead of serving it silently. When neither HASNA_TODOS_API_URL nor HASNA_TODOS_API_KEY is set, resolveTodosCliTransport now emits one machine-readable JSON notice on stderr per process (`todos-local-fallback`) naming the mode switch before serving local — the same family as the merged secrets fix (PR #681 / incident 715558). Incident 715712: a re-provision dropped the hosted pair and tasks appeared gone at rc=0. Partial pairs keep failing closed; the notice never fires when the hosted pair selects http.
