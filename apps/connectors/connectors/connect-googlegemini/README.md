# connect-googlegemini

Google Gemini API connector CLI - Text, image, video generation with Gemini, Nano Banana, and Veo models

## Installation

```bash
bun install -g @hasna/connect-googlegemini
```

## Quick Start

```bash
# Set your API key
connect-googlegemini config set-key YOUR_API_KEY

# Or use environment variable
export GEMINI_API_KEY=YOUR_API_KEY
```

## CLI Commands

### Text Generation
```bash
connect-googlegemini ask <prompt>                  # Quick text
connect-googlegemini generate text <prompt>        # With options
connect-googlegemini generate json <prompt>        # JSON output
connect-googlegemini generate tokens <text>        # Count tokens
```

### Image Generation (Nano Banana)
```bash
connect-googlegemini image generate <prompt>       # Generate
connect-googlegemini image edit <img> <instruction> # Edit
connect-googlegemini image describe <img>          # Vision
```

### Video Generation (Veo)
```bash
connect-googlegemini video generate <prompt>       # Generate
connect-googlegemini video status <op>             # Status
connect-googlegemini video models                  # List
```

### Speech
```bash
connect-googlegemini speech generate <text>        # TTS
connect-googlegemini speech voices                 # List
```

### Embeddings
```bash
connect-googlegemini embed text <text>             # Embed
connect-googlegemini embed similarity <t1> <t2>    # Compare
```

### Files
```bash
connect-googlegemini files list                    # List
connect-googlegemini files upload <path>           # Upload
connect-googlegemini files delete <name>           # Delete
```

### Models
```bash
connect-googlegemini models list                   # All models
connect-googlegemini models info <model>           # Model info
```

### Profile & Config
```bash
connect-googlegemini profile list                  # List
connect-googlegemini profile use <name>            # Switch
connect-googlegemini config set api-key <key>      # Set key
connect-googlegemini config show                   # Show
```

## Profile Management

```bash
# Create profiles for different accounts
connect-googlegemini profile create work --api-key xxx --use
connect-googlegemini profile create personal --api-key yyy

# Switch profiles
connect-googlegemini profile use work

# Use profile for single command
connect-googlegemini -p personal <command>

# List profiles
connect-googlegemini profile list
```

## Library Usage

```typescript
import { Googlegemini } from '@hasna/connect-googlegemini';

const client = new Googlegemini({ apiKey: 'YOUR_API_KEY' });

// Use the client
// See CLAUDE.md for detailed API documentation
```

## Environment Variables

| Variable | Description |
|----------|-------------|
| `GEMINI_API_KEY` | Google Gemini API key |
| `GEMINI_BASE_URL` | Base URL override |

## Data Storage

Configuration stored in `~/.connect/connect-googlegemini/`:

```
~/.connect/connect-googlegemini/
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
