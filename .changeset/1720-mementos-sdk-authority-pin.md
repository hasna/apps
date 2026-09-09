---
"@hasna/mementos": patch
---

`./sdk` pins the service authority for the life of the client; a mid-process
authority change refuses loudly instead of silently re-pointing every request
(hasna/apps#1794, adversarial credential-seam audit).

The key was already re-resolved fresh per request (a rotation heals), but the
authority was re-derived per request too: a re-pointed `HASNA_MEMENTOS_API_URL`,
a changed Keychain `api-url` item, or a rewritten credentials file silently
moved the client's target server, and the request's data went to the new
authority under the key that resolved for it. Now the first request pins the
resolved authority, every later request must resolve the SAME authority, and
any drift throws a `MementosConfigError` prefixed `MEMENTOS_AUTHORITY_CHANGED`
before anything is sent — the same rule the shared transport's binding provider
enforces. An explicit `baseUrl` (tier 1) remains a pin used verbatim and is
never re-derived from the chain.