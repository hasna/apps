# Library and SDK APIs

This package ships two TypeScript surfaces (one npm package, `@hasna/mementos`,
carries every surface — there is no separate `-sdk` package):

| Import | Runtime style | Intended use |
| --- | --- | --- |
| `@hasna/mementos` | Synchronous Bun domain/database API | Embedded local or server-side use |
| `@hasna/mementos/sdk` | Zero-dependency async fetch client bundled with the main package | Authenticated `/v1` REST clients |

## Direct library: `@hasna/mementos`

The main export is built from `src/index.ts` and requires Bun because local
storage uses `bun:sqlite`.

```ts
import {
  createMemory,
  getMemoryByKey,
  listMemories,
  searchMemories,
  closeDatabase,
} from "@hasna/mementos";

const saved = createMemory({
  key: "project-stack",
  value: "Bun + TypeScript + SQLite",
  category: "fact",
  scope: "shared",
  importance: 8,
});

const recalled = getMemoryByKey(saved.key, "shared");
const results = searchMemories("TypeScript", { scope: "shared" });
closeDatabase();
```

### Export groups

- Types and errors: memories, filters, agents, projects, entities, relations,
  tasks, sync inputs, optimistic-version and not-found errors.
- Database lifecycle: `getDatabase`, `closeDatabase`, `resetDatabase`,
  `getDbPath`, ID resolution, UUID/time helpers.
- Memory CRUD/history: create/get/list/update/delete, bulk delete, touch,
  expiry cleanup, version history, recall counts.
- Agents, projects, machines, focus, resource locks, and memory write locks.
- Search and prompt injection (`searchMemories`, `MemoryInjector`).
- Retention, legacy agent sync, and compatibility storage sync.
- Knowledge graph entities, relations, entity-memory links, paths, and graph
  queries.
- Auto-memory providers, deduplication, consolidation, reflection, and training
  data gathering.
- Tasks, comments, and the task-runner registration API.
- Secret redaction and project-panel contract formatting.

The complete export list is the named export block in `src/index.ts`. Functions
which accept an optional database adapter/path can be isolated with an explicit
SQLite store. In client API mode, code paths without an HTTP implementation fail
closed instead of opening a split-brain local database. Use the fetch client for
a general remote application.

### Storage subpath

`@hasna/mementos/storage` exposes adapters and storage diagnostics, including
`SqliteAdapter`, `PgAdapter`, `PgAdapterAsync`, status/config resolution, and
legacy incremental sync helpers.

Direct PostgreSQL runtime access is server-only. `getStorageConnectionString()`
throws outside a `mementos-serve` server context; ordinary remote consumers use
the REST SDK.

## Bundled REST client: `@hasna/mementos/sdk`

```ts
import { MementosClient, MementosError } from "@hasna/mementos/sdk";

const client = new MementosClient({
  baseUrl: "https://mementos.example.com",
  apiKey: process.env.MEMENTOS_API_KEY,
  // prefix defaults to "/v1"; use "/api" only for a legacy deployment
});

try {
  await client.saveMemory({
    key: "release-process",
    value: "Run typecheck, tests, then build",
    category: "procedural",
    scope: "shared",
  });
} catch (error) {
  if (error instanceof MementosError) {
    console.error(error.status, error.message, error.details);
  }
}
```

Constructor options are `baseUrl`, a custom `fetch`, `apiKey`, and `prefix`.
When an API key is supplied it is sent as both `Authorization: Bearer` and
`x-api-key`.

`MementosClient.fromEnv()` performs NO env reading of its own: the credential
and the authority come from the one resolver in `@hasna/contracts/client`
(`HASNA_MEMENTOS_API_KEY` and its legacy alias, the macOS Keychain item
`hasna.credentials.mementos.api-key`, or `~/.hasna/mementos/config/credentials`),
resolved fresh on EVERY request. A credential alone resolves to the fleet
gateway `https://api.hasna.com/mementos`. With nothing configured the client
FAILS CLOSED: every request (and the `apiUrl` getter) throws
`MementosConfigError` (`code: "MEMENTOS_STORE_CONFIG"`) naming the tiers it
consulted, before any request is sent — it never falls back to the unhosted
`http://localhost:19428`. The on-box `mementos-serve` is reachable only through
the deliberate opt-in `HASNA_MEMENTOS_LOCAL=1` (or an explicit
`HASNA_MEMENTOS_DB_PATH`) with nothing else configured, and then the client
says so once on stderr. An explicit `baseUrl` is tier 1 and is used verbatim —
without an explicit `apiKey` it never attaches an ambient fleet key. The legacy
`MEMENTOS_URL` spelling is retired.

### Bundled client methods

| Area | Methods |
| --- | --- |
| Memories and service | `listMemories`, `getStats`, `getHealth`, `getReady`, `getVersion`, `getReport`, `getStaleMemories`, `getActivity`, `searchMemories`, `exportMemories`, `importMemories`, `cleanExpired`, `extractFromSession`, `saveMemory`, `getMemory`, `getMemoryVersions`, `updateMemory`, `deleteMemory` |
| Agents and projects | `listAgents`, `registerAgent`, `getAgent`, `updateAgent`, `listAgentsByProject`, `listProjects`, `registerProject`, `getProject`, `getProjectAgents` |
| Knowledge graph | `listEntities`, `createEntity`, `mergeEntities`, `getEntity`, `updateEntity`, `deleteEntity`, `getEntityMemories`, `linkEntityMemory`, `unlinkEntityMemory`, `getEntityRelations`, `createRelation`, `getRelation`, `deleteRelation`, `getGraph`, `findPath`, `getGraphStats` |
| Locks | `acquireLock`, `checkLock`, `releaseLock`, `listAgentLocks`, `releaseAllAgentLocks`, `cleanExpiredLocks` |
| Tasks | `createTask`, `listTasks`, `getTaskStats`, `getTask`, `updateTask`, `deleteTask`, `listTaskComments`, `addTaskComment`, `deleteTaskComment` |
| Context and extraction | `getContext`, `processConversationTurn`, `getAutoMemoryStatus`, `configureAutoMemory`, `testExtraction` |
| Hooks | `listHooks`, `getHookStats`, `listWebhooks`, `createWebhook`, `getWebhook`, `updateWebhook`, `deleteWebhook`, `enableWebhook`, `disableWebhook` |
| Synthesis | `runSynthesis`, `listSynthesisRuns`, `getSynthesisStatus`, `rollbackSynthesis` |
| Session jobs | `ingestSession`, `getSessionJob`, `listSessionJobs`, `getSessionQueueStats` |

The bundled client currently does not expose `consolidateMemories` or `reflect`
convenience methods even though those REST endpoints exist. Call the endpoints
directly (`POST /v1/consolidate`, `POST /v1/reflect`) with the same headers the
client sends.

The former standalone `sdk/` directory (`@hasna/mementos-sdk`, never published)
was removed with the hasna/apps#1720 validation: it bypassed the credential
chain and violated the one-package-per-app rule. Import `@hasna/mementos/sdk`.
