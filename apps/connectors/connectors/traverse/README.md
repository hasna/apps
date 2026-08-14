# connect-traverse

A TypeScript CLI and library for the [Traverse](https://traverse.so/) API — RL training environments, episodes, judgments, and datasets.

## Features

- Bearer API key authentication
- Environments, episodes, judgments, and datasets endpoints
- Multi-profile configuration
- Pretty and JSON output formats
- Raw API request support

## Installation

```bash
bun add -g @hasna/connect-traverse
```

## Setup

1. Get an API key from [traverse.so](https://traverse.so/)
2. Configure the CLI:

```bash
connect-traverse config set-key your_api_key_here

# Or use environment variables
export TRAVERSE_API_KEY=your_api_key_here
export TRAVERSE_BASE_URL=https://api.traverse.so/v1  # optional
```

## CLI Usage

### Environments

```bash
connect-traverse environments list
connect-traverse environments get <id>
connect-traverse environments create --body '{"name":"my-env"}'
```

### Episodes & Judgments

```bash
connect-traverse episodes list
connect-traverse episodes get <id>
connect-traverse judgments submit <episodeId> --score 0.9
```

### Datasets

```bash
connect-traverse datasets list
```

### Raw Request

```bash
connect-traverse raw-request --path /environments
connect-traverse raw-request --path /episodes --method POST --body '{"key":"value"}'
```

### Profiles

```bash
connect-traverse profile list
connect-traverse profile create staging --api-key <key> --use
connect-traverse profile use staging
```

## Library Usage

```typescript
import { Traverse } from '@hasna/connect-traverse';

const traverse = new Traverse({ apiKey: process.env.TRAVERSE_API_KEY! });

const environments = await traverse.environments.list();
const judgment = await traverse.episodes.submitJudgment('episode-id', { score: 0.9 });
```

## License

Apache-2.0
