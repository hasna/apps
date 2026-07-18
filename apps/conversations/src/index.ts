/**
 * @hasna/conversations — public library API.
 *
 * Real-time messaging + coordination for AI agents:
 *   conversations send --to claude-code "hello from codex"
 *   conversations read --to codex --json
 *   conversations channel send deployments "v1.2 deployed"
 *
 * The public surface is the Store abstraction plus the shared domain types.
 * EVERY SDK consumer reads and writes conversations DATA through `getStore()`,
 * which returns a `ConversationsStore` bound to on-box SQLite (LocalStore) or the
 * self_hosted/cloud HTTP API (ApiStore) resolved from the client-flip env — the
 * SAME one interface the CLI and MCP use. The raw on-box SQLite domain helpers
 * (sendMessage/readMessages/markRead/…) and the `getDb()` handle are NOT public
 * API: re-exporting them meant SDK callers silently bypassed the Store and always
 * hit local sqlite even after the client was flipped to the cloud. That was the
 * split-brain bug this surface eliminates.
 *
 *   import { getStore } from "@hasna/conversations";
 *   const msg = await getStore().sendMessage({ from, to, content });
 *
 * SAFETY: the ApiStore holds the bearer key only inside its HTTP transport; it is
 * never logged, returned, or embedded in any value produced here.
 */

// Shared domain types (type-only; no runtime surface).
export * from "./types.js";

// The Store abstraction: getStore(), ConversationsStore, LocalStore, the mode
// resolvers (isCloudStore/cloudApiUrl/…) and normalizeChannelName.
export * from "./lib/store/index.js";
export {
  computeIncidentProjectionIds,
  validateIncidentProjection,
  type ValidatedIncidentProjection,
} from "./lib/incident-projection-contract.js";

// Contract-valid project dashboard panel, aggregated through the active Store.
export {
  createConversationsProjectPanel,
  type ConversationsProjectPanelOptions,
} from "./lib/project-panel.js";
