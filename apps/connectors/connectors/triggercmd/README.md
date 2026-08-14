# connect-triggercmd

TypeScript connector for the [TRIGGERcmd](https://www.triggercmd.com) remote command automation API.

## Features

- List registered computers and commands
- Trigger remote commands with optional parameters
- View command run history
- Multi-profile configuration
- Bearer token authentication
- CLI and library API

## Quick Start

```bash
cd connectors/triggercmd
bun install

# Set your token from the TRIGGERcmd Instructions page
export TRIGGERCMD_API_KEY=your-token-here

# Or configure via CLI
bun run dev config set-key your-token-here

# List computers and commands
bun run dev computers list
bun run dev commands commandlist

# Trigger a command
bun run dev trigger run MyPC calculator

# View run history
bun run dev runs list --command-id <id>
```

## CLI Commands

```bash
connect-triggercmd computers list
connect-triggercmd commands commandlist
connect-triggercmd commands list --computer-id <id>
connect-triggercmd trigger run <computer> <trigger> [--params <value>]
connect-triggercmd runs list [--command-id <id>] [--sort-on createdAt,DESC]
connect-triggercmd profile list
connect-triggercmd config set-key <token>
```

## Environment Variables

| Variable | Description |
|----------|-------------|
| `TRIGGERCMD_API_KEY` | API token from Instructions page |
| `TRIGGERCMD_TOKEN` | Alias for API token |

## License

Apache-2.0
