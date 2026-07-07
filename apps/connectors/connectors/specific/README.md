# connect-specific

Specific API connector - A TypeScript wrapper for the [Specific](https://specific.app) public GraphQL API with multi-profile support.

Specific is an AI conversational-survey and user-research platform. This connector talks to the public GraphQL endpoint at `https://public-api.specific.app/graphql`.

## Installation

```bash
bun install -g @hasna/connect-specific
```

## Quick Start

```bash
# Set your API key (create one in-app: Settings -> API -> Create)
specific config set-key YOUR_API_KEY

# Or use an environment variable
export SPECIFIC_API_KEY=YOUR_API_KEY
```

## CLI Commands

```bash
specific config set-key <key>     # Set API key
specific config show              # Show config
specific profile list             # List profiles
specific profile use <name>       # Switch profile

specific workspace                # Show the current workspace
specific surveys list             # List surveys
specific surveys get <id>         # Get a survey
specific conversations [-s <id>]  # List conversations (optionally by survey)
specific companies                # List companies
specific users                    # List users
```

## Profile Management

```bash
# Create profiles for different accounts
specific profile create work --api-key xxx --use
specific profile create personal --api-key yyy

# Switch profiles
specific profile use work

# Use a profile for a single command
specific -p personal surveys list

# List profiles
specific profile list
```

## Library Usage

```typescript
import { Specific } from '@hasna/connect-specific';

const client = new Specific({ apiKey: 'YOUR_API_KEY' });

const workspace = await client.myWorkspace();
const surveys = await client.surveys();
```

## Environment Variables

| Variable | Description |
|----------|-------------|
| `SPECIFIC_API_KEY` | Personal API key (overrides profile) |
| `SPECIFIC_BASE_URL` | Override the GraphQL endpoint |

## Data Storage

Configuration is stored in `~/.hasna/connectors/specific/`:

```
~/.hasna/connectors/specific/
├── current_profile   # Active profile name
└── profiles/
    ├── default.json  # Default profile
    └── {name}.json   # Named profiles
```

## Development

```bash
# Install dependencies
bun install

# Run CLI in development
bun run dev

# Build
bun run build

# Type check
bun run typecheck
```

## License

Apache-2.0
