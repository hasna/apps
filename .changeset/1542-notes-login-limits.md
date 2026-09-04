---
"@hasna/notes": patch
---

notes-serve bounds passwordless login without giving anyone a lockout primitive.
`POST /auth/login` enforces a minimum interval between minted codes per address:
inside the interval the request is answered with the envelope of the code that
is already outstanding, and nothing new is minted, logged or delivered. Wrong
codes on `POST /auth/verify` are counted per address across all source IPs and
burn THE CODE, never the account, after a bounded number of attempts; the owner
recovers with one more `/auth/login`, since the burn clears the cooldown. A
successful verify clears both counters. Per-IP limits are unchanged.

This replaces the per-email hourly quota shipped in #1756, which counted every
attempt on a caller-chosen key before any ownership check and so let anyone who
knew an address spend its budget from throwaway IPs and keep the owner out for
the rest of the window. Both ceilings live in the serving process, so behind
several tasks they apply per task.

Login codes stay out of the server log: the request line records only the
address and the expiry, and the code itself is printed only under the explicit
`HASNA_NOTES_SERVER_AUTH_CONSOLE_CODES=1` opt-in (or `--dev`, which returns it
in the response body). Fixes hasna/apps#1542; the limiter repair is #1761.
