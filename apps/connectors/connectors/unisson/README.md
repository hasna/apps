# connect-unisson

Unisson Runner API connector — product expert agents, customer tasks, and knowledge base sync.

## Installation

```bash
bun install -g @hasna/connect-unisson
```

## Quick Start

```bash
# Set your API key
connect-unisson config set-key YOUR_API_KEY

# Or use environment variable
export UNISSON_API_KEY=YOUR_API_KEY
```

## CLI Commands

```bash
# Agents
connect-unisson agents list --query '{"status":"active"}'
connect-unisson agents get "agent-id"
connect-unisson agents create --body '{"product":"Acme SaaS","channel":"slack"}'

# Tasks
connect-unisson tasks list --query '{"open":true}'
connect-unisson tasks get "task-id"
connect-unisson tasks create --body '{"agentId":"agent-1","title":"Onboard customer"}'

# Knowledge base
connect-unisson knowledge articles --query '{"updatedSince":"2026-01-01"}'
connect-unisson knowledge sync --body '{"source":"docs"}'

# Raw API access
connect-unisson raw-request --path /runner/execute -X POST --body '{"prompt":"Configure SSO"}'

# Config & profiles
connect-unisson config set-key <key>
connect-unisson config set-base-url <url>
connect-unisson profile list|use|create|delete|show
```

## Library Usage

```typescript
import { Unisson } from '@hasna/connect-unisson';

const client = new Unisson({ apiKey: process.env.UNISSON_API_KEY! });
const agents = await client.agents.list({ status: 'active' });
```

## Environment Variables

| Variable | Description |
|----------|-------------|
| `UNISSON_API_KEY` | Bearer API key |
| `UNISSON_BASE_URL` | Optional API base URL (default: `https://api.unisson.ai/v1`) |

## Data Storage

```
~/.hasna/connectors/connect-unisson/
├── current_profile
└── profiles/
    └── default.json
```

## License

Apache-2.0
