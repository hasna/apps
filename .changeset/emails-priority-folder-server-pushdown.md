---
"@hasna/emails": patch
---

feat(emails): server-side priority folder pushdown. `GET /v1/messages?folder=priority` is now accepted (MESSAGE_FOLDERS + OpenAPI enum) and served from the `priority_sender_rules` table (migration 0026): the list returns only messages whose sender matches a priority rule (exact-address or sender-domain), within the same inbox-like scope as the counts. With zero rules the folder completes empty and promptly instead of a full-store walk. `messageCounts()`' priority count and the folder predicate share one SQL EXISTS so the list and the count mirror each other by construction. CLI-side behavior unchanged (the client already detects the honored filter).
