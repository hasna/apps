# CLAUDE.md

connect-vertex-ai is a TypeScript connector for Google Cloud Vertex AI with OAuth2 authentication and multi-profile configuration.

## Commands

```bash
bun install
bun run dev
bun run build
bun run typecheck
bun test src/api/client.test.ts
```

## Authentication

OAuth2 with Google Cloud Platform scope. Credentials in `~/.hasna/connectors/connect-vertex-ai/`.

```bash
connect-vertex-ai auth setup --client-id ID --client-secret SECRET
connect-vertex-ai auth login
```

## API surface

Regional base URL: `https://{location}-aiplatform.googleapis.com/v1`

- Publisher models: `generateContent`, `streamGenerateContent`, `countTokens`, `computeTokens`, `embedContent`, `listModels`, `predict`
- Endpoints: `predict`, `rawPredict`
- `raw-request` for arbitrary paths

## Environment variables

See `.env.example` — placeholders only, no real secrets in repo.
