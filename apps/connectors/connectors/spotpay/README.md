# connect-spotpay

TypeScript connector for the SpotPay API — global stablecoin neobank for accounts, transactions, transfers, payments, cards, and exchange rates.

## Install

```bash
bun install
```

## CLI

```bash
bun run dev --help
connect-spotpay account get
connect-spotpay transactions list
connect-spotpay transfers create --body '{"amount":100,"currency":"USDC"}'
connect-spotpay payments create --file payment.json
connect-spotpay cards list
connect-spotpay exchange-rates get --from USDC --to EUR
connect-spotpay config set-key <api-key>
connect-spotpay profile list
```

## Authentication

Bearer token via `SPOTPAY_API_KEY` or profile config at `~/.hasna/connectors/connect-spotpay/`.

## Environment Variables

| Variable | Description |
|----------|-------------|
| `SPOTPAY_API_KEY` | API key (overrides profile) |
| `SPOTPAY_BASE_URL` | API base URL (default: `https://api.spotpay.com/v1`) |

## License

Apache-2.0
