# AGENTS.md

Google Cloud Vertex AI connector (`connect-vertex-ai`). OAuth2 + regional REST client for Gemini, embeddings, prediction, and endpoints.

## Build

```bash
bun install && bun run typecheck && bun test src/api/client.test.ts
```

## Patterns

- Follow `connectors/gmail` for OAuth profile storage
- API client in `src/api/client.ts` with retry on 429/5xx
- No browser-use dependency; HTTP only
