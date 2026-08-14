# connect-tomtom

TomTom connector for geocoding, reverse geocoding, POI search, and routing via the TomTom Search and Routing APIs.

## Installation

```bash
bun install -g @hasna/connect-tomtom
```

## Quick Start

```bash
# Set your API key
connect-tomtom config set-key YOUR_API_KEY

# Or use environment variable
export TOMTOM_API_KEY=YOUR_API_KEY
```

Get an API key at [developer.tomtom.com](https://developer.tomtom.com/).

## CLI Commands

### Geocoding

```bash
connect-tomtom geocode "Berlin" --limit 3
connect-tomtom geocode "Amsterdam" --country-set NL
```

### Reverse Geocoding

```bash
connect-tomtom reverse-geocode 52.5200 13.4050
```

### POI Search

```bash
connect-tomtom search-poi "coffee" --limit 5
connect-tomtom search-poi "gas station" --country-set US
```

### Routing

```bash
connect-tomtom calculate-route \
  --origin-lat 52.5200 --origin-lon 13.4050 \
  --destination-lat 48.1351 --destination-lon 11.5820 \
  --travel-mode car
```

### Configuration

```bash
connect-tomtom config show
connect-tomtom config clear
```

## Environment Variables

| Variable | Description |
|----------|-------------|
| `TOMTOM_API_KEY` | TomTom API key |

## Data Storage

```
~/.hasna/connectors/connect-tomtom/
└── config.json
```

## License

Apache-2.0
