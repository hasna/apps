---
"@hasna/bridge": patch
---

fix(bridge): classify codewith context-window exhaustion as a stale-session signal (HC-01156). A durable thread that "ran out of room in the model's context window" is as unusable as a deleted thread, but the error names the thread subject without any not-found/expired qualifier, so isStaleSessionSignal() returned false and every subsequent owner message dead-lettered after maxAttempts instead of self-healing to a fresh thread. The classifier now also matches context-window exhaustion shapes ('ran out of room', 'context window', context length/limit/cap, context exhausted) on structured error events; the resumed turn forceFresh-retries on a new thread and the session record drops the dead refId with contextResetPending so the owner receives the context-reset note. Regression tests both ways: the exact measured error message classifies stale, an ordinary error stays false, and the turn-level heal rotates to a fresh thread.
