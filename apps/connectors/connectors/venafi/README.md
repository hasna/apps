# @hasna/connect-venafi

Venafi TLS Protect Cloud API connector for certificate lifecycle, events, and search.

## Installation

```bash
bun install
```

## Configuration

Copy `.env.example` to `.env` and set your Venafi API key:

```bash
VENAFI_API_KEY=your-api-key-here
```

Or use the CLI:

```bash
bun run dev config set-key your-api-key-here
```

## Usage

```bash
bun run dev certificates list
bun run dev certificates get <certificateId>
bun run dev events list
bun run dev search --expression 'CN="example.com"'
```

## License

Apache-2.0
