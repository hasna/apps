# `hasna.control/v1` observe-only contract

`hasna.control/v1` is a versioned validator and evaluator for authenticated,
scoped freeze lifecycles stored in the existing message `metadata` JSON. It is
an observation surface only. It does not write rows, create controls, block a
tool, modify a hook, or turn message content into authority.

The contract-owned value is stored at the exact metadata key
`hasna.control`. Other metadata keys remain generic application data.

## Event shape

The event object is closed: every listed key is required and every unlisted key
is rejected.

| Key | `v1` rule |
| --- | --- |
| `version` | Exact literal `hasna.control/v1`. |
| `event_id` | `sha256:` plus 64 lowercase hex characters. It must equal the SHA-256 of the canonical event payload with `event_id` omitted. |
| `control_id` | Canonical lowercase RFC 4122 UUID. One UUID owns one two-event lifecycle within a tenant and authority domain. |
| `lifecycle_version` | `1` for `freeze`; `2` for `unfreeze`. A new freeze needs a new `control_id`. |
| `state` | Closed enum: `freeze` or `unfreeze`. |
| `fingerprint` | `sha256:` plus 64 lowercase hex characters. |
| `tenant` | Bounded ASCII token and an exact match for the trusted tenant. |
| `authority_domain` | Bounded ASCII token and an exact match for the trusted principal's authority domain. |
| `policy_version` | Bounded ASCII token and an exact match for the trusted ingress policy version. |
| `publisher` | Bounded ASCII token and an exact match for the authenticated principal. |
| `surface` | Closed enum: `announcements` or `incidents`; it must equal the trusted permitted surface. |
| `scope` | Exact object `{kind, ids}`. `kind` is `tenant`, `project`, `repository`, `machine`, or `resource`; `ids` is non-empty, sorted, and unique. There is no global scope. |
| `affected_operations` | 1–32 bounded tokens, sorted and unique. No wildcard. |
| `affected_resources` | 1–32 bounded tokens, sorted and unique. No wildcard. |
| `issued_at` / `expires_at` | Canonical UTC timestamps with milliseconds. TTL must be positive and no more than seven days. |
| `unfreeze_of` | `null` for a freeze. For an unfreeze, exact object `{event_id, control_id, fingerprint}` referencing the active freeze. |

Tokens match `^[a-z0-9](?:[a-z0-9._:/-]{0,127})$`. Arrays must already be
in canonical lexical order; the validator never silently normalizes authority.

## Canonical JSON and event IDs

Canonical JSON recursively sorts object keys, preserves validated array order,
normalizes negative zero to zero, and rejects non-finite numbers, sparse or
augmented arrays, accessors, non-plain objects, excessive nesting, and values
larger than the contract bound. Proxy-backed input is copied from data-property
descriptors into a plain snapshot before validation or hashing, so later reads
cannot change the identity or trusted time. The event ID is:

```text
sha256(utf8(canonical_json(event_without_event_id)))
```

This repository's portable conformance fixture is
`fixtures/hasna-control-v1/conformance.json`:

- fixture id: `project-freeze-unfreeze`
- freeze event id: `sha256:41a6e7b5480d20fd587b3170ee6615bd509e6fc4411f5ce15f612b0bc4328547`
- unfreeze event id: `sha256:0b5500cd5f2c29b65badf330b612100baa44052cf8c607fb39ee6414c19eb6f3`
- canonical event-sequence hash: `sha256:0cffbec5ba8980dd9b2fd27e0c52b472f285dd7da8efc910a28351141c1d0b31`

## Trusted envelope

Metadata claims never authenticate themselves. The caller must supply this
closed, server-trusted envelope independently of message content and control
metadata:

```ts
interface TrustedControlEnvelopeV1 {
  authenticated_principal: string;
  tenant: string;
  authority_domain: string;
  permitted_surface: "announcements" | "incidents";
  policy_version: string;
  server_time: string;
  blocking: boolean;
}
```

`server_time` is the trusted ingress time for that observation, not an
event-authored timestamp or the time a historical query happens to run. A
freeze requires `blocking: true`; an unfreeze requires `blocking: false`.
Generic rows with `blocking=1` remain ordinary blockers and do not become
controls.

The evaluator configuration also supplies an activation timestamp. Both the
event issue time and trusted ingress time must be at or after activation, so a
preseeded metadata row cannot become authoritative after the validator is
enabled.

## Lifecycle and evaluation

The evaluator processes validated observations by trusted ingress time, then
event issue time, lifecycle version, and event ID. Backend return order does not
change the result. The backend snapshot and each observation are closed runtime
objects; an unknown backend status, accessor, sparse array, or extra backend key
returns `indeterminate`. Observations issued or ingressed after the requested
evaluation time are excluded as future evidence.

- An exact replay is idempotent.
- A different event at the same control/lifecycle version is rejected.
- An unfreeze must be later than the freeze in both trusted ingress and issue
  time, arrive before the freeze expires, match the same trusted context and
  target arrays, and carry the exact `unfreeze_of` reference.
- A bad, stale, future, reordered, wrong-domain, wrong-scope, wrong-ID, or
  wrong-fingerprint unfreeze leaves the freeze active.
- Lifecycles are isolated by tenant, authority domain, and control ID.
- Overlapping controls remain independent; releasing one cannot release a
  sibling control.
- A freeze applies only when tenant, authority domain, scope intersection,
  operation, and resource all match. Unrelated operations continue.

The result is `allow`, `hold`, or `indeterminate`, always with
`enforced: false`. `hold` is an observation for an applicable active freeze,
not an enforcement action. Malformed candidates, unsupported versions, invalid
evaluator input, or backend failure return `indeterminate` without inventing a
global hold. If malformed evidence is mixed with a known active control, the
result remains `indeterminate` while retaining that control ID as diagnostic
state; uncertainty is not disguised as a definitive hold. Independent safety
containment remains outside this contract.

Literal or malformed `FREEZE`, `UNFREEZE`, and `BLOCKED` text is never read by
the evaluator. The legacy compatibility vectors are in
`fixtures/hasna-control-v1/legacy-blockers.json`.

Secret-shaped values are rejected with a stable diagnostic code. Diagnostics
contain no rejected field value, and the core does not log inputs.

## Activation, rollback, and integration boundary

Activation is configuration-only: `mode: "observe_only"`, validator version
`hasna.control/v1`, and a trusted activation timestamp. Rollback sets the mode
to `off` (or stops selecting this validator version). There is no database down
migration because this slice adds no schema and performs no writes.

The following work is intentionally not part of this core:

1. A trusted Conversations ingress adapter must derive principal, tenant,
   authority domain, permitted surface, policy version, server ingress time,
   and blocking state from authenticated server context and immutable row
   columns. It must reserve/overwrite the control metadata key rather than trust
   caller-supplied envelope fields.
2. Historical rows without that trusted ingress evidence must stay ineligible;
   activation must be later than their ingress time.
3. A bounded backend adapter must return `status: "unavailable"` on read failure
   and must not synthesize rows or global controls.
4. A future Codewith `PreToolUse` integration must map the exact tool operation,
   resource, tenant, authority domain, and scope into the evaluator. While the
   mode is observe-only it may emit redacted telemetry only; it must not deny a
   tool call. Live enforcement requires a separately reviewed activation slice.
5. A package export can be added after the open `src/index.ts` lane lands. Until
   then the core stays disjoint and repository-internal.
