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

const client = new TodosClient({ baseUrl: "http://localhost:19427" });

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

| Setting | Option | Environment variable, in precedence order |
| --- | --- | --- |
| Authority | `baseUrl` | `HASNA_TODOS_API_URL`, then `TODOS_API_URL`, then `TODOS_URL` |
| Credential | `apiKey` | `HASNA_TODOS_API_KEY`, then `TODOS_API_KEY` |

`HASNA_TODOS_API_URL` / `HASNA_TODOS_API_KEY` are the canonical fleet names and
always win. `TODOS_API_URL`, `TODOS_URL` and `TODOS_API_KEY` are this package's
legacy spellings, still accepted as a **silent fallback for one release** and
scheduled for removal — move to the canonical names now.

```bash
export HASNA_TODOS_API_URL=https://api.hasna.com/todos
export HASNA_TODOS_API_KEY=…
```

### Local mode

When **neither** an authority **nor** a credential is configured, the client
targets a `todos-serve` running on this machine at `http://localhost:19427` and
sends no credential. That is a supported mode, not a fallback from failure — and
because a client quietly reading an empty local store while you believe you are
on the fleet is the worst outcome of all, it prints one line to stderr saying so:

```
todos-sdk: LOCAL mode — no HASNA_TODOS_API_URL and no HASNA_TODOS_API_KEY resolved; reading and
writing the local todos-serve at http://localhost:19427, not the hosted fleet. …
```

Setting either one turns the notice off and uses what you set.

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
