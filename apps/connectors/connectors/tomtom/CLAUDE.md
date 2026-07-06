# CLAUDE.md

TomTom connector — geocoding, reverse geocoding, POI search, and routing.

## Build & Run

```bash
bun install
bun run dev
bun run build
```

## Authentication

API key via `TOMTOM_API_KEY` or `connect-tomtom config set-key <key>`.

Dashboard auth type: **apikey** (field: `api_key`).

## API

- Base URL: `https://api.tomtom.com`
- Search: `/search/2/geocode`, `/search/2/reverseGeocode`, `/search/2/poiSearch`
- Routing: `/routing/1/calculateRoute`
- API key passed as `?key=` query parameter

## CLI

```bash
connect-tomtom geocode <query>
connect-tomtom reverse-geocode <lat> <lon>
connect-tomtom search-poi <query>
connect-tomtom calculate-route --origin-lat ... --origin-lon ... --destination-lat ... --destination-lon ...
```
