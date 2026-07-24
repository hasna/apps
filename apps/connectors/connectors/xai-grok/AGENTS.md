# AGENTS.md

## Overview

connect-xai-grok — full xAI Grok API connector (@hasna namespace). Rebuilt from public xAI docs; not a copy of platform-alumia.

## Structure

```
src/api/     # client + resource modules
src/cli/     # commander CLI (Alumia-aligned command names)
src/types/
src/utils/   # config + output
```

## Auth

`XAI_API_KEY` or profile config. Optional `XAI_BASE_URL`.

## Development

```bash
bun install
bun run dev -- list-models
bun run typecheck
bun test
```

## Do not

- Conflate with `connectors/xai` (slug `xai`, chat-only)
- Add browser-use or internal references
