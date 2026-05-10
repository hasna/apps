export { TodosClient, createClient } from "./sdk/client.js";
export type { TodosClientOptions } from "./sdk/client.js";
export {
  getRemoteApiConfig,
  isRemoteMode,
  normalizeApiUrl,
  updateConfig,
} from "./lib/config.js";
export type { RemoteApiConfig, TodosMode } from "./lib/config.js";
