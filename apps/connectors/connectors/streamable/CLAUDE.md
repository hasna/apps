# CLAUDE.md

This file provides guidance to Claude Code when working with the Streamable connector.

## Project Overview

`@hasna/connect-streamable` is a TypeScript connector for the documented Streamable read-only API (`https://api.streamable.com`).

## Commands

```bash
bun install
bun run dev video hn8hq
bun run dev oembed https://streamable.com/hn8hq
bun run typecheck
bun run build
```

## API Surface

- `getVideo`
- `getOEmbed`

## Environment Variables

No credentials are required for the documented read-only API.

## Documentation

- https://streamable.com/documentation
- https://streamable-support.zendesk.com/hc/en-us/articles/35415672400916
