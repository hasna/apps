# Message resolution integration setup

CI run 34268607711 failed before message-resolution cases executed: the default five-second Bun hook deadline expired during schema setup, then cleanup closed the pool while the callback was still issuing SQL. The exact scheduling or database delay on that runner was not recorded.

The suite now uses the existing serial integration fixture and its 30-second migration deadline. Cleanup drains pending setup for up to 10 seconds before closing the pool; an expired drain remains a failure and prevents premature pool closure. All five message-resolution cases, their assertions and per-case deadlines are unchanged. Production code and workflow acceptance criteria are unchanged.

Validation on 2026-09-08 with Bun 1.3.14 and PostgreSQL 16.15 used fresh disposable loopback databases without provider credentials:

- An owned six-second DDL lock reproduced the original hook timeout and pool-after-close error. With the change, the same condition passed all five cases and 27 assertions in 6.63 seconds.
- All 23 maintained PostgreSQL suites passed: 261 cases and the two documented optional skips. Each owned cluster stopped afterward.
- The existing gate/fixture checks passed 40 tests and 251 assertions. Two added real-Bun subprocess cases exercise timed-out `beforeAll` cleanup, including late rejection; the six fixture tests passed 33 assertions. They require failed setup to remain failed, no test-body execution, and settlement before pool close.

This validates fixture lifetime and the existing message behavior; it does not establish the cause of the original runner delay or change service latency guarantees.
