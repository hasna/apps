# @hasna/banking

Agent-safe banking control plane for Hasna infrastructure and AI agents.

This repository is public, but the implementation migration is intentionally
not published yet. The seed work currently lives in the private internal
payments prototype and must pass the OSS migration, secret-scan, provider
capability, and live-money safety gates before source code is imported here.

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

- Mercury
- bunq
- Revolut Business
- Erste BCR via PSD2/open-banking AIS/PIS

Live money movement and virtual-card actions will remain gated by provider
scope checks, policy, idempotency, approvals, audit logging, and reconciliation.
