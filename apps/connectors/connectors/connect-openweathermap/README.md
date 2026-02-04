# connect-openweathermap

OpenWeatherMap API connector CLI - Get current weather, forecasts, and air quality data

## Installation

```bash
bun install -g @hasna/connect-openweathermap
```

## Quick Start

```bash
# Set your API key
connect-openweathermap config set-key YOUR_API_KEY

# Or use environment variable
export OPENWEATHERMAP_API_KEY=YOUR_API_KEY
```

## CLI Commands

```bash
# Configuration
connect-openweathermap config set-key <key>
connect-openweathermap config set-units <metric|imperial|standard>
connect-openweathermap config set-city <city>
connect-openweathermap config show

# Current Weather
connect-openweathermap current city [name] [--country <code>]
connect-openweathermap current coords <lat> <lon>
connect-openweathermap current zip <zipCode> [--country <code>]

# Forecast (5-day/3-hour)
connect-openweathermap forecast city [name] [--country <code>]
connect-openweathermap forecast coords <lat> <lon>

# Air Quality
connect-openweathermap air city <name> [--country <code>]
connect-openweathermap air coords <lat> <lon>

# Geocoding
connect-openweathermap geo search <city> [--country <code>] [--limit <n>]
connect-openweathermap geo reverse <lat> <lon>
```

## Profile Management

```bash
# Create profiles for different accounts
connect-openweathermap profile create work --api-key xxx --use
connect-openweathermap profile create personal --api-key yyy

# Switch profiles
connect-openweathermap profile use work

# Use profile for single command
connect-openweathermap -p personal <command>

# List profiles
connect-openweathermap profile list
```

## Library Usage

```typescript
import { Openweathermap } from '@hasna/connect-openweathermap';

const client = new Openweathermap({ apiKey: 'YOUR_API_KEY' });

// Use the client
// See CLAUDE.md for detailed API documentation
```

## Environment Variables

| Variable | Description |
|----------|-------------|
| `OPENWEATHERMAP_API_KEY` | API key (also accepts `OPENWEATHER_API_KEY`) |
| `OPENWEATHERMAP_UNITS` | Default units (metric/imperial/standard) |
| `OPENWEATHERMAP_LANG` | Language code (en, es, fr, etc.) |
| `OPENWEATHERMAP_CITY` | Default city name |

## Data Storage

Configuration stored in `~/.connect/connect-openweathermap/`:

```
~/.connect/connect-openweathermap/
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
