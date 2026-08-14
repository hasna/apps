# Stagehand Connector

TypeScript connector for the official [Stagehand](https://docs.stagehand.dev/) v3 session REST API on Browserbase.

## Installation

```bash
bun install
bun run build
```

## Authentication

Stagehand v3 uses Browserbase and model-provider credentials. This connector sends:

- `x-bb-api-key` from `BROWSERBASE_API_KEY`
- `x-model-api-key` from `MODEL_API_KEY`
- optional `x-bb-project-id` from `BROWSERBASE_PROJECT_ID` for accounts that still require it

```bash
export BROWSERBASE_API_KEY=your_browserbase_api_key_here
export MODEL_API_KEY=your_model_provider_api_key_here

connect-stagehand config set-browserbase-key your_browserbase_api_key_here
connect-stagehand config set-model-key your_model_provider_api_key_here
```

Optional base URL override (defaults to `https://api.stagehand.browserbase.com`):

```bash
export STAGEHAND_BASE_URL=https://api.stagehand.browserbase.com
connect-stagehand config set-base-url https://api.stagehand.browserbase.com
```

## CLI Usage

```bash
# Start a session
connect-stagehand sessions start --model openai/gpt-5.4-mini

# Drive the session
connect-stagehand sessions navigate <sessionId> https://example.com
connect-stagehand sessions act <sessionId> "Click the login button"
connect-stagehand sessions observe <sessionId> "Find navigation links"
connect-stagehand sessions extract <sessionId> "Extract the page title" --schema '{"type":"object"}'
connect-stagehand sessions agent <sessionId> "Summarize this page" --model openai/gpt-5.4-mini

# Replay metrics and cleanup
connect-stagehand sessions replay <sessionId>
connect-stagehand sessions end <sessionId>

# Raw request
connect-stagehand raw request -p /v1/sessions/start -m POST -b '{"modelName":"openai/gpt-5.4-mini"}'
```

## Library Usage

```typescript
import { Stagehand } from '@hasna/connect-stagehand';

const api = Stagehand.fromEnv();
const session = await api.startSession({ modelName: 'openai/gpt-5.4-mini' });

await api.navigate(session.data.sessionId, { url: 'https://example.com' });
await api.act(session.data.sessionId, { input: 'Click the login button' });
await api.endSession(session.data.sessionId);
```

## API Surface

- `startSession` - POST `/v1/sessions/start`
- `navigate` - POST `/v1/sessions/{id}/navigate`
- `act` - POST `/v1/sessions/{id}/act`
- `observe` - POST `/v1/sessions/{id}/observe`
- `extract` - POST `/v1/sessions/{id}/extract`
- `agentExecute` - POST `/v1/sessions/{id}/agentExecute`
- `replay` - GET `/v1/sessions/{id}/replay`
- `endSession` - POST `/v1/sessions/{id}/end`
- `rawRequest` - arbitrary path/method escape hatch

## Development

```bash
bun run dev --help
bun run typecheck
bun test
```

## License

Apache-2.0
