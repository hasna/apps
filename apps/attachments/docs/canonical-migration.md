# Canonical-client migration checkpoint

This is an owner-directed breaking removal of local client storage, not a release.
PRs 561 and 565 were inspected: both retain absent-config SQLite fallback; 561 also
depends on the stale shared client contract. Their placement model is not adopted.

The local HTTPS seam and reproducible SDK generator hardening do not claim an
unpublished Contracts dependency. Contracts remains at the existing dependency range.
The reviewed shared Contracts change is not yet released.

Removed public capabilities: LocalStore, local object/storage primitives, raw local
upload/download functions, local createApp/startServer, and legacy AttachmentsClient.
Use resolveStore for the root SDK or AttachmentsApiClient in the separate SDK.
Unsupported legacy operations fail instead of silently using a local dataset.

Release is blocked pending full legacy-test reconciliation, generated-kit/contract
reconciliation with the released shared contract, lockfile audit, exact-commit
independent review, and separately authorized live PostgreSQL verification.
The old unit suite assumes SQLite/localhost and is not evidence of the new boundary.
No package version or published dependency release has been invented.

Checkpoint verification on Bun 1.3.14: package build/type declarations and 11
canonical security tests pass. The full historical runner reports 61 checks,
33 passed and 28 failed; it is not a passing release suite. The required live-PG
negative control correctly fails when its test DSN is absent. No live PostgreSQL
or service verification was performed.

Root conformance reporting tests pass (10 tests), but report Attachments manifest
incompatibility against the old published validator; task filing was NOT FILED
because the test PATH excluded Hasna CLIs. Full root gates and affected builds
were attempted but could not complete with unrelated dependencies absent.
