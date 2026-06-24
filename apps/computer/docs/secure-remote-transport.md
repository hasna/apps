# Secure Remote Transport

Open-computer treats fleet control as a separate trust boundary. A planner route or Todo approval can authorize intent, but approval is not a transport credential and it does not grant remote execution by itself.

## Strategy

- `fleet.capabilities` and `fleet.route` are read-only planning operations.
- `fleet.run_smoke` and `fleet.pull_artifact` are mutations because they execute code remotely or extract machine artifacts.
- Mutating fleet operations require all of:
  - a capability-scoped approval for the exact fleet action,
  - an explicit operator opt-in for the selected remote transport,
  - a machine-bound transport record whose machine ID matches the planned action,
  - a verified machine-scoped capability token bound to the requested machine, action, and transport, recorded only as present in audit metadata,
  - authenticated transport: SSH through the operator's SSH agent, open-machines MCP HTTP with an API key over loopback or HTTPS, or a resident agent with API-key or mTLS auth.
- HTTP transport is allowed only when it is HTTPS or loopback-only development. Plain remote HTTP is blocked even after approval.
- mTLS for open-machines MCP HTTP is reserved until open-machines implements request certificate verification. The planner must not accept self-attested mTLS on that route.
- Audit rows must redact raw machine IDs, route targets, endpoints, and capability token values. They should record only transport kind, auth class, endpoint class, token presence, explicit opt-in, and machine-binding match.
- `fleet.pull_artifact` planner inputs must pass the artifact executor contract before transport is considered: approved evidence namespace (`smoke/`, `reports/`, `screenshots/`, or `traces/`), approved source scope (`run_artifact` or `fleet_evidence`), hard max-size cap, no traversal or credential-like filenames, and `hash_only` mode by default.
- Materialized artifact pulls require an expected SHA-256 digest and a separate matching artifact approval bound to machine ID, artifact ID, source scope, digest, and max bytes. Without that approval, only hash-only metadata pulls can proceed.
- Fleet capability-token verification receives artifact-scoped claims for `pull_artifact`: artifact ID hash, namespace, source scope, mode, max bytes, and expected digest when present. Raw artifact IDs remain out of route audit metadata.

## Current Implementation

The planner capability router enforces the strategy before returning `allowed` for a mutating fleet route. Approved fleet mutations without a secure `fleetTransport` request and a capability-token verifier remain `blocked`.

Artifact adapters should call `authorizeAndPullFleetArtifact` rather than pulling bytes directly. The wrapper enforces the pre-pull contract, refuses unsafe requests before adapter invocation, validates returned machine/artifact/source-scope binding, enforces `maxBytes`, checks SHA-256 and expected digest, prevents hash-only materialization, and requires materialized output to declare redaction.

The source-checkout live machine validation script is a lab gate, not a general remote job API. It is bounded to safe probes, records redacted JSON/Markdown evidence, and skips SSH/Tailscale probes unless `--approve-remote-validation` plus `--lab-only-remote-validation` are present for that run, or the matching `OCCTRL_APPROVE_REMOTE_VALIDATION=1` and `OCCTRL_LAB_ONLY_REMOTE_VALIDATION=1` env vars are set. Its report declares `source_checkout_lab_only` and `production_allowed=false`; production remote validation must use a secured fleet adapter.

## Future Execution Adapter Contract

Any adapter that executes a fleet route must preserve this order:

1. Route the planner tool and create an approval if required.
2. Resolve and bind the concrete transport to the same machine ID.
3. Generate or receive a capability token scoped to one run, one machine, and one action.
4. Acquire a `fleet_machine` runtime lease.
5. Execute through open-machines or the resident agent using the authenticated transport.
6. Evaluate the fleet artifact contract before pulling any artifact bytes. Hash-only pulls may return digest metadata; materialized pulls require the stronger artifact approval and expected digest.
7. Record the run step, transport-policy decision, audit event, and artifact metadata.

No future adapter should introduce a fallback path that shells to SSH, calls MCP HTTP, or pulls artifacts without those steps.
