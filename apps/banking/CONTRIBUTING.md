# Contributing

Thanks for working on `@hasna/banking`.

## Local Development

```bash
bun install
bun run build
bun run typecheck
bun test
```

## Safety Requirements

- Do not commit secrets, credentials, account numbers, card data, `.connect/`,
  `.secrets/`, or local provider token stores.
- Keep agent-facing operations request-oriented. Agents may request payment or
  card actions; they must not bypass policy, approval, audit, or reconciliation.
- Encode provider limitations as capability flags and tests.
- Keep Erste BCR as PSD2 AIS/PIS only unless official commercial API access
  proves broader account or card control.
- Add tests for every money, payment, provider, CLI, SDK, or MCP behavior.

## Release Requirements

Before publishing:

- run build, typecheck, tests, release smoke checks, and pack dry-run
- run staged and full-tree secret scans
- complete four adversarial review gates: security/compliance, architecture,
  provider/API feasibility, and release/publication
- record evidence in the `#open-banking` channel and Todos plan
