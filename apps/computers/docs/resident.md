# Resident protocol

The resident contract is capability-oriented and controller-led. A controller pre-creates enrollment for a known Computer, provider, and instance. The enrollment token is returned once and stored only as a hash. Enrollment is one-time and expiring; the request contains provider, instance, boot, and token but no guest-selected Computer ID.

The resulting identity metadata binds certificate ID, tenant, Computer, provider, instance, boot, generation, issue time, and expiry. A production implementation must replace the protocol-only metadata with renewable per-Computer mTLS certificates, certificate rotation/revocation, cross-Computer rejection, boot/replacement invalidation, and explicit re-enrollment.

Operation envelopes are idempotent and replay protected through operation ID, attempt ID, sequence, nonce, expiry, policy generation, and monotonic fence. The resident compares the envelope digest in constant time with the SHA-256 digest of the canonical stored operation payload and applies an explicit capability-to-operation-kind map before recording the nonce. Capabilities are limited to typed `exec`, `install`, `status`, and `cancel` payloads. No raw privileged shell command exists.

`computers-resident` currently reports not ready because no privileged daemon or mTLS transport exists. It must not run as if those guarantees were present.
