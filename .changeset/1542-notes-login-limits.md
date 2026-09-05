---
"@hasna/notes": patch
---

notes-serve bounds passwordless login without giving anyone a lockout
primitive. The server can tell an address's owner from a stranger only by the
login code itself, so nothing keyed on the (caller-chosen) address refuses a
request before the code is checked, burns a code, or disables an account.

`POST /auth/login` is limited per source IP (5/hour) and by a process-wide mint
budget (300 codes per minute, `otpMintBudget`); per address it enforces only a
minimum interval between minted codes — inside the interval the request is
answered with the envelope of the code already outstanding, and nothing new is
minted, logged or delivered. `POST /auth/verify` is limited per source IP
(20/hour) and, per address, counts only FAILED attempts: every request is
checked against the live code first and a correct code logs in, full stop;
after 5 wrong codes, further wrong codes for that address answer 429 (with
`details.retryAfterMs`) for a 30 s pause (`otpFailureCooldownMs`), then the
count starts over. A successful verify clears the count, the pause and the
interval.

This replaces two earlier shapes: the per-email hourly quota shipped in #1756,
which let anyone who knew an address spend its budget from throwaway IPs and
keep the owner out for the rest of the window, and the #1761 repair, which
burned the code after ten wrong guesses across all IPs and so let ten
throwaway IPs deny login for any address, renewably. What bounds guessing now
is the per-IP verify quota, the 6-digit space and the 10-minute lifetime. All
counters live in the serving process, so behind several tasks they apply per
task.

Login codes stay out of the server log: the request line records only the
address and the expiry, and the code itself is printed only under the explicit
`HASNA_NOTES_SERVER_AUTH_CONSOLE_CODES=1` opt-in (or `--dev`, which returns it
in the response body). Fixes hasna/apps#1542; follow-up to #1761 and the #1770
review.
