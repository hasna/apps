# connect-tinker

Tinker connector CLI - LLM fine-tuning and training API with LoRA support

## Installation

```bash
bun install -g @hasna/connect-tinker
```

## Quick Start

```bash
# Set your API key
connect-tinker config set-key YOUR_API_KEY

# Or use environment variable
export TINKER_API_KEY=YOUR_API_KEY
```

## CLI Commands

### Models
```bash
connect-tinker models                        # List available models
```

### Training
```bash
connect-tinker training create               # Create training client
connect-tinker training create -m "meta-llama/Llama-3.2-1B" -r 32
connect-tinker training list                 # List all training clients
connect-tinker training info <clientId>      # Get client info
connect-tinker training delete <clientId>    # Delete client
connect-tinker training forward <clientId> -d data.json        # Forward only (loss, no gradients)
connect-tinker training forward-backward <clientId> -d data.json
connect-tinker training optim-step <clientId> -l 1e-4
connect-tinker training zero-grad <clientId>
connect-tinker training gradient-stats <clientId>
```

### State Management
```bash
connect-tinker state save <clientId> <name>  # Save checkpoint
connect-tinker state save <clientId> my-model --ttl 86400
connect-tinker state load <clientId> <path>  # Load weights
connect-tinker state load <clientId> <path> --with-optimizer
connect-tinker state list                    # List checkpoints
connect-tinker state info <path>             # Get checkpoint info
connect-tinker state download <path>         # Download checkpoint
connect-tinker state delete <path>           # Delete checkpoint
connect-tinker state extend-ttl <path> --seconds 3600
```

### Sampling
```bash
connect-tinker sampling create <modelPath>   # Create sampling client
connect-tinker sampling list                 # List all sampling clients
connect-tinker sampling info <clientId>      # Get client info
connect-tinker sampling delete <clientId>    # Delete client
connect-tinker sampling sample <clientId> -i prompt.json
connect-tinker sampling sample <clientId> -i prompt.json -t 0.7 -m 256
connect-tinker sampling logprobs <clientId> -i prompt.json
```

### Quick Training
```bash
connect-tinker train -d data.json            # Quick training loop
connect-tinker train -d data.json -m "meta-llama/Llama-3.2-1B" -r 32 -s 100 -l 1e-4 -o my-model
```

### Output Formats
```bash
connect-tinker -f yaml models   # YAML output (default)
connect-tinker -f json models   # JSON output
connect-tinker -f pretty models # Pretty-printed output
```

### Profile & Config
```bash
connect-tinker profile list                  # List profiles
connect-tinker profile use <name>            # Switch profile
connect-tinker profile create <name>         # Create profile
connect-tinker profile create <name> --api-key <key> --use
connect-tinker config set-key <key>          # Set API key
connect-tinker config set-model <model>      # Set default model
connect-tinker config set-rank <rank>        # Set default LoRA rank
connect-tinker config show                   # Show configuration
connect-tinker config clear                  # Clear configuration
```

## Profile Management

```bash
# Create profiles for different accounts
connect-tinker profile create work --api-key xxx --use
connect-tinker profile create personal --api-key yyy

# Switch profiles
connect-tinker profile use work

# Use profile for single command
connect-tinker -p personal <command>

# List profiles
connect-tinker profile list
```

## Library Usage

```typescript
import { Tinker } from '@hasna/connect-tinker';

const client = new Tinker({ apiKey: 'YOUR_API_KEY' });

// Use the client
// See CLAUDE.md for detailed API documentation
```

## Environment Variables

| Variable | Description |
|----------|-------------|
| `TINKER_API_KEY` | Tinker API key (overrides profile) |
| `TINKER_BASE_URL` | Override base URL (optional) |

## Data Storage

Configuration stored in `~/.connect/connect-tinker/`:

```
~/.connect/connect-tinker/
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

MIT
