# connect-waboxapp

TypeScript connector for the [WaboxApp WhatsApp API](https://www.waboxapp.com/wapi/rest).

## Install

```bash
bun install
```

## Configure

```bash
connect-waboxapp config set-token <your-api-token>
connect-waboxapp config set-uid <sender-phone-with-country-code>
```

Or set environment variables (see `.env.example`).

## Usage

```bash
# Send a text message
connect-waboxapp send chat --to 34666789123 --custom-uid msg-001 --text "Hello"

# Send image, link, or media
connect-waboxapp send image --to 34666789123 --custom-uid msg-002 --url https://example.com/image.png
connect-waboxapp send link --to 34666789123 --custom-uid msg-003 --url https://example.com
connect-waboxapp send media --to 34666789123 --custom-uid msg-004 --url https://example.com/doc.pdf

# Check account status
connect-waboxapp status get
```

## Development

```bash
bun run dev --help
bun run typecheck
bun test
bun run build
```

## API reference

Public docs: https://www.waboxapp.com/assets/doc/waboxapp-API-v3.pdf

Base URL: `https://www.waboxapp.com/api`

Authentication uses `token` (API token) and `uid` (sender WhatsApp number) on every request.
