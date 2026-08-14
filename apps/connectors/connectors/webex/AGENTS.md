# AGENTS.md

Guidance for AI agents working with connect-webex.

## Overview

`@hasna/connect-webex` is a TypeScript API connector for Cisco Webex with CLI and library exports.

## Commands

```bash
bun install
bun run dev
bun run build
bun run typecheck
bun test
```

## Structure

```
src/
├── api/           # HTTP client and resource modules
├── cli/           # Commander CLI
├── types/         # TypeScript interfaces
├── utils/         # Config and output helpers
└── index.ts       # Library exports
```

## Auth

Bearer token via `WEBEX_ACCESS_TOKEN` or profile config at `~/.hasna/connectors/connect-webex/`.

## Security

- No hardcoded tokens
- No internal company or repository references
- No browser-use dependency
