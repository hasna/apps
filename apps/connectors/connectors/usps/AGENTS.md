# AGENTS.md

## Connector: usps

- Package: `@hasna/connect-usps`
- Auth: Bearer token via `USPS_API_KEY`
- Base URL: `https://api.usps.com/v1` (configurable via `USPS_BASE_URL`)
- Docs: https://developers.usps.com/
- No browser-use dependency; real REST API only
- No secrets in source; `.env.example` has placeholders only

## Security

- [ ] No hardcoded API keys
- [ ] No internal references (beepmedia, hasnaxyz)
- [ ] Uses `@hasna` namespace
