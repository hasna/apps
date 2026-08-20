---
"@hasna/emails": patch
---

fix(emails): name the local-SQLite fallback instead of serving it silently. On the all-unset default row (no EMAILS_SELF_HOSTED_URL, no pointer, no database path), planEmailStore now emits one machine-readable JSON notice on stderr per process (`emails-local-fallback`) naming the mode switch before serving local — the same family as the merged secrets fix (PR #681 / incident 715558). Incident 715712: a re-provision dropped EMAILS_SELF_HOSTED_URL and the mailbox appeared empty at rc=0. An explicitly configured database path stays silent (chosen local store); pointer-without-URL and URL-without-credential keep failing closed.
