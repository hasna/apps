export { TodosClient, TodosError } from "./client.js";
// The env names this client reads and the two authorities it can select are
// part of the surface, not internals: a consumer wiring the canonical fleet
// pair should be able to assert the names rather than retype them, and the
// notice reset is the seam a test needs to observe local mode more than once
// in a process.
export {
  TODOS_API_URL_ENV_KEYS,
  TODOS_API_KEY_ENV_KEYS,
  TODOS_LOCAL_SERVE_URL,
  TODOS_DEFAULT_FLEET_URL,
  __resetTodosLocalModeNotice,
} from "./client.js";
export { todosTools } from "./schemas.js";
export type { TodosToolName } from "./schemas.js";
export type {
  Task, Project, Plan, Agent, TaskHistory, Webhook, TaskTemplate,
  Stats, BulkResult, AgentProfile, ClaimResult, CompletionEvidence,
  TodosClientOptions,
} from "./types.js";
