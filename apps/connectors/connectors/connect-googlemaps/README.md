# connect-googlemaps

Google Maps Platform connector - Geocoding, Directions, Places, and Distance Matrix

## Installation

```bash
bun install -g @hasna/connect-googlemaps
```

## Quick Start

```bash
# Set your API key
connect-googlemaps config set-key YOUR_API_KEY

# Or use environment variable
export GOOGLE_MAPS_API_KEY=YOUR_API_KEY
```

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

## Profile Management

```bash
# Create profiles for different accounts
connect-googlemaps profile create work --api-key xxx --use
connect-googlemaps profile create personal --api-key yyy

# Switch profiles
connect-googlemaps profile use work

# Use profile for single command
connect-googlemaps -p personal <command>

# List profiles
connect-googlemaps profile list
```

## Library Usage

```typescript
import { Googlemaps } from '@hasna/connect-googlemaps';

const client = new Googlemaps({ apiKey: 'YOUR_API_KEY' });

// Use the client
// See CLAUDE.md for detailed API documentation
```

## Environment Variables

| Variable | Description |
|----------|-------------|
| `GOOGLE_MAPS_API_KEY` | Google Maps Platform API key |

## Data Storage

Configuration stored in `~/.connect/connect-googlemaps/`:

```
~/.connect/connect-googlemaps/
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
