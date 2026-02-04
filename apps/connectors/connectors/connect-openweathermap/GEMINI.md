# GEMINI.md

This file provides guidance to Gemini when working with this repository.

## Project Overview

OpenWeatherMap API connector CLI - Get current weather, forecasts, and air quality data

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

API Key authentication. Credentials can be set via:
- Environment variable (see below)
- Profile configuration: `connect-openweathermap config set-key <key>`


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

## Environment Variables

| Variable | Description |
|----------|-------------|
| `OPENWEATHERMAP_API_KEY` | API key (also accepts `OPENWEATHER_API_KEY`) |
| `OPENWEATHERMAP_UNITS` | Default units (metric/imperial/standard) |
| `OPENWEATHERMAP_LANG` | Language code (en, es, fr, etc.) |
| `OPENWEATHERMAP_CITY` | Default city name |

## Data Storage

```
~/.connect/connect-openweathermap/
├── current_profile   # Active profile name
└── profiles/
    ├── default.json  # Default profile
    └── {name}.json   # Named profiles
```

## Dependencies

- commander: CLI framework
- chalk: Terminal styling
