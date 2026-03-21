# @hasna/brains

Fine-tuned model tracker and trainer. Gathers training data from your AI agent ecosystem (todos, mementos, conversations, Claude sessions), submits fine-tuning jobs to OpenAI or Thinker Labs, and tracks models locally in SQLite.

## Install

```bash
bun add @hasna/brains        # as a library
bun add -g @hasna/brains     # for CLI globally
```

Or with npm/npx:

```bash
npm install -g @hasna/brains
```

## Configure

Set your API keys via the config command (stored in `~/.brains/config.json`):

```bash
brains config set OPENAI_API_KEY sk-...
brains config set THINKER_LABS_API_KEY tl-...      # optional
brains config set THINKER_LABS_BASE_URL https://... # optional
brains config list                                  # view all (values masked)
```

Or set as environment variables — env vars take precedence over the config file:

```bash
export OPENAI_API_KEY=sk-...
```

## Quickstart

```bash
# 1. Gather training data from all agent memory sources
brains data gather --source all --limit 500

# 2. Preview examples from the gathered file
brains data preview ~/.brains/datasets/todos-1234567890.jsonl -n 3

# 3. Start a fine-tuning job (auto-detects latest dataset)
brains finetune start --provider openai --base-model gpt-4o-mini-2024-07-18 --name my-model

# 4. Watch the job until it completes
brains finetune watch <job-id> --interval 30

# 5. List your tracked models
brains models list
```

## CLI Reference

### `brains models`

```bash
brains models list                          # list all tracked models
brains models list --json                   # as JSON (pipe-friendly)
brains models show <id>                     # show full details
brains models rename <id> <displayName>     # set display name
brains models describe <id> <description>   # set description
brains models tag <id> <tag>                # add tag
brains models untag <id> <tag>              # remove tag
brains models collection <id> <name>        # assign to collection
brains models import <job-id>               # import externally created model
  --provider openai                         # provider (default: openai)
  --name "My Model"                         # optional display name
```

### `brains finetune`

```bash
brains finetune start                       # start a fine-tuning job
  --provider openai                         # required: openai | thinker-labs
  --base-model gpt-4o-mini-2024-07-18       # required: base model
  --name "My Model"                         # required: display name
  --dataset /path/to/data.jsonl             # optional: auto-detects latest if omitted

brains finetune status <job-id>             # check job status
  --provider openai
  --json

brains finetune watch <job-id>              # poll until complete
  --provider openai
  --interval 30                             # poll interval in seconds (default: 30)

brains finetune list                        # list jobs from provider
  --provider openai
  --json
```

### `brains data`

```bash
brains data gather                          # gather training data
  --source all                              # todos|mementos|conversations|sessions|all
  --output ~/.brains/datasets               # output directory
  --limit 500                               # max examples per source

brains data preview <file>                  # preview JSONL examples
  -n 5                                      # number of examples to show

brains data merge <file1> <file2> ...       # merge multiple JSONL files
  --output merged.jsonl
  --no-dedupe                               # skip deduplication

brains data list                            # list gathered datasets
  --json
```

### `brains collections`

```bash
brains collections list                     # list collections with model counts
  --json
brains collections show <name>              # list models in a collection
brains collections rename <old> <new>       # rename across all models
```

### `brains config`

```bash
brains config list                          # show all config (values masked)
brains config get OPENAI_API_KEY            # get a specific value
brains config set OPENAI_API_KEY sk-...     # set a value
brains config unset OPENAI_API_KEY          # remove from config file
```

### `brains remove`

```bash
brains remove <id>                          # auto-detect type (model or job)
brains remove <id> --type model
brains remove <id> --type job
```

## MCP Server

Use `brains-mcp` as a Claude Code MCP server to manage fine-tuning directly from Claude:

```bash
claude mcp add --transport stdio --scope user brains -- brains-mcp
```

Available tools: `list_models`, `get_model`, `start_finetune`, `get_finetune_status`, `gather_training_data`, `preview_training_data`

## HTTP Server

```bash
brains-serve            # starts on port 7020
PORT=8080 brains-serve  # custom port
```

Endpoints:

| Method | Path | Description |
|--------|------|-------------|
| GET | `/health` | Version and status |
| GET | `/models` | List all models |
| GET | `/models/:id` | Get model details |
| PATCH | `/models/:id` | Update name/description/tags/collection |
| GET | `/jobs` | List all training jobs |
| GET | `/jobs/:id` | Get job details |
| GET | `/datasets` | List all gathered datasets |
| POST | `/datasets/gather` | Trigger gather (`{ sources, limit, output_dir }`) |

## Data Storage

All data is stored locally:

| Path | Contents |
|------|----------|
| `~/.brains/brains.db` | SQLite — models, jobs, datasets |
| `~/.brains/datasets/` | JSONL training files |
| `~/.brains/config.json` | API keys and settings |

## Training Data Sources

| Source | Reads from | What it generates |
|--------|-----------|-------------------|
| `todos` | `~/.todos/todos.db` | Task creation, status update, search examples |
| `mementos` | `~/.mementos/mementos.db` | Memory recall, save, category search examples |
| `conversations` | `~/.conversations/messages.db` | Multi-agent conversation windows |
| `sessions` | `~/.claude/projects/` | Claude Code development session transcripts |

## License

Apache-2.0
