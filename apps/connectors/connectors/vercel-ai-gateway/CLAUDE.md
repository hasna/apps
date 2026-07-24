# CLAUDE.md

This file provides guidance to Claude Code when working with the Vercel AI Gateway connector.

## Project Overview

`connect-vercel-ai-gateway` is a TypeScript CLI and library for the [Vercel AI Gateway](https://vercel.com/docs/ai-gateway) API. It provides multi-profile configuration, API key authentication, and access to OpenAI-compatible, Anthropic-compatible, and OpenResponses endpoints.

## Build & Run Commands

```bash
bun install
bun run dev
bun run build
bun run typecheck
bun run dev models list
bun run dev chat "Hello" --model openai/gpt-4o
```

## Authentication

- **Type:** API key (Bearer token)
- **Env var:** `VERCEL_AI_GATEWAY_API_KEY`
- **Config dir:** `~/.hasna/connectors/connect-vercel-ai-gateway/`

Anthropic `/v1/messages` requests also send `anthropic-version` and `x-api-key` headers per Vercel AI Gateway docs.

## API Base URLs

| Compatibility | Base URL |
|---------------|----------|
| OpenAI | `https://ai-gateway.vercel.sh/v1` |
| Anthropic | `https://ai-gateway.vercel.sh` |
| OpenResponses | `https://ai-gateway.vercel.sh/openresponses/v1` |

## Key Patterns

- Profiles stored in `~/.hasna/connectors/connect-vercel-ai-gateway/profiles/`
- `--profile` flag overrides active profile for a single command
- Environment variable overrides profile config
