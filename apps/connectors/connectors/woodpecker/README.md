# @hasna/connect-woodpecker

TypeScript connector for the [Woodpecker](https://woodpecker.co/) cold email outreach API.

## Install

```bash
bun install
```

## Authentication

Set your API key (requires Woodpecker API keys add-on):

```bash
export WOODPECKER_API_KEY=your-api-key
# or
bun run dev config set-key your-api-key
```

## Usage

```bash
# List campaigns
bun run dev campaigns list --status RUNNING

# Get campaign details
bun run dev campaigns get 1234567

# Create campaign from JSON body
bun run dev campaigns create --body ./campaign.json

# List webhook subscriptions
bun run dev events list

# Search prospects
bun run dev search prospects --search email=user@example.com

# Raw API request
bun run dev raw --path /v1/campaign_list
```

## Library

```typescript
import { Woodpecker } from '@hasna/connect-woodpecker';

const wp = Woodpecker.fromEnv();
const campaigns = await wp.listCampaigns({ status: 'RUNNING' });
```

## License

Apache-2.0
