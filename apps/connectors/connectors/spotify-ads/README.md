# @hasna/connect-spotify-ads

TypeScript connector and CLI for the [Spotify Ads API v3](https://developer.spotify.com/documentation/ads-api).

## Features

- OAuth 2.0 authentication with token refresh
- Multi-profile configuration under `~/.hasna/connectors/spotify-ads/`
- Businesses, ad accounts, campaigns, ad sets, and ads
- Raw API escape hatch for undocumented endpoints

## Install

```bash
bun install
bun run build
```

## Quick start

```bash
export SPOTIFY_ADS_CLIENT_ID=your-client-id
export SPOTIFY_ADS_CLIENT_SECRET=your-client-secret

connect-spotify-ads auth setup $SPOTIFY_ADS_CLIENT_ID $SPOTIFY_ADS_CLIENT_SECRET
connect-spotify-ads auth login
connect-spotify-ads businesses list
connect-spotify-ads config set-ad-account <ad-account-uuid>
connect-spotify-ads campaigns list
```

## Library usage

```typescript
import { SpotifyAds } from '@hasna/connect-spotify-ads';

const client = new SpotifyAds({ accessToken: process.env.SPOTIFY_ADS_ACCESS_TOKEN! });
const businesses = await client.businesses.list();
```

## License

Apache-2.0
