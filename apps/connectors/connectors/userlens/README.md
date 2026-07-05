# connect-userlens

Userlens connector CLI — customer success analytics identify, group, track, and raw event forwarding.

## Installation

```bash
bun install -g @hasna/connect-userlens
```

## Quick Start

```bash
connect-userlens config set-key YOUR_WRITE_CODE_API_KEY

# Or use environment variable
export USERLENS_API_KEY=YOUR_WRITE_CODE_API_KEY
```

## CLI Commands

```bash
connect-userlens identify user-123 --traits '{"email":"user@example.com","plan":"pro"}'
connect-userlens group acct-1 user-123 --traits '{"name":"Acme"}'
connect-userlens track user-123 "Feature Used" --properties '{"feature":"export"}'
connect-userlens forward-raw --events '[{"event":"$ul_pageview","userId":"user-123","properties":{"$ul_page":"/dashboard"}}]'
connect-userlens raw-request --path /event --method POST --body '{"type":"track","userId":"user-123","event":"Ping"}'
```

## API Reference

- Docs: https://userlens.gitbook.io/userlens-analytics/guides/api-reference
- Events base: `https://events.userlens.io`
- Raw events base: `https://raw.userlens.io`
- Auth: HTTP Basic with Write Code API key as username

## Environment Variables

| Variable | Description |
|----------|-------------|
| `USERLENS_API_KEY` | Write Code API key |
| `USERLENS_EVENTS_BASE_URL` | Optional events API base URL |
| `USERLENS_RAW_BASE_URL` | Optional raw events API base URL |

## License

Apache-2.0
