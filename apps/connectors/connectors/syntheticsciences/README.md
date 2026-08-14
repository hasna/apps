# @hasna/connect-syntheticsciences

Synthetic Sciences API connector CLI — an AI co-scientist for managing research
projects, searching scientific literature, running experiments, and dispatching
GPU jobs.

- API docs / sign up: https://syntheticsciences.ai/
- Default API base URL: `https://api.syntheticsciences.ai/v1` (configurable)

## Installation

```bash
bun install
bun run build
```

## Authentication

Set your API key via environment variable or the CLI config:

```bash
export SYNTHETICSCIENCES_API_KEY=your-key
# optional: point at a different environment
export SYNTHETICSCIENCES_BASE_URL=https://api.syntheticsciences.ai/v1
```

or

```bash
connect-syntheticsciences config set-key your-key
connect-syntheticsciences config set-base-url https://api.syntheticsciences.ai/v1
```

See `.env.example` for the expected variables.

## CLI usage

```bash
# Projects
connect-syntheticsciences projects list
connect-syntheticsciences projects get <id>
connect-syntheticsciences projects create "My project" --description "..."

# Literature
connect-syntheticsciences literature "CRISPR base editing" --limit 10

# Experiments
connect-syntheticsciences experiments list --project <id>
connect-syntheticsciences experiments create --project <id> --hypothesis "..."

# GPU jobs
connect-syntheticsciences gpu-jobs dispatch --experiment <id> --command "python run.py"
connect-syntheticsciences gpu-jobs get <id>

# Drafts
connect-syntheticsciences drafts --project <id>

# Raw escape hatch
connect-syntheticsciences raw GET /projects
```

Global flags: `--api-key`, `--base-url`, `--profile`, `--format <json|table|pretty>`.

## Programmatic usage

```ts
import { SyntheticSciences } from '@hasna/connect-syntheticsciences';

const ss = SyntheticSciences.fromEnv();
const projects = await ss.research.listProjects({ limit: 20 });
```

## Development

```bash
bun run typecheck
bun test
bun run build
```

## License

Apache-2.0
