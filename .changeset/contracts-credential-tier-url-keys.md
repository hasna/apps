---
"@hasna/contracts": minor
---

Operator key lifecycle routes, app-scoped revocation, and a signing-secret
check command.

**Operator key lifecycle routes.** `createKeyLifecycleRoutes` (hasna/apps#1641)
adds the `/v1/admin/keys` surface — mint, list, read, revoke — as
framework-agnostic route handlers gated on a `keys.admin`-scoped operator key,
with a default 365-day client-key TTL. Revocation is scoped by app: a
`revoke` on a shared key store removes only the calling app's key, so an
operator for one app can no longer revoke another app's key by kid.

**`contracts check-signing-secret`.** The new CLI command validates a signing
secret through the shared `signing-secret` module (whitespace-wrapped secrets
are rejected with the trimmed value's location, not silently accepted), and
`--app`-based checks resolve the secret from the environment exactly as the
server reads it.

The key-store revoke path and the trim-on-read semantics of signing secrets
keep the guard rails of hasna/apps#1543 and #1638. This bump is additive over
1.0.1: the credential-tier and project-layout redesigns this work originally
carried are already released within 1.0.1, so nothing here re-breaks a 1.0.x
consumer.
