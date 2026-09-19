# @hasna/todos-sdk

Universal agent SDK for [@hasna/todos](https://github.com/hasna/todos) task management.

Works with **any AI agent framework** — Claude, Codex, Gemini, or custom agents. Zero dependencies beyond `fetch`.

## Install

```bash
bun add @hasna/todos-sdk
```

## Quick Start

```typescript
import { TodosClient } from "@hasna/todos-sdk";

const client = new TodosClient({
  baseUrl: process.env.HASNA_TODOS_API_URL ?? "https://api.hasna.com/todos",
  apiKey: process.env.HASNA_TODOS_API_KEY,
});

// Register your agent
await client.init({ name: "my-agent", role: "agent" });

// What should I work on?
const queue = await client.myQueue();
const task = queue[0];

// Claim and work on it
await client.startTask(task.id);

// ... do the work ...

// Complete with evidence
await client.completeTask(task.id, {
  files_changed: ["src/fix.ts"],
  test_results: "15 pass, 0 fail",
  commit_hash: "abc123",
});
```

## Configuration

`new TodosClient()` takes its authority and credential from an explicit option
first, then from the environment. **These are the only two tiers this package
has.** It is deliberately dependency-free (it ships to browsers and to non-bun
runtimes), so it does not read the macOS Keychain or
`~/.hasna/todos/config/credentials`. On a workstation, use the `./sdk` export of
[`@hasna/todos`](https://www.npmjs.com/package/@hasna/todos) instead — same
client, full fleet credential chain behind it.

| Setting | Option | Environment variable | Default |
| --- | --- | --- | --- |
| Authority | `baseUrl` | `HASNA_TODOS_API_URL` | `https://api.hasna.com/todos` when a credential resolves |
| Credential | `apiKey` | `HASNA_TODOS_API_KEY` | none; hosted calls fail closed without one |

**A credential means hosted.** When a key resolves and nothing names an
authority, the authority is the fleet gateway — the same answer the
`@hasna/todos` `./sdk` export gives for the identical environment. The two
clients never disagree about where your key is going.

`HASNA_TODOS_API_URL` / `HASNA_TODOS_API_KEY` are the canonical fleet names and
always win. The unprefixed legacy spellings are retired; use the canonical
names.

```bash
export HASNA_TODOS_API_URL=https://api.hasna.com/todos
export HASNA_TODOS_API_KEY=…
```

### Hosted fail-closed and explicit local mode

The supported default is the hosted gateway. Supply a credential explicitly or
through `HASNA_TODOS_API_KEY`; do not treat an absent credential as permission to
read a localhost store. Hosted clients fail closed when authentication is
missing or rejected rather than switching datasets.

Local development remains available only through an explicit selector or by
naming the local server directly:

```bash
export HASNA_TODOS_LOCAL=1
```

```typescript
const local = new TodosClient({ baseUrl: "http://localhost:19427" });
```

Start that server with its own explicit local storage opt-in:

```bash
HASNA_TODOS_LOCAL=1 todos-serve --allow-anonymous
```

Never reuse a hosted fleet credential for the local server. A credential with no
authority selects `https://api.hasna.com/todos`; the client never redirects it to
localhost.

## OpenAI / Anthropic Tool Schemas

```typescript
import { todosTools } from "@hasna/todos-sdk/schemas";

// For OpenAI
const tools = todosTools.map(t => ({ type: "function", function: t }));

// For Anthropic
const tools = todosTools.map(t => ({
  name: t.name,
  description: t.description,
  input_schema: t.parameters,
}));
```

## API

### Agent Identity
- `client.init({ name, role? })` — Register agent (idempotent)
- `client.me()` — Get profile with stats and assigned tasks
- `client.myQueue()` — Get task queue sorted by priority

### Tasks
- `client.listTasks(filters?)` — List with status/project/plan filters; pass `fields` to trim payloads
- `client.getTask(id, { fields })` — Get details with optional field selection
- `client.createTask({ title, ... })` — Create
- `client.startTask(id)` — Claim and start
- `client.completeTask(id, evidence?)` — Complete with optional evidence
- `client.claimTask(filters?)` — Atomically claim next available
- `client.updateTask(id, fields)` — Update
- `client.deleteTask(id)` — Delete
- `client.bulkTasks(ids, action)` — Bulk start/complete/delete

### Projects, Plans, Agents
- `client.listProjects()` / `createProject()` / `deleteProject()`
- `client.listPlans()` / `getPlan()` / `createPlan()` / `updatePlan()` / `deletePlan()`
- `client.listAgents()` / `updateAgent()` / `deleteAgent()`

### Webhooks, Templates, Activity
- `client.listWebhooks()` / `createWebhook()` / `deleteWebhook()`
- `client.listTemplates()` / `createTemplate()` / `deleteTemplate()`
- `client.stats()` — Task statistics
- `client.recentActivity()` — Audit log
- `client.getTaskHistory(id, { limit, format })` — Task change history, compact and limited by default
- `client.subscribeEvents(callback)` — Real-time SSE events

## License

Apache-2.0
