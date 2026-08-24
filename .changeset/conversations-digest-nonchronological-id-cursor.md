---
"@hasna/conversations": patch
---

Cursor paging stopped early with `has_more:false` while newer-timestamp messages remained, on any channel whose message ids are not chronological with timestamps. Measured on the incidents channel (2026-08-24, todos febd88c6): id 730236 is dated 2026-08-21T10:55Z while id 722262 is dated 2026-08-21T19:20Z — a backfilled message receives a HIGHER id than its timestamp would suggest. An id-ordered window walk then hands back a message with a newer timestamp first, a timestamp-watermark caller advances its `since` past the gap, and the walk reports `has_more:false` while newer-timestamp messages remain unreached. This broke every cursor-based monitor on the fleet (the conversations-inbox monitor went DEGRADED with "window ids are discontinuous").

- The digest and the `read --since-id` cursor walks now order by the authoritative time sequence (`created_at ASC, id ASC`) whenever a `since` filter is present, and resume at the `(created_at, id)` tuple position of the cursor message instead of at a bare `id > cursor`. A timestamp-watermark caller therefore sees delivered timestamps advance monotonically and never steps past a message whose id is higher but whose timestamp falls before the advanced watermark.
- Applied to the local SQLite digest (`countDigestMessages`/`queryDigestMessages`), the local `readMessagePreviews`/`countMessages`, and the hosted `/v1/messages` endpoint (server `api.ts`) so local and cloud walks behave identically.
- When the cursor message cannot be resolved (deleted mid-walk), the cursor condition is dropped and the walk re-reads from `since` — duplicates are detectable, loss is not.
- Regression tests in `src/lib/digest-nonchronological-id.test.ts`: a window walk over non-chronological ids reaches every newer-timestamp message exactly once and terminates cleanly (positive control), and a chronological-id walk still terminates cleanly (negative control).

Deployment note: the hosted server must be redeployed with the new `api.ts` for cloud digest/read walks to see the fix; the client change alone covers local-store walks.
