# connect-wandb

Weights & Biases GraphQL API connector — experiment tracking with multi-profile support.

## Installation

```bash
bun install -g @hasna/connect-wandb
```

## Quick Start

```bash
# Set your API key
wandb config set-key YOUR_API_KEY

# Or use environment variable
export WANDB_API_KEY=YOUR_API_KEY

# Verify authentication
wandb viewer
```

## CLI Commands

```bash
wandb config set-key <key>              # Set API key
wandb config show                       # Show config
wandb viewer                            # Get authenticated user
wandb project-runs --entity <e> --project <p>  # List project runs
wandb graphql --query '<query>' [--variables '<json>']
wandb raw --body '<json>'               # Raw GraphQL POST body
wandb profile list                      # List profiles
wandb profile use <name>                # Switch profile
```

## Profile Management

```bash
wandb profile create work --api-key xxx --use
wandb profile create personal --api-key yyy
wandb -p personal viewer
```

## Library Usage

```typescript
import { Wandb } from '@hasna/connect-wandb';

const client = new Wandb({ apiKey: process.env.WANDB_API_KEY! });

const { viewer } = await client.viewer.get();
const runs = await client.projects.projectRuns({ entity: 'team', project: 'demo' });
```

## Environment Variables

| Variable | Description |
|----------|-------------|
| `WANDB_API_KEY` | API key (overrides profile) |
| `WANDB_BASE_URL` | Override GraphQL base URL |

## License

Apache-2.0
