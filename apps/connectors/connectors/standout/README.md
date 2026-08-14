# @hasna/connect-standout

TypeScript connector for the [Standout](https://www.ycombinator.com/companies/standout) hiring-assessment API.

## Install

```bash
bun install
```

## Configuration

Set your API key via environment variable or CLI profile:

```bash
export STANDOUT_API_KEY=your-api-key
# or
bun run dev config set-key your-api-key
```

Optional base URL override:

```bash
export STANDOUT_BASE_URL=https://api.standout.ai/v1
```

## CLI Usage

```bash
bun run dev candidates list
bun run dev candidates get <candidateId>
bun run dev roles list
bun run dev assessments list
bun run dev assessments create --body '{"candidateId":"c1","roleId":"r1"}'
bun run dev raw /candidates -X GET
```

## Library Usage

```typescript
import { Standout } from '@hasna/connect-standout';

const client = Standout.fromEnv();
const candidates = await client.listCandidates();
```

## API

- `listCandidates(query?)` — GET `/candidates`
- `getCandidate(candidateId)` — GET `/candidates/:id`
- `listRoles(query?)` — GET `/roles`
- `createAssessment(body)` — POST `/assessments`
- `listAssessments(query?)` — GET `/assessments`
- `rawRequest({ method, path, query?, body? })` — passthrough

## License

Apache-2.0
