# connect-unifold

TypeScript connector for the [Unifold](https://unifold.io) cross-chain deposit API.

## Features

- Multi-profile configuration
- Bearer token authentication
- Users, payment intents, treasury accounts, and deposit addresses
- Raw API request support
- Pretty and JSON output formats

## Quick Start

```bash
cd connectors/unifold
bun install
bun run dev config set-key <your-api-key>
bun run dev users list
```

## CLI Commands

```bash
connect-unifold profile list
connect-unifold config set-key <key>
connect-unifold users list --limit 5
connect-unifold users get <userId>
connect-unifold payment-intents list --status requires_payment
connect-unifold payment-intents get <id>
connect-unifold payment-intents create --amount 2500 --currency USD --user-id <userId>
connect-unifold treasury create --user-id <userId> --network base
connect-unifold treasury get <accountId>
connect-unifold deposit-addresses list --account-id <accountId>
connect-unifold raw --path /payment-intents --method POST --body '{"amount":100}'
```

## Environment Variables

| Variable | Description |
|----------|-------------|
| `UNIFOLD_API_KEY` | API key (overrides profile) |
| `UNIFOLD_BASE_URL` | Custom API base URL (default `https://api.unifold.io/v1`) |

## API Reference

Public documentation: https://docs.unifold.io/api

Base URL: `https://api.unifold.io/v1`

## License

Apache-2.0
