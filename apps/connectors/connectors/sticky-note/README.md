# StickyNote Connector

TypeScript connector for the [StickyNote](https://www.ycombinator.com/companies/sticky-note) API. Provides CLI and library access for notes, events, search, and raw API passthrough.

## Authentication

Bearer token authentication. Set your API key via profile config or environment variable:

```bash
export STICKY_NOTE_API_KEY=your-api-key-here
# optional override
export STICKY_NOTE_BASE_URL=https://api.sticky-note.com/v1
```

## CLI

```bash
bun install
bun run dev config set-key <api-key>
bun run dev list-notes
bun run dev create-note --title "Hello" --content "World"
bun run dev get-note <noteId>
bun run dev list-events
bun run dev search --query "workflow"
bun run dev raw-request --path /notes --method GET
```

## Library

```typescript
import { StickyNote } from '@hasna/connect-sticky-note';

const client = new StickyNote({ apiKey: process.env.STICKY_NOTE_API_KEY! });
const notes = await client.listNotes();
```

## API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/notes` | List notes |
| POST | `/notes` | Create a note |
| GET | `/notes/:noteId` | Get a note |
| GET | `/events` | List events |
| POST | `/search` | Search |
| * | custom | Raw request passthrough |

## Development

```bash
bun run typecheck
bun test src/api/client.test.ts
bun run build
```

## License

Apache-2.0
