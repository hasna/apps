# AGENTS.md

This file provides guidance to AI coding agents when working with this repository.

## Project Overview

Google Maps Platform connector - Geocoding, Directions, Places, and Distance Matrix

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
- Profile configuration: `connect-googlemaps config set-key <key>`


## CLI Commands

### Geocoding

```bash
# Address to coordinates
connect-googlemaps geocode address "1600 Amphitheatre Parkway, Mountain View, CA"

# Coordinates to address (reverse geocoding)
connect-googlemaps geocode coords 37.4224764 -122.0842499
```

### Places

```bash
# Search places by text
connect-googlemaps places search "coffee shops in San Francisco"
connect-googlemaps places search "restaurants" --type restaurant --opennow

# Find places nearby
connect-googlemaps places nearby --location "37.7749,-122.4194" --radius 1000 --type restaurant

# Get place details
connect-googlemaps places details ChIJN1t_tDeuEmsRUsoyG83frY4

# Autocomplete
connect-googlemaps places autocomplete "Eiffel"
```

### Directions

```bash
# Get route directions
connect-googlemaps directions route --from "New York, NY" --to "Boston, MA"

# With options
connect-googlemaps directions route \
  --from "San Francisco, CA" \
  --to "Los Angeles, CA" \
  --mode driving \
  --avoid tolls,highways \
  --alternatives \
  --departure now
```

### Distance Matrix

```bash
# Calculate distances between multiple points
connect-googlemaps matrix calculate \
  --origins "New York, NY|Boston, MA" \
  --destinations "Washington, DC|Philadelphia, PA"
```

### Utilities

```bash
# Get timezone
connect-googlemaps timezone 40.7128 -74.0060

# Get elevation
connect-googlemaps elevation "36.578581,-118.291994|36.23998,-116.83171"

# Generate static map URL
connect-googlemaps staticmap --center "New York, NY" --zoom 12 --markers "40.7128,-74.0060"
```

## Environment Variables

| Variable | Description |
|----------|-------------|
| `GOOGLE_MAPS_API_KEY` | Google Maps Platform API key |

## Data Storage

```
~/.connect/connect-googlemaps/
├── current_profile   # Active profile name
└── profiles/
    ├── default.json  # Default profile
    └── {name}.json   # Named profiles
```

## Dependencies

- commander: CLI framework
- chalk: Terminal styling
