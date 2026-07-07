# Solcast Connector

TypeScript CLI and library for the [Solcast API](https://docs.solcast.com.au) — solar irradiance, weather, and rooftop PV power forecasts.

## Install

```bash
bun install
bun run build
```

## Authentication

API key authentication via query parameter. Set credentials with:

```bash
connect-solcast config set-key <your-api-key>
# or
export SOLCAST_API_KEY=your_api_key_here
```

Get an API key from the [Solcast Toolkit](https://toolkit.solcast.com.au/).

## CLI Commands

```bash
# Configuration
connect-solcast config set-key <key>
connect-solcast config set-base-url <url>
connect-solcast config show

# Rooftop PV by location
connect-solcast forecast rooftop-pv-power --lat -33.9 --lon 151.2 --capacity 5
connect-solcast live rooftop-pv-power --lat -33.9 --lon 151.2 --capacity 5
connect-solcast historic rooftop-pv-power --lat -33.9 --lon 151.2 --capacity 5 --start 2024-01-01T00:00:00Z --end 2024-01-02T00:00:00Z

# Registered rooftop sites
connect-solcast site forecasts <site-id>
connect-solcast site actuals <site-id>

# Raw API access
connect-solcast raw --path /data/forecast/rooftop_pv_power --lat -33.9 --lon 151.2 --capacity 5
```

## Library Usage

```typescript
import { Solcast } from '@hasna/connect-solcast';

const solcast = new Solcast({ apiKey: process.env.SOLCAST_API_KEY! });
const forecast = await solcast.api.forecastRooftopPvPower({
  latitude: -33.9,
  longitude: 151.2,
  capacity: 5,
  hours: 24,
});
```

## License

Apache-2.0
