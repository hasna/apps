# CLAUDE.md

This file provides guidance to Claude Code when working with code in this repository.

## Project Overview

connect-spotify-ads is a TypeScript connector for the Spotify Ads API v3. It provides OAuth authentication, CLI commands, and a programmatic API for businesses, ad accounts, campaigns, ad sets, and ads.

## API Reference

- **Base URL**: `https://api-partner.spotify.com/ads/v3`
- **Auth**: OAuth 2.0 Bearer token (`Authorization: Bearer <access_token>`)
- **Token URL**: `https://accounts.spotify.com/api/token`
- **Authorize URL**: `https://accounts.spotify.com/authorize`
- **Docs**: https://developer.spotify.com/documentation/ads-api

## Auth

Authentication uses OAuth 2.0 authorization code flow with Spotify developer app credentials. Client ID and secret are stored in `~/.hasna/connectors/spotify-ads/credentials.json`. Per-profile tokens live in `profiles/<name>/tokens.json`.

Accept Ads API terms and allowlist your client ID in the Spotify developer dashboard before calling the API.

## Environment Variables

| Variable | Description |
|----------|-------------|
| `SPOTIFY_ADS_CLIENT_ID` | OAuth client ID |
| `SPOTIFY_ADS_CLIENT_SECRET` | OAuth client secret |
| `SPOTIFY_ADS_ACCESS_TOKEN` | Optional static access token |
| `SPOTIFY_ADS_REFRESH_TOKEN` | Optional refresh token override |
| `SPOTIFY_ADS_BASE_URL` | Optional API base URL override |

## CLI Commands

```bash
connect-spotify-ads auth setup <clientId> <clientSecret>
connect-spotify-ads auth login
connect-spotify-ads auth refresh
connect-spotify-ads auth status
connect-spotify-ads businesses list
connect-spotify-ads ad-accounts list <businessId>
connect-spotify-ads campaigns list --ad-account <id>
connect-spotify-ads campaigns get <campaignId> --ad-account <id>
connect-spotify-ads campaigns create -n "Name" --delivery-goal-group AWARENESS
connect-spotify-ads ad-sets list --ad-account <id>
connect-spotify-ads ads list --ad-account <id>
connect-spotify-ads raw -m GET -p /businesses
```

## Build & Run

```bash
bun install
bun run dev
bun run build
bun run typecheck
bun test
```
