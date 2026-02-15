export type {
  McpServerEntry,
  AddServerOptions,
  McpTool,
  RegistryServer,
  ConnectedServer,
} from "./types.js";

export {
  addServer,
  removeServer,
  listServers,
  getServer,
  updateServer,
  enableServer,
  disableServer,
} from "./lib/registry.js";

export { searchRegistry, getRegistryServer, installFromRegistry } from "./lib/remote.js";

export {
  connectToServer,
  disconnectServer,
  listAllTools,
  callTool,
  refreshTools,
  disconnectAll,
} from "./lib/proxy.js";

export { getDb, closeDb } from "./lib/db.js";
