# @hasna/todos-sdk

Universal agent SDK for [@hasna/todos](https://github.com/hasna/open-todos) task management.

Works with **any AI agent framework** — Claude, Codex, Gemini, or custom agents. Zero dependencies beyond `fetch`.

## Install

```bash
bun add @hasna/todos-sdk
# or
npm install @hasna/todos-sdk
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
- `client.listTasks(filters?)` — List with status/project/plan filters
- `client.getTask(id)` — Get details
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
- `client.stats()` — Dashboard statistics
- `client.recentActivity()` — Audit log
- `client.getTaskHistory(id)` — Task change history
- `client.subscribeEvents(callback)` — Real-time SSE events

## License

Apache-2.0
