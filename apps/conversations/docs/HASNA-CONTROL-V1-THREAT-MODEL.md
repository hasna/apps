# Threat model — `hasna.control/v1` observe-only evaluator

Scope: the pure TypeScript contract validator, lifecycle evaluator, and portable
fixtures. Existing generic message metadata is the untrusted storage carrier.
Database schema, message/API/CLI/MCP integration, live control creation,
Codewith hooks, enforcement, deployment, and independent safety containment are
explicitly excluded.

Assets and goals: control-decision integrity; tenant and authority-domain
isolation; exact release semantics; replay/order determinism; availability of
unrelated operations; confidentiality of rejected secret-shaped values; and the
guarantee that this slice cannot enforce or create controls.

Actors: authenticated but unauthorized publishers, malicious tenants, content
authors, callers that forge metadata claims, compromised or buggy storage
adapters, replaying/backdating callers, backend failures, and in-process callers
supplying hostile JavaScript objects.

Trust boundaries:

1. Untrusted message content and generic metadata to the validator.
2. Authenticated ingress context to the trusted envelope adapter (future work).
3. Stored observations to the bounded backend adapter (future work).
4. Evaluator diagnostics to telemetry or a future Codewith hook.
5. Tenant, authority-domain, scope, operation, and resource transitions.

Data flow:

```text
[Publisher/content] -- untrusted metadata --> |metadata boundary| --> [Validator]
[Authenticated ingress] -- trusted envelope --> |identity/policy boundary| --> [Validator]
[Bounded observation backend] --> |availability/order boundary| --> [Evaluator]
[Evaluator] -- allow|hold|indeterminate, enforced=false --> |hook boundary| --> [Telemetry]
```

| ID | Element/flow | STRIDE | Threat and abuse path | L×I | Control | Verification test |
| --- | --- | --- | --- | --- | --- | --- |
| T1 | Metadata → validator | S/E | A caller self-asserts publisher, tenant, domain, surface, or policy and gains control authority. | H×H | Compare every claim to a separately supplied, closed trusted envelope; metadata never supplies envelope values. | Trusted-claim mismatch matrix. |
| T2 | Message content | E | Literal `[FREEZE]`, `UNFREEZE`, or `[BLOCKED]` text is interpreted as authority. | H×H | Evaluator never reads content; only the exact metadata key can be a candidate. | Legacy compatibility JSON vectors. |
| T3 | Unfreeze lifecycle | T/E | A stale, late, wrong-scope, wrong-domain, wrong-ID, or wrong-fingerprint release clears a valid freeze. | H×H | Exact three-field reference, exact context/target equality, strict version and trusted-time ordering, and release ingress before freeze expiry; invalid release never mutates active state. | Bad-release matrix, post-expiry ingress, and concurrent/reversed-order tests. |
| T4 | Cross-tenant state | E/I | Reused control IDs collide across tenants or authority domains. | M×H | Lifecycle key is tenant + authority domain + control ID; target matching repeats tenant/domain checks. | Identical-ID cross-tenant test. |
| T5 | Backend ordering/replay | T/R | Reverse ordering, duplicate delivery, concurrent rows, or reuse of one control ID for another scope changes the lifecycle result. | H×M | Deterministic trusted ordering, canonical event hash, exact replay dedupe, and conflicting-version or control-ID-reuse rejection. One control ID owns one lifecycle; rejected reuse makes the result indeterminate, never a definitive allow. | Forward/reverse fixture equality, replay, duplicate, control-ID reuse, and concurrency tests. |
| T6 | Preseeded rows | E | Metadata inserted before activation becomes a control when the feature is enabled. | M×H | Event issue time and trusted ingress server time must both be at or after activation. | Pre-activation event and pre-activation ingress tests. |
| T7 | Scope ambiguity | E/D | Missing scope or wildcard is treated as global, holding unrelated work. | M×H | Closed scope enum, non-empty sorted unique IDs, no wildcard/global kind, exact operation/resource tokens. | Empty/unsorted/duplicate scope matrix and unrelated-target tests. |
| T8 | Backend/version failure | D/E | Failure, malformed status, or unknown version invents a global hold. | M×H | Require a closed backend discriminant and bounded dense observation array; return `indeterminate` and `enforced: false` with no fallback hold. | Unavailable, malformed-status, over-limit, and unsupported-version tests. |
| T9 | Secret-bearing input | I | Credential-like material is echoed through an exception, diagnostic, or log. | M×H | Detect high-signal secret shapes before semantic diagnostics; return code only; no logging or rejected values. | Event/envelope secret-shape and non-echo tests. |
| T10 | Hostile JS values | D/I | Getters, proxies, oversized containers or strings, sparse arrays, or non-finite values execute code, exhaust resources, crash evaluation, or split the hashed identity from the returned event. | M×M | Reject proxies before invoking traps; check array/string bounds before enumeration or scanning; copy ordinary data descriptors into bounded plain snapshots; reject accessors and malformed containers; contain exceptions. | Accessor/proxy rejection, pre-enumeration/pre-scan bounds, sparse-array, and mutation-after-validation tests. |
| T11 | TTL/order manipulation | T/D | Future, expired, indefinite, late-release, or reordered events persist, suppress, or resurrect holds. | M×H | Canonical timestamps, seven-day maximum TTL, ingress checks, decision-neutral exclusion after evaluation time, release ingress before freeze expiry, strict ordering, and automatic freeze expiry. | TTL boundary, future/expired ingress, active-freeze historical evaluation, late release, stale release, and expiry tests. |
| T12 | Evaluator → future hook | E | An observe-only result blocks a real tool or replaces independent safety containment. | M×H | Result always carries `enforced: false`; only `off` and `observe_only` modes exist; docs require a separate reviewed activation. | Hold-result and rollback tests; integration follow-up gate. |

Assumptions and open questions:

- The future ingress adapter can prove the authenticated principal and derive
  tenant/domain/surface/policy without trusting caller metadata.
- `server_time` will be the immutable ingress time, not query time.
- The observation backend will provide bounded rows or an explicit unavailable
  state.
- The first live consumer will preserve exact operation/resource/scope mapping;
  wildcard expansion requires a new reviewed contract version.

Residual risks:

- Trusted-envelope persistence and authentication are not implemented here.
  Owner: Conversations ingress integration; review before any activation.
- SHA-256 collision resistance and host crypto correctness are external
  assumptions. Review if the platform cryptography baseline changes.
- Secret-shape detection is deliberately high-signal, not a general DLP system.
  Owner: security review; update patterns only with non-secret fixtures.
- A valid authenticated publisher can still issue a harmful but correctly
  scoped freeze. Authorization policy, quorum, rate limits, audit delivery, and
  emergency recovery belong to the trusted ingress/control-plane slice.
- Independent evidence-based safety containment remains external and may hold
  work even when this evaluator returns `allow` or `indeterminate`.
