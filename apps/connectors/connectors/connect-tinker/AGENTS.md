# AGENTS.md

This file provides guidance to AI coding agents when working with this repository.

## Project Overview

connect-tinker is a TypeScript connector for the Tinker LLM fine-tuning API by Thinking Machines Lab. It provides both a CLI tool and a TypeScript library for programmatic access to training, sampling, and state management operations.

## Build & Run Commands

```bash
# Install dependencies
bun install

# Run CLI in development
bun run dev

# Build for distribution
bun run build

# Type check
bun run typecheck
```

## Code Style

- TypeScript with strict mode
- ESM modules (`type: module`)
- Async/await for all async operations
- Minimal dependencies: commander, chalk
- Type annotations required everywhere

## Project Structure

```
src/
├── api/           # API client modules
│   ├── client.ts  # HTTP client with authentication
│   └── index.ts   # Main connector class
├── cli/
│   └── index.ts   # CLI commands
├── types/
│   └── index.ts   # TypeScript types
├── utils/
│   ├── config.ts  # Multi-profile configuration
│   └── output.ts  # CLI output formatting
└── index.ts       # Library exports
```

## Authentication

Bearer Token authentication. Credentials can be set via:
- Environment variable (see below)
- Profile configuration: `connect-tinker config set-key <key>`


## Key Patterns

### Multi-Profile Configuration

Profiles stored in `~/.connect/connect-tinker/profiles/`:
- Each profile is a separate JSON file
- `current_profile` file tracks active profile
- `--profile` flag overrides for single command
- Environment variable `TINKER_API_KEY` overrides profile config

### Authentication

API key can be set via:
- Environment variable: `TINKER_API_KEY`
- Profile configuration: `connect-tinker config set-key <key>`

Get your API key from https://tinker-console.thinkingmachines.ai

### Tinker APIs

The connector wraps four main Tinker API areas:

**Training API:**
- `createLoRATrainingClient()` - Create a new training session
- `forward()` - Forward pass only (no gradients)
- `forwardBackward()` - Forward/backward pass (compute gradients)
- `optimStep()` - Apply optimizer update
- `zeroGrad()` - Reset accumulated gradients

**Sampling API:**
- `createSamplingClient()` - Load model for inference
- `sample()` - Generate completions
- `computeLogprobs()` - Get token probabilities

**State API:**
- `saveState()` - Save weights and optimizer state
- `loadState()` - Load weights only
- `loadStateWithOptimizer()` - Load weights and optimizer
- `listStates()` - List saved checkpoints
- `downloadCheckpoint()` - Download checkpoint archive

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

## Environment Variables

| Variable | Description |
|----------|-------------|
| `TINKER_API_KEY` | Tinker API key (overrides profile) |
| `TINKER_BASE_URL` | Override base URL (optional) |

## Data Storage

```
~/.connect/connect-tinker/
├── current_profile   # Active profile name
└── profiles/
    ├── default.json  # Default profile
    └── {name}.json   # Named profiles
```

## Dependencies

- commander: CLI framework
- chalk: Terminal styling
