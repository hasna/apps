---
"@hasna/projects": patch
---

Project registration authorities reach a path-prefixed gateway base URL
(hasna/apps#1601).

`HASNA_TODOS_API_URL` / `HASNA_MEMENTOS_API_URL` / `HASNA_CONVERSATIONS_API_URL`
were normalized with `new URL(raw).origin`, which silently dropped the
`/<app>` segment of the gateway form `https://api.hasna.com/<app>` and made the
authority unreachable; a base carrying any path other than `/v1` was rejected
outright. The path prefix is now kept, a trailing `/v1` is folded off exactly
once (the shipped clients add their own `/v1` route prefix), and bases carrying
userinfo, a query or a fragment are still refused.
