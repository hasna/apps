# CLAUDE.md

Voiceflow API connector for the Voiceflow Management API (`https://api.voiceflow.com/v1`).

## Auth

- **Type**: API key (project API key from Settings → API keys)
- **Header**: `Authorization: VF.DM.<key>` — raw key value, **no** `Bearer` prefix
- **Dashboard**: bearer/apikey field `api_key`
- **Env**: `VOICEFLOW_API_KEY`, optional `VOICEFLOW_BASE_URL`

## API surface

| Module | Endpoints |
|--------|-----------|
| projects | `GET /projects`, `POST /projects`, `GET /projects/:id` |
| events | `GET /events` |
| search | `POST /search` |
| raw | arbitrary method + path escape hatch |

Conversations runtime API (`general-runtime.voiceflow.com`) is out of scope for this package.

## Commands

```bash
bun install
bun run dev --help
bun run typecheck
bun test

connect-voiceflow projects list
connect-voiceflow projects get <projectId>
connect-voiceflow projects create --name "My Agent"
connect-voiceflow events list
connect-voiceflow search --query "billing"
connect-voiceflow raw GET /projects
```

## Config

Profiles: `~/.hasna/connectors/connect-voiceflow/profiles/`
