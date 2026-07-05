# CLAUDE.md

## Overview

connect-xai-grok is the full-surface xAI Grok API connector (distinct from connect-xai chat-only slug). Auth: Bearer API key. Base URL: `https://api.x.ai/v1`.

## Commands

```bash
bun install && bun run dev
bun run typecheck
bun test
```

## API modules

`models`, `chat`, `responses`, `embeddings`, `tokenize`, `images`, `video`, `audio`, `files`, `batches`, `collections`, plus `rawRequest`.

## Environment

| Variable | Description |
|----------|-------------|
| `XAI_API_KEY` | API key (required) |
| `XAI_BASE_URL` | Optional base URL override |

## Storage

`~/.hasna/connectors/connect-xai-grok/`

## Notes

- `stream-chat` returns raw SSE text to stdout.
- Audio transcription/translation use multipart file upload via `--file`.
- `create-speech` and `get-file-content` write binary to stdout.
