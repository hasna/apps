---
"@hasna/instructions": patch
---

Wire the recommended `keyStatus` hook (`ApiKeyStore.keyStatus` from @hasna/contracts/auth) into both /v1 auth construction sites in the serve wiring (`getCloudVerifier` and `getHonoAuthMiddleware`), replacing the deprecated `isRevoked`-only wiring (row 67e30a56, incidents 720505/720506). The contracts auth verifier fails closed at construction when wired with `isRevoked` only — that form cannot refuse a key this service has no record of, so an unregistered key is irrevocable — and the /v1 API 503'd every request, failing the station01 instruction-delivery check across all 30 homes and making `instructions list` exit rc=1. The keyStatus hook refuses unknown, revoked and expired keys; regression tests prove both construction sites wire the hook and that the hook denies revoked keys, accepts active keys and refuses unregistered (unknown) keys.
