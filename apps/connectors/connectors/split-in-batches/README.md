# @hasna/connect-split-in-batches

TypeScript connector and CLI for the [Split In Batches](https://www.ycombinator.com/companies/split-in-batches) API.

## Installation

```bash
bun install
```

## Configuration

Copy `.env.example` to `.env` and set your API key:

```bash
SPLIT_IN_BATCHES_API_KEY=your_api_key_here
# Optional:
# SPLIT_IN_BATCHES_BASE_URL=https://api.split-in-batches.com/v1
```

Or use the CLI profile/config commands:

```bash
bun run dev -- config set-key <your-api-key>
```

## Usage

```bash
# List batches
bun run dev -- batches list

# Get a batch
bun run dev -- batches get <batchId>

# Create a batch
bun run dev -- batches create --name "My workflow"

# List events
bun run dev -- events list

# Search
bun run dev -- search --query "workflow"

# Raw API request
bun run dev -- raw-request --path /batches --method GET
```

## Development

```bash
bun run typecheck
bun test
bun run build
```

## License

Apache-2.0
