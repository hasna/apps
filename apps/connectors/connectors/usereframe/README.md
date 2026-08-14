# Reframe (UserReframe) Connector

TypeScript connector for the [Reframe](https://usereframe.ai/) hardware procurement API.

## Authentication

Bearer token authentication using an API key from the Reframe dashboard.

| Variable | Description |
|----------|-------------|
| `USEREFRAME_API_KEY` | API key (overrides profile) |
| `USEREFRAME_BASE_URL` | API base URL (default `https://api.usereframe.ai/v1`) |

Profiles are stored in `~/.hasna/connectors/connect-usereframe/`.

## Commands

```bash
connect-usereframe list-boms [--query '{"status":"sourcing"}']
connect-usereframe get-bom <bomId>
connect-usereframe upload-bom --body '{"name":"Proto Board","lineItems":[...]}'
connect-usereframe search-parts --query '{"q":"STM32","lifecycle":"active"}'
connect-usereframe request-quotes <bomId> [--body '{"targetDate":"2026-06-01"}']
connect-usereframe list-suppliers [--query '{"region":"US"}']
connect-usereframe create-purchase-order --body '{"quoteId":"quote-1","supplierId":"supplier-1"}'
connect-usereframe get-shipment <shipmentId>
connect-usereframe ask-assistant -m "Find alternate parts for the MCU"
connect-usereframe raw-request --path /boms -X GET
```

## Development

```bash
bun install
bun run dev --help
bun run typecheck
bun run build
bun test
```
