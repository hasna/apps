# connect-tensorboard

TensorBoard connector CLI — read training runs, scalar tags, and scalar metrics from a running TensorBoard server via its public HTTP data API.

## Installation

```bash
bun install -g @hasna/connect-tensorboard
```

## Quick Start

TensorBoard's data API is read-only and requires **no authentication** — you only
need the base URL of a running TensorBoard server (default `http://localhost:6006`).

```bash
# Point at your TensorBoard server (optional; defaults to http://localhost:6006)
connect-tensorboard config set-base-url http://localhost:6006

# Or use an environment variable
export TENSORBOARD_BASE_URL=http://localhost:6006
```

## CLI Commands

### Configuration
```bash
connect-tensorboard config set-base-url <url>   # Set the server base URL
connect-tensorboard config show                 # Show current configuration
connect-tensorboard config clear                # Clear saved configuration
```

### Runs
```bash
connect-tensorboard runs                        # List all training runs
```

### Scalar tags
```bash
connect-tensorboard tags                        # List scalar tags across all runs
connect-tensorboard tags --run <run>            # List scalar tags for one run
```

### Scalars
```bash
connect-tensorboard scalars --run <run> --tag <tag>   # Fetch a scalar time series
```

### Environment
```bash
connect-tensorboard env                         # Show server/experiment metadata
```

All commands accept `-f json` for machine-readable output:

```bash
connect-tensorboard -f json scalars --run train --tag loss
```

## Programmatic API

```ts
import { TensorBoard } from '@hasna/connect-tensorboard';

const tb = new TensorBoard({ baseUrl: 'http://localhost:6006' });

const runs = await tb.listRuns();
const tags = await tb.listScalarTags('train');
const loss = await tb.getScalars('train', 'loss');
```

## API Notes

TensorBoard exposes an unauthenticated JSON data API used by its web UI:

| Endpoint | Description |
|----------|-------------|
| `GET /data/runs` | Run names |
| `GET /data/plugin/scalars/tags` | Scalar tags grouped by run |
| `GET /data/plugin/scalars/scalars?run=<run>&tag=<tag>` | Scalar `[wall_time, step, value]` series |
| `GET /data/environment` | Server/experiment metadata |

## Environment Variables

| Variable | Description |
|----------|-------------|
| `TENSORBOARD_BASE_URL` | Base URL of the TensorBoard server (default `http://localhost:6006`) |

## License

Apache-2.0
