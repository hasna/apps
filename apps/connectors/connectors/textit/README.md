# @hasna/connect-textit

TextIt (RapidPro) API connector for contacts, messages, and flows.

## Authentication

Token authentication via the `Authorization` header (`Token <api_token>`). Create an API token at [textit.com/org/api](https://textit.com/org/api).

## Environment Variables

| Variable | Description |
|----------|-------------|
| `TEXTIT_API_TOKEN` | API token (required) |
| `TEXTIT_BASE_URL` | Optional API base URL override (default `https://textit.com/api/v2`) |
| `TEXTIT_TOKEN_PREFIX` | Optional auth prefix (default `Token`) |

## Library usage

```ts
import { TextIt } from "@hasna/connect-textit";

const textit = TextIt.fromEnv();
// or: new TextIt({ apiToken: "..." })

const contacts = await textit.listContacts({ page_size: 50 });
await textit.sendMessage({ urn: "tel:+15551234567", text: "Hello" });
await textit.startFlow({ flow: "flow-uuid", contacts: ["contact-uuid"] });
```

## CLI

```bash
bun run dev config set-token <token>
bun run dev contacts list
bun run dev messages send --body '{"urn":"tel:+15551234567","text":"Hi"}'
bun run dev flows list
bun run dev flows start --body '{"flow":"uuid","contacts":["uuid"]}'
```

## API surface

| Method | Endpoint |
|--------|----------|
| `listContacts` | `GET /contacts.json` |
| `createContact` | `POST /contacts.json` |
| `listMessages` | `GET /messages.json` |
| `sendMessage` | `POST /messages.json` |
| `listFlows` | `GET /flows.json` |
| `startFlow` | `POST /flow_starts.json` |
| `rawRequest` | arbitrary `.json` resource |

## Development

```bash
bun install
bun run typecheck
bun test
bun run dev --help
```
