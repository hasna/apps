# @hasna/guardrails

Reusable guardrail and policy decisions for agentic systems.

This project is intended to evaluate whether actions, prompts, shell commands,
MCP tool calls, browser/computer use, model routing, source access, secrets
access, and business operations should be allowed, denied, warned, redacted, or
approval-gated.

## Status

First useful OSS version: local-first TypeScript SDK, policy evaluator, CLI,
examples, and integration helper shapes for sibling `@hasna/*` tools.

## Install

```bash
bun install
bun run typecheck
bun test
```

## CLI

```bash
guardrails evaluate \
  --policy examples/policies/starter.guardrails.json \
  --input examples/requests/destructive-shell-command.json \
  --json
```

Exit codes:

- `0`: allowed, warned, or redacted.
- `1`: denied or invalid input.
- `2`: approval required.

## SDK

```ts
import {
  defaultGuardrailPolicySet,
  evaluateGuardrail,
  openTerminalCommandGuardrailInput,
} from "@hasna/guardrails";

const input = openTerminalCommandGuardrailInput({
  command: "rm -rf ./tmp/generated-output",
  cwd: "/workspace/project",
  targetKind: "shell",
});

const decision = evaluateGuardrail(input, defaultGuardrailPolicySet);
```

## Decision Shape

Every decision includes:

- `status`: `allow`, `deny`, `warn`, `redact`, or `approval_required`.
- `reason`, the selected `matchedRule`, and all effective `matchedPolicies`.
- `rationaleTrace`, including each rule's match result, specificity, failed
  matcher groups, and selection rationale.
- `evidence`, `obligations`, `redactions`, and `approvalRequirements`.
- `audit` metadata with a per-evaluation `decisionId`, an `evaluatedAt`
  timestamp, policy set, operation type, actor, trace id, and labels. Pass
  `options.decisionId` or `options.now` to supply either yourself.
- `audit.decisionFingerprint`: a deterministic hash of the input, policy set,
  and engine version. Two evaluations of the same request share a fingerprint
  while keeping distinct decision ids, so audit rows stay both correlatable and
  individually addressable.

Matched rules are ranked by effect (`deny` > `approval_required` > `redact` >
`warn` > `allow`), then by the number of matcher constraints, then by the
number of alternatives those constraints accept. Policy id is the final
deterministic tie-break.

`policySet.defaultDecision` is a **fallback, not a floor**: it applies only when
no rule matches. A single matching rule of any effect — including `warn` or
`allow` — overrides it. To express a deny-by-default posture, write the denial
as a broad rule and let more specific `allow` rules outrank it; setting
`defaultDecision: "deny"` alone will not block a request that any advisory rule
happens to match.

## Examples

The starter policy covers:

- Secret redaction.
- Destructive shell command approval.
- Remote content piped to shell denial.
- Expensive model routing warnings.
- External-source trust warnings.
- High-impact business-action approval.

## Boundaries

Guardrails evaluate and decide. They do not execute actions, dispatch prompts,
run commands, call MCP tools, route models, or scan repositories.

- `actions` defines executable action contracts and previews.
- `shield` owns security scanning and vulnerability/secret exposure
  workflows.
- `terminal`, `dispatch`, `gateway`, and
  `router` own their runtime mechanics and can call this package before
  execution.

See [docs/boundaries.md](docs/boundaries.md) and
[docs/integrations.md](docs/integrations.md).
