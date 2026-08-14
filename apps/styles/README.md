# @hasna/styles

Style management platform for AI coding agents — profiles, preferences, health checks, and design system enforcement

[![npm](https://img.shields.io/npm/v/@hasna/styles)](https://www.npmjs.com/package/@hasna/styles)
[![License](https://img.shields.io/badge/license-Apache--2.0-blue)](LICENSE)

## Install

```bash
npm install -g @hasna/styles
```

## CLI Usage

```bash
styles --help
```

- `styles list`
- `styles info <name>`
- `styles use <name>`
- `styles init`
- `styles profile list`
- `styles profile create`

### Compact output by default

Open Styles CLIs are compact by default, including when an agent runs them in a
non-TTY shell. List/status commands show summaries, cap rows, truncate long text,
and print a hint for the detail path.

Use gradual disclosure when you need more:

```bash
styles list --limit 5
styles list --cursor 5 --limit 5
styles list --verbose
styles info minimalist
styles list --json
```

`--json` is the explicit full machine-readable path. Detail commands such as
`styles info <name>` and `styles kits get <id>` show one record at a time.

## MCP Server

```bash
styles-mcp
```

MCP tools are available for style, health, context, extraction, presence, and
storage operations.

MCP tools also use compact defaults. List/search/history-style tools return
counts, bounded pages, truncated long text, and `nextCursor` when there is more
to fetch. Use `verbose: true`, `include_style_md: true`, or `include_code: true`
only when an agent needs the larger detail payload.

Compact resources are available at `styles://registry/summary` and
`styles://summary/{name}`. The existing `styles://registry` and
`styles://{name}` resources remain full-detail compatibility paths.

## HTTP mode

Shared Streamable HTTP transport for multi-agent sessions (binds localhost only):

```bash
styles-mcp --http
# or: MCP_HTTP=1 styles-mcp
# port: --port 8837  >  MCP_HTTP_PORT  >  8837 (default)
```

- Health: `GET http://127.0.0.1:8837/health`
- MCP: `http://127.0.0.1:8837/mcp`

## Data Directory

Data is stored in `~/.hasna/styles/`. Existing `~/.open-styles/` or
`~/.styles/` package-owned global state is copied forward on first use without
overwriting files already present in `~/.hasna/styles/`. Project-local
`.styles/style.md` files are intentionally preserved as project context files.

## License

Apache-2.0 -- see [LICENSE](LICENSE)
