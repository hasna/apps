export type {
  McpServerEntry,
  AddServerOptions,
  McpTool,
  RegistryServer,
  ConnectedServer,
  FinderResult,
} from "./types.js";

export {
  addServer,
  removeServer,
  listServers,
  getServer,
  updateServer,
  enableServer,
  disableServer,
  getToolCounts,
  setServerEnv,
  unsetServerEnv,
} from "./lib/registry.js";

export { diagnoseServer } from "./lib/doctor.js";
export type { DoctorReport, DoctorCheck } from "./lib/doctor.js";

export { searchRegistry, getRegistryServer, installFromRegistry } from "./lib/remote.js";
export { findServers, listAwesomeServers } from "./lib/finder.js";
export type { FindOptions } from "./lib/finder.js";

export {
  listSources,
  getSource,
  addSource,
  removeSource,
  enableSource,
  disableSource,
} from "./lib/sources.js";
export { installToAgents } from "./lib/install.js";
export type { AgentTarget, InstallResult } from "./lib/install.js";
export type { McpSource, AddSourceOptions } from "./types.js";

export {
  connectToServer,
  disconnectServer,
  listAllTools,
  callTool,
  refreshTools,
  disconnectAll,
} from "./lib/proxy.js";

export { getDb, closeDb } from "./lib/db.js";
