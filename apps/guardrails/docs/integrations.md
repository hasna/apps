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

## @hasna/terminal

Use `openTerminalCommandGuardrailInput()` before command execution. The starter
policy approval-gates destructive commands and denies remote-content-to-shell
patterns.

## @hasna/gateway (retired) → gateway edge

Use `modelRoutingGuardrailInput()` before routing or after candidate selection.
The starter policy warns on high per-token prices. The npm package that owned
provider eligibility, credentials, budgets, and request execution
(`@hasna/gateway`) was deleted in the 2026-09-03 owner wave and is not
republished; edge HTTP transit for the fleet now runs through the api.hasna.com
Cloudflare gateway (Worker `hasna-api-gateway`, source now maintained in the
private internal monorepo), which does not participate in model routing.

## Browser And Computer Use

Browser and computer-use callers can construct `GuardrailInput` directly with
`browser`, `computer`, `sourceAccess`, and `runtime` fields. External-source
trust warnings are driven by `sourceAccess.trustLevel` or
`browser.externalSource`.
