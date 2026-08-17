---
"@hasna/todos": patch
---

Bound every authenticated /v1 request to a single 10s budget in the CLI's cloud router (task 9b050845). `todos count` on a stalled /tasks endpoint previously hung past 120s and then reported REMOTE_API_UNREACHABLE while the authority was reachable; the contracts transport's 30s timer was consumed by two retries of a timeout-shaped failure, an abort-ignoring fetch hung unbounded, and `response.text()` after headers was unbounded. A stalled request now fails within the bound with REMOTE_API_TIMEOUT (slow authority), non-retryable, instead of the multi-minute hang followed by REMOTE_API_UNREACHABLE (down authority).
