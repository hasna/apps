# @hasna/connect-sprout-social

A TypeScript connector and CLI for the [Sprout Social API](https://api.sproutsocial.com/docs/) — account metadata, profile and post analytics, inbox messages, draft publishing, cases, and media.

## Features

- Multi-profile configuration (switch between tokens / customers)
- Bearer token authentication
- Customer-scoped endpoints resolved from a configured customer id
- Pretty and JSON output formats
- TypeScript with strict mode; zero runtime deps beyond commander + chalk

## Quick Start

```bash
# Install dependencies
bun install

# Discover the customer ids your token can reach
bun run dev metadata client

# Save credentials to the active profile
bun run dev config set-token <access-token>
bun run dev config set-customer <customer-id>

# List connected social profiles
bun run dev metadata profiles
```

## Authentication

Generate an API access token from **Settings > API** in your Sprout Social
account. Most endpoints are nested under a numeric **customer id**
(`/v1/{customer_id}/...`); only `metadata client` works without one.

Credentials can be supplied three ways (highest precedence first):

1. CLI flags: `--token <token>`, `--customer <id>`
2. Environment: `SPROUTSOCIAL_ACCESS_TOKEN`, `SPROUTSOCIAL_CUSTOMER_ID`
3. Saved profile: `config set-token` / `config set-customer`

## CLI Structure

```bash
connect-sprout-social [options] [command]

Options:
  -t, --token <token>       Access token (overrides config)
  -c, --customer <id>       Customer id (overrides config)
  -f, --format <format>     Output format (json, pretty)
  -p, --profile <profile>   Use a specific profile

Commands:
  profile list|use|create|delete|show     Manage configuration profiles
  config set-token|set-customer|show|clear Manage credentials

  metadata client                          Customer ids for the token
  metadata profiles|tags|groups|users      Account metadata
  metadata topics|teams|queues             Listening / case metadata

  analytics profiles [--metric ...]        Profile-level analytics
  analytics posts [--metric ...]           Post-level analytics

  message list [--filter ...]              Inbox messages (requires group filter)
  case list [--filter ...]                 Cases

  post create --group --profiles --text    Create a draft post
  post get <id>                            Get a publishing post
  media upload --url <url>                 Register media by URL
```

## Library Usage

```typescript
import { SproutSocial } from '@hasna/connect-sprout-social';

const sprout = new SproutSocial({
  accessToken: process.env.SPROUTSOCIAL_ACCESS_TOKEN!,
  customerId: process.env.SPROUTSOCIAL_CUSTOMER_ID,
});

const clients = await sprout.getClientMetadata();
const analytics = await sprout.getProfileAnalytics({
  filters: ['customer_profile_id.eq(123456)'],
  metrics: ['impressions', 'engagements'],
});
```

`SproutSocial.fromEnv()` builds an instance from the environment variables above.

## Environment Variables

| Variable | Description |
|----------|-------------|
| `SPROUTSOCIAL_ACCESS_TOKEN` | Bearer access token |
| `SPROUTSOCIAL_CUSTOMER_ID` | Numeric customer id |
| `SPROUTSOCIAL_BASE_URL` | Override base URL (optional) |

## Development

```bash
bun install
bun run dev        # run the CLI
bun run typecheck  # type check
bun test           # run tests
bun run build      # build dist/ + bin/
```

## License

Apache-2.0
