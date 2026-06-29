# @hasna/banking

Agent-safe banking control plane for infrastructure and AI agents.

`@hasna/banking` is the public OSS package for a provider-capability model,
typed SDK, `banking` CLI, and `banking-mcp` entrypoint. It is request-oriented:
agents can inspect banking state and request payment/card actions, but live
money movement must pass policy, idempotency, approval, audit, and
reconciliation gates.

## Target Surfaces

| Surface | Target |
| --- | --- |
| Local folder | `open-banking` |
| GitHub repo | `hasna/banking` |
| npm package | `@hasna/banking` |
| CLI | `banking` |
| MCP binary | `banking-mcp` |
| Local data | `~/.hasna/banking/` |

## Initial Provider Scope

- Mercury: institution provider, including virtual-card lifecycle after amount
  units, scopes, IP policy, and sandbox are verified.
- bunq: institution provider after API context/session/signing and sandbox
  conformance are implemented.
- Revolut Business: institution provider with production-only card-management
  caveats encoded.
- Erste BCR: PSD2/open-banking access provider for AIS/PIS only unless broader
  commercial API access is proven.

Live money movement and virtual-card actions will remain gated by provider
scope checks, policy, idempotency, approvals, audit logging, and reconciliation.

## Install

```bash
bun add @hasna/banking
```

## CLI

```bash
banking --help
banking providers list --json
```

## SDK

```ts
import { createBankingClient } from "@hasna/banking";

const banking = createBankingClient();
console.log(banking.listProviders());
```

## MCP

```bash
banking-mcp --help
banking-mcp --list-tools
```

The full MCP protocol server lands with the agent-safe surfaces. The scaffold
already declares the planned tool names so downstream integration work can
target stable names.
