# connect-elevenlabs

ElevenLabs API connector CLI - Text-to-speech, voice cloning, sound effects, and more

## Installation

```bash
bun install -g @hasna/connect-elevenlabs
```

## Quick Start

```bash
# Set your API key
connect-elevenlabs config set-key YOUR_API_KEY

# Or use environment variable
export ELEVENLABS_API_KEY=YOUR_API_KEY
```

## CLI Commands

```bash
connect-elevenlabs config set-key <key>     # Set API key
connect-elevenlabs config show              # Show config
connect-elevenlabs profile list             # List profiles
connect-elevenlabs profile use <name>       # Switch profile
```

## Profile Management

```bash
# Create profiles for different accounts
connect-elevenlabs profile create work --api-key xxx --use
connect-elevenlabs profile create personal --api-key yyy

# Switch profiles
connect-elevenlabs profile use work

# Use profile for single command
connect-elevenlabs -p personal <command>

# List profiles
connect-elevenlabs profile list
```

## Library Usage

```typescript
import { Elevenlabs } from '@hasna/connect-elevenlabs';

const client = new Elevenlabs({ apiKey: 'YOUR_API_KEY' });

// Use the client
// See CLAUDE.md for detailed API documentation
```

## Environment Variables

| Variable | Description |
|----------|-------------|
| `ELEVENLABS_API_KEY` | API key (primary) |
| `XI_API_KEY` | API key (alternative) |
| `ELEVENLABS_VOICE_ID` | Default voice ID |
| `ELEVENLABS_MODEL_ID` | Default TTS model |
| `ELEVENLABS_OUTPUT_DIR` | Output directory for audio files |

## Data Storage

Configuration stored in `~/.connect/connect-elevenlabs/`:

```
~/.connect/connect-elevenlabs/
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
