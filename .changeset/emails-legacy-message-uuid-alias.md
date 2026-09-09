---
"@hasna/emails": patch
---

A legacy message row answers to its bare canonical uuid on the detail read
(BUG-0003). Migration 0007 stores bridged legacy inbound/sent mail under a
prefixed row id (`legacy-inbound:<uuid>` / `legacy-sent:<uuid>`), so a caller
that held only the pre-unification canonical uuid got a 404 from
`GET /v1/messages/{uuid}` and had to retry the raw prefixed id — leaving
attachment metadata for legacy mail unreachable on a naive detail fetch. The
postgres store's `getMessage` now treats the bare canonical uuid as an alias
for those two prefixed row ids (tenant-scoped, only after an exact-id miss, so
current rows whose id IS the bare uuid are unaffected and exact-id fetches pay
no extra query). `getMessageRaw` inherits the same alias through its existing
read. Resolves BUG-0003.
