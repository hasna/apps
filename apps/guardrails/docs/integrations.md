# Integrations

The SDK exports structural helper functions instead of importing sibling
packages. This keeps `@hasna/guardrails` generic OSS infrastructure and avoids
forcing every caller to install every `@hasna/*` package.

## @hasna/actions

Use `openActionsGuardrailInput()` for action preview and execution phases:

```ts
import { evaluateGuardrail, openActionsGuardrailInput } from "@hasna/guardrails";

const input = openActionsGuardrailInput({
  phase: "execute",
  action: {
    id: "refund.create",
    name: "Create refund",
    kind: "billing",
    input: { amountUsd: 2500, customerId: "cus_example", irreversible: true },
  },
});

const decision = evaluateGuardrail(input, policySet);
```

The helper preserves the action payload and also infers common business fields
such as `amountUsd`, `customerId`, `accountId`, `resource`, and `irreversible`
into the guardrail `business` context so generic approval policies can match.

## @hasna/dispatch

Use `openDispatchPromptGuardrailInput()` before prompt delivery. A dispatch
caller should block on `deny`, ask for approval on `approval_required`, display
warnings on `warn`, and use redacted audit fields when `redact` is returned.

## @hasna/mcps

Use `openMcpsToolCallGuardrailInput()` before tool calls or local stdio server
registration. Transport, server id, tool name, and arguments are included in the
policy input.

## @hasna/gateway

Use `modelRoutingGuardrailInput()` before routing or after candidate selection.
The starter policy warns on high per-token prices. The gateway package owns
provider eligibility, credentials, budgets, and request execution.

## Browser And Computer Use

Browser and computer-use callers can construct `GuardrailInput` directly with
`browser`, `computer`, `sourceAccess`, and `runtime` fields. External-source
trust warnings are driven by `sourceAccess.trustLevel` or
`browser.externalSource`.
