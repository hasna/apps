# open-gateway Integration

`open-router` is intended to be called before `open-gateway` executes a request.
It recommends and explains an ordered candidate list. It does not send requests
to providers and does not own provider credentials, budgets, retries, streaming,
or usage ledgers.

## Local Library Contract

`open-gateway` can adapt its existing `GatewayRouteCandidate[]` into
`RouterCandidate[]` without reshaping most fields:

```ts
import { routePrompt, toOpenGatewayRouteDecision, type RouterCandidate } from "@hasna/router";

const candidates: RouterCandidate[] = gatewayCandidates;

const decision = routePrompt({
  config: {
    policy: gatewayConfig.policy,
    providers: gatewayConfig.providers,
    models: gatewayConfig.models,
    routes: gatewayConfig.routes,
  },
  request,
  candidates,
  runtime: {
    metrics: recentRouteMetrics,
    credentialMode: "ignore",
  },
});

if (decision.status !== "selected") {
  throw new GatewayHttpError({
    status: 400,
    type: "gateway_policy_error",
    code: "no_route",
    message: decision.reason,
    raw: decision,
  });
}

const selectedIds = decision.orderedCandidates.map((candidate) => candidate.model.id);
const orderedGatewayCandidates = selectedIds
  .map((id) => gatewayCandidates.find((candidate) => candidate.model.id === id))
  .filter(Boolean);
const routeMetadata = toOpenGatewayRouteDecision(decision);
```

`open-gateway` should still enforce:

- credential presence
- provider request construction
- request forwarding
- retry and fallback execution
- budget checks
- usage ledger writes
- strict OpenAI-compatible response handling

## Policy Alignment

The router mirrors the important `open-gateway` policy shape:

- `allowTraining`
- `allowLogging`
- `allowedRegions` / `blockedRegions`
- `allowedProviders` / `blockedProviders`
- `allowChineseProviders`
- `zeroDataRetentionRequired`
- `byokOnly`
- input/output price ceilings

By default, request hints can only narrow policy. They cannot expand configured
provider, region, or data permissions unless `allowRequestPolicyExpansion` is
set by the operator.

## Service Contract

For service mode, run:

```bash
open-router serve --config router.config.example.json --port 8797
```

Then call:

```http
POST /v1/route
Content-Type: application/json

{
  "model": "auto",
  "messages": [{ "role": "user", "content": "Implement a parser in TypeScript." }],
  "gateway": {
    "priority": "quality",
    "required_capabilities": ["tools"],
    "blocked_regions": ["cn"]
  }
}
```

The response is a `RouterDecision` with redacted `selected` and
`orderedCandidates`, plus `scores`, `skipped`, `analysis`, `policy`,
`gatewayHints`, and `safetyNotes`. The full provider descriptors remain in
`open-gateway` and should be joined by selected model id before execution.

## Open Gateway Changes That May Be Useful Later

No `open-gateway` files were changed for this package. A future integration PR
could add:

- an optional `@hasna/router` dependency
- a `router: "local" | "builtin"` config switch
- a metric snapshot adapter for latency/success rates
- a decision metadata field that stores the full `RouterDecision`
- optional use of `toOpenGatewayRouteDecision()` for existing snake_case
  `GatewayRouteDecision` metadata
- service-mode support for `OPEN_ROUTER_URL`
