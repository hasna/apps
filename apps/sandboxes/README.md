# `@hasna/sandboxes` managed adapters

## V1 trust boundary

The exact pinned official SDK modules (`e2b@2.31.0` and `@daytona/sdk@0.193.0`),
their broker handles, and the in-package callbacks passed to these bridges are control-plane
trusted computing base (TCB). Production ports must execute in the adapter's Node realm and
return genuine same-realm intrinsic `Promise` instances with unmodified `constructor` and
`then` lookup behavior. The bridge enforces that contract and fails closed with
`integrity_failed` when it can do so safely.

Sandbox-controlled bytes and provider DTO values are **not** trusted by that exception. They
remain hostile input and are authenticated, bounded, validated, and copied before use.
Daytona inbound chunks are limited to the 16 MiB broker-frame ceiling, eight concurrent
deliveries, and 16 MiB total in-flight bytes before allocation/copy. The SDK-facing callback
always fulfills so the pinned SDK cannot rethrow an ignored listener rejection; the session
drain preserves and throws the first original failure after sealing/finalization. Read-only SDK
DTOs are copied into validated owned primitives before attestation, and both attestation input
and returned ownership are derived from that one snapshot.

JavaScript has no public operation that can mark every rejected native Promise handled without
consulting either its `constructor` or `then`. Consequently, a TCB port that returns an already
rejected cross-realm Promise or a Promise with a hostile non-configurable `constructor` accessor
has already violated the V1 boundary: the bridge rejects it without executing the accessor, but
the host may still report the original rejection. Provider-SDK Worker/subprocess isolation is a
future hardening capability, not a V1 containment claim. Such untrusted SDK ports must not be
admitted to production.
