---
"@hasna/notes": patch
---

notes-serve bounds passwordless login without giving anyone a lockout
primitive, and its per-IP limits now see the real client behind the fleet's
proxies.

**Login requests carry a nonce.** `POST /auth/login` mints a request per call:
a six-digit code (delivered to the address) and an opaque `requestId`,
returned only to the requester. `POST /auth/verify` now takes
`{ email, code, requestId }` — `requestId` is required — and looks the request
up by its nonce, never "the latest code for the address". A request that does
not resolve is refused before anything is counted. Wrong codes count against
that request and burn it after 5; after that even the correct code is refused
and the holder simply requests a new one. Nothing is keyed on the address: a
stranger can only burn requests it minted itself, so guessing is bounded at
five tries per code while N IPs requesting codes for an address and guessing
at them cannot stop its owner from logging in. Minting is bounded per source
IP (5/hour) and by a process-wide budget (300 codes per minute,
`otpMintBudget`). Storage gains `otp_login_requests.failed_attempts`
(PostgreSQL migration `notes_pg_010`, additive).

This replaces the per-email hourly quota from #1756 (anyone who knew an
address could spend its budget from throwaway IPs) and the #1761 code burn
keyed on the address (ten throwaway IPs could kill the owner's code).

**Per-IP limits behind proxies (#1784).** Behind the fleet ALB the socket peer
is the balancer, so every user shared one bucket and 21 wrong verifies from
one machine locked everyone out for an hour. `HASNA_NOTES_SERVER_TRUSTED_PROXY_HOPS`
(default `0`; the image sets `1`) names how many `x-forwarded-for`-appending
proxies to trust, counted from the right — never the leftmost, client-written
entry. `HASNA_NOTES_SERVER_TRUSTED_GATEWAY_PEERS` (IPs/CIDRs) lets `x-real-ip`
from the api.hasna.com gateway's egress identify the client; from any other
peer it is ignored. `--auto-approve` keeps deciding on the raw socket peer.

Login codes stay out of the server log: the request line records only the
address and the expiry, and the code itself is printed only under the explicit
`HASNA_NOTES_SERVER_AUTH_CONSOLE_CODES=1` opt-in (or `--dev`, which returns it
in the response body). Fixes hasna/apps#1542; follow-up to #1761 and the #1770
reviews; addresses #1784 for this server.
