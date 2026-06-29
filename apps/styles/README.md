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

## MCP Server

```bash
styles-mcp
```

28 tools available.

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
