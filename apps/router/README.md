# @hasna/router

`@hasna/router` (CLI: `open-router`) is the smart model router companion for
[`open-gateway`](https://github.com/hasna/open-gateway). It makes deterministic,
inspectable route decisions for prompts; it does not execute provider calls,
hold provider credentials, or expand gateway policy.

The core API is `routePrompt()`: pass a prompt or chat messages plus configured
providers, models, routes, and policy. It returns the selected candidate
reference, eligible scores, skipped candidates with reasons, prompt analysis,
source hints, and safety notes. Candidate references are redacted so service
responses do not expose provider keys, auth headers, or private base URLs.

## Install

```bash
# as a dependency
bun add @hasna/router

# as a CLI
bun add -g @hasna/router
open-router help
```

Local development:

```bash
bun install
bun test
bun run smoke
```

## CLI

Installed globally, the binary is `open-router`:

```bash
open-router route --config router.config.json --model auto --prompt "..."
open-router analyze --prompt "..."
open-router validate --config router.config.json
```

From a source checkout:

```bash
bun run src/cli/index.ts route \
  --config router.config.example.json \
  --model auto \
  --task coding \
  --priority quality \
  --prompt "Implement a retry helper in TypeScript."

bun run src/cli/index.ts smoke --config router.config.example.json
bun run src/cli/index.ts serve --config router.config.example.json --port 8797
```

The service exposes:

- `GET /health`
- `POST /v1/route`

## Library

```ts
import { loadRouterConfig, routePrompt } from "@hasna/router";

const config = await loadRouterConfig("router.config.example.json");
const decision = routePrompt({
  config,
  request: {
    model: "auto",
    messages: [{ role: "user", content: "Summarize these logs as JSON." }],
    hints: {
      priority: "balanced",
      requiredCapabilities: ["json"],
    },
  },
});

console.log(decision.selected?.model.id);
console.log(decision.scores);
```

## Design

Routing is intentionally transparent:

1. Analyze the prompt and caller hints.
2. Resolve configured candidates from the requested model or route alias.
3. Apply policy filters before scoring.
4. Score only eligible candidates by task fit, model capability, context,
   configured price, quality priors, recent metrics, caller priority, sticky
   session hash, and fallback order.
5. Return a complete explanation. If no candidate is policy-eligible, return
   `status: "no_route"` with skip reasons.

`open-router` preserves the `open-gateway` fail-closed model by treating request
policy as restrictive by default. Request hints can narrow providers, regions,
capabilities, costs, and data policy. They cannot expand configured policy unless
`policy.allowRequestPolicyExpansion` is explicitly enabled in the router config.

Credential checks are off by default because this package does not call
providers. Use `runtime.credentialMode: "skip-missing"` when running the router
standalone and you want missing provider env vars to make candidates ineligible.
`open-gateway` should continue enforcing credentials before execution. Service
responses redact provider auth, headers, credential env names, and endpoint
configuration.

## Gateway Compatibility

Descriptors and sanitized gateway-hint helpers are included for:

- Direct Hasna/open-gateway providers
- OpenRouter, including provider routing and Auto Router plugin options
- Vercel AI Gateway provider options
- LiteLLM Proxy
- Portkey AI Gateway
- Cloudflare AI Gateway
- Kong AI Gateway
- Helicone AI Gateway

See [open-gateway integration](docs/integration-open-gateway.md) and
[provider references](docs/provider-references.md).
