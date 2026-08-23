---
"@hasna/secrets": patch
---

`secrets-serve` wires the strict `keyStatus` key-status hook instead of the deprecated `isRevoked`-only hook, so the /v1 verifier constructs under `@hasna/contracts` 0.13.4 and a validly-signed API key with no `api_keys` record is refused.

`@hasna/contracts` >= 0.8.7 (contracts #62) refuses `isRevoked`-only wiring **eagerly at construction**, and `startCloudServer` builds the verifier during boot — so the throw took the whole service down rather than one route. `isRevoked` also cannot express the refusal that matters: it returns `false` both for an active key and for one that was never registered, which makes an unregistered key irrevocable. `keyStatus` denies anything other than `"active"` (`unknown`, `revoked`, `expired`).

Same defect class as the `@hasna/calendar` 0.3.6 /v1 503 incident (row I38-00755, hasna/apps#967) and the `@hasna/todos` 0.15.38 one (row ae34a051, hasna/apps#769).

The verifier construction is extracted from `startCloudServer` into an exported `createCloudVerifier(client, signingSecret)` so the real wiring is reachable from a test without opening a Postgres pool or running the version backfill. New `tests/serve-auth-wiring.test.ts` pins both halves: that the wiring constructs, and that unregistered, revoked and expired keys are all denied while a registered active key is allowed.
