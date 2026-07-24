# connect-vertex-ai

TypeScript connector for [Google Cloud Vertex AI](https://cloud.google.com/vertex-ai) REST APIs. Supports Gemini content generation, token counting, embeddings, image prediction, deployed endpoints, and arbitrary regional requests via OAuth2.

## Install

```bash
bun install -g @hasna/connect-vertex-ai
```

## Setup

```bash
connect-vertex-ai auth setup --client-id YOUR_CLIENT_ID --client-secret YOUR_CLIENT_SECRET
connect-vertex-ai auth login
connect-vertex-ai config set-project YOUR_GCP_PROJECT_ID
connect-vertex-ai config set-location us-central1
```

## Commands

```bash
connect-vertex-ai generate-content --model gemini-2.5-pro --text "Hello"
connect-vertex-ai stream-generate-content --model gemini-2.5-pro --text "Hello"
connect-vertex-ai count-tokens --model gemini-2.5-pro --text "Hello"
connect-vertex-ai compute-tokens --model gemini-2.5-pro --text "Hello"
connect-vertex-ai embed-content --model text-embedding-005 --text "hello"
connect-vertex-ai list-models
connect-vertex-ai predict-image --prompt "a red cube"
connect-vertex-ai endpoint-predict --endpoint ENDPOINT_ID --instances '[{"text":"hi"}]'
connect-vertex-ai endpoint-raw-predict --endpoint ENDPOINT_ID --body '{"instances":[{"text":"hi"}]}'
connect-vertex-ai raw-request --path /projects/PROJECT/locations/us-central1/publishers/google/models
```

## Environment variables

| Variable | Description |
|----------|-------------|
| `VERTEX_AI_CLIENT_ID` | OAuth client ID |
| `VERTEX_AI_CLIENT_SECRET` | OAuth client secret |
| `VERTEX_AI_PROJECT_ID` | Default GCP project |
| `VERTEX_AI_LOCATION` | Default region (default `us-central1`) |
| `VERTEX_AI_ACCESS_TOKEN` | Override access token |
| `VERTEX_AI_REFRESH_TOKEN` | Override refresh token |

## Library

```typescript
import { VertexAI } from '@hasna/connect-vertex-ai';

const api = await VertexAI.ensureAuthenticated();
const models = await api.client.listModels({ projectId: 'my-project' });
```
