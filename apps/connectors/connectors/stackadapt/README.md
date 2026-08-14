# @hasna/connect-stackadapt

TypeScript connector and CLI for the [StackAdapt](https://www.stackadapt.com/) programmatic advertising platform.

## Features

- Multi-profile API key configuration
- REST client for campaigns, conversion trackers, and reporting stats
- GraphQL query/mutation support
- Raw REST escape hatch for undocumented endpoints
- Bearer + `X-Authorization` authentication per StackAdapt API conventions

## Quick Start

```bash
cd connectors/stackadapt
bun install
export STACKADAPT_API_KEY=your-api-key-here
bun run dev campaign list
```

Obtain an API key from **Account Settings → API Integration** in the StackAdapt dashboard. API access must be enabled on your account.

## CLI

```bash
connect-stackadapt campaign list
connect-stackadapt campaign get <id>
connect-stackadapt campaign create -n "Campaign" -b 10000
connect-stackadapt events list
connect-stackadapt search quarterly
connect-stackadapt graphql -q '{ campaigns { id name } }'
connect-stackadapt raw GET /campaigns
```

## API bases

| Surface | Default URL | Purpose |
|---------|-------------|---------|
| REST v2 | `https://api.stackadapt.com/service/v2` | Reporting reads, legacy campaign endpoints |
| GraphQL | `https://api.stackadapt.com/graphql` | Primary write/management API |

See [StackAdapt docs](https://docs.stackadapt.com/) for schema details.

## Development

```bash
bun run typecheck
bun run build
bun test src/api/client.test.ts
```

## License

Apache-2.0
