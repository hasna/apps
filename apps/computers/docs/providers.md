# Provider contract

Provider adapters implement typed create/start/stop/quarantine/delete/restore/reconcile methods plus readiness. Every call carries the durable operation and provider attempt, including a stable provider idempotency key. Outcomes are exactly `success`, `definite_failure`, or `unknown`.

Create success atomically advances observed Computer state and an active provider binding with the operation result and audit/outbox event. Definite create failure releases child quota only after the provider says no resource remains. Unknown outcomes persist the provider operation/resource identity, keep the binding unknown, and hold quota. A later reconcile must adopt the one resource or report definite cleanup/absence before release. The core ships only `UnconfiguredProvider` implementations, so no real substrate is created in this slice.

Start and restore require a current typed home-lease capability binding tenant, Computer, home, holder, fence, and expiry. Missing or stale capabilities fail before the provider call.

## `local_machine`

Confinement is `dedicated_machine`, never `strict_vm`. Adoption requires the entire physical host to belong to one Computer, no unrelated tenant/user/workload/controller secret, and controller/quarantine authority outside or separately protected from the guest. A real adapter must prove those controls before reporting ready.

## `local_vm`

The initial class is `unverified_vm`. A real adapter may report `strict_vm` only after provider-specific escape, egress, host/sibling canary, and resource-exhaustion tests pass on the target hardware. Multiple Linux Computers on a Mac host require one VM per Computer; managed macOS guests are deferred.

## `aws_ec2`

The initial class is `unverified_vm`. Strict mode requires private subnets, no public IP/listener, IMDS IPv4/IPv6 disabled before the agent starts, no instance profile or guest credential chain, encrypted replaceable root and separately durable home, externally controlled egress, TTL/orphan/budget/tag reconciliation, and exact resident/image provenance. Temporary SSM profiles are limited to externally initiated, named-human, quarantined, expiring, audited break-glass with agent fencing and automatic detachment.

No provider credentials enter a Computer guest. The reconciliation state machine and provider port are implemented; concrete local-machine, VM, and EC2 reconciliation adapters remain future work.
