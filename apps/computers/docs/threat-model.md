# Threat model

## Assets and trust boundaries

Protected assets are Computer identity, tenant/owner assignment, policy generation, home writer authority, resident identity, install ticket authority, audit history, and provider resources. The controller and its storage/signing material are trusted. Guest agent code, package content, network peers, and user-supplied API bodies are untrusted.

The resident is a narrow typed capability executor, not controller authority. Enrollment is pre-created by the controller, bound to a Computer selected by the controller, expected provider and instance, one-time, and expiring. The guest does not submit a `computerId` during enrollment. Resident operations bind tenant, Computer, certificate, operation/attempt, generation, fence, sequence, nonce, expiry, capability, and the constant-time-compared SHA-256 digest of the canonical stored operation payload. An explicit capability-to-operation-kind map is enforced before acceptance. Replay, stale generation, and stale fences fail.

## Main threats and controls

- Cross-tenant or cross-Computer access: tenant-qualified storage keys, generic external authorization errors, owner/bound-Computer checks, and policy-generation checks.
- Duplicate or ambiguous requests: request hashes plus idempotency keys; mismatched re-use conflicts.
- Quota escalation: creation limits and allowed providers exist only in controller-owned grants. Requests can reference a grant but cannot provide or change its limit.
- Oversubscribed child creation: immediate transaction, active reservation count, unique reservation idempotency, and unique child binding.
- Two home writers: atomic lease acquisition, expiry, holder, and monotonic fencing. A stale holder/fence fails before a provider may open or attach storage.
- Resident impersonation/replay: one-time enrollment hashes, expected provider/instance, renewable identity metadata, operation nonce uniqueness, sequence uniqueness, expiry, and monotonic fences.
- Privileged install substitution: typed package spec, credential-free HTTPS registry, exact versions/digests, dependency closure, lifecycle-script bit, immutable policy digest/generation, persistently keyed HMAC-bound ticket, nonce, expiry, Computer binding, and single use. Deny overrides all other rules.
- Shell injection: execution accepts an argv array and optional absolute cwd; there is no privileged raw-shell field.
- Audit rewriting: append-only triggers, a per-tenant hash chain, atomic audit/outbox writes, chain verification, and an external checkpoint/WORM sink interface. Without a configured durable sink, readiness truthfully reports that the local chain is not independently anchored.
- Browser cross-origin mutation: no wildcard CORS; origins must be explicitly configured.
- Oversized/malformed input: bounded streaming JSON body and field-specific validation.

## Provider controls not implemented here

`local_vm` and `aws_ec2` remain `unverified_vm`. Strict-provider claims require external controls that survive resident termination: no host directories, clipboard, USB/device passthrough, bridge, Docker/hypervisor/SSH-agent/arbitrary Virtio sockets, or host management endpoint; resource limits; no metadata credentials or instance profile; private routing; controlled egress; and direct IPv4/IPv6, LAN/sibling/host, metadata, DNS/DoT/DoH/QUIC/alternate-proxy tests.

`local_machine` is a lower-assurance dedicated host. It cannot claim VM host isolation.

## Residual risk

This slice validates resident state but does not issue certificates or implement mTLS transport. It defines and tests provider unknown-outcome reconciliation, but ships no concrete provider adapter capable of adopting or cleaning a real resource. It does not implement snapshot scanning/quarantine, signed image rollback protection, human takeover, a configured external audit sink, or egress enforcement. Broad internet profiles cannot prevent data exfiltration, and no such claim is made.
