---
"@hasna/mementos": patch
---

PgSyncPool responses are now generation-tagged (fixes 027d17e9): each query carries a monotonic generation echoed back in the shared status word, so a query that timed out is abandoned without its late response ever being consumed by the next query — the caller discards stale generations via a CAS re-arm instead of parsing the previous query's payload as its own result. The per-query timeout is overridable via MEMENTOS_PGSYNC_QUERY_TIMEOUT_MS for tests.
