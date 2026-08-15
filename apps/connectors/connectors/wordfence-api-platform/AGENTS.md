# AGENTS.md

`@hasna/connect-wordfence-api-platform` — Wordfence Intelligence v3 vulnerability feed connector.

## Auth

Bearer API key from https://www.wordfence.com/account/integrations

Env: `WORDFENCE_API_PLATFORM_API_KEY`, optional `WORDFENCE_API_PLATFORM_BASE_URL`

## API

- `GET /vulnerabilities/production` — full vulnerability database (JSON object keyed by ID)
- `GET /vulnerabilities/staging` — staging feed when available

No write/create endpoints on the public Intelligence feed.

## Security

- No hardcoded secrets
- No browser-use dependency
- `@hasna` namespace only
