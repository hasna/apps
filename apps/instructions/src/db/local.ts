/**
 * THE ONE ENTRY TO THE ON-BOX SQLITE STORE.
 *
 * Every `bun:sqlite` module in this package hangs off this barrel, and the
 * barrel has exactly ONE importer: the gated dynamic `import()` inside
 * `LocalConfigStore` (../data/config-store.ts). Nothing in the CLI or the MCP
 * server graph reaches it statically.
 *
 * WHY A BARREL AND NOT A DIRECT IMPORT (fail-closed residue ruling, W12
 * 2026-09-11). `src/data/config-store.ts` used to import `../db/configs.js`,
 * `../db/profiles.js`, `../db/snapshots.js`, `../db/machines.js` and
 * `../db/database.js` at the top level. Those are value imports, so the
 * bundler had to pull `bun:sqlite` — and with it the whole local store,
 * migrations included — into `dist/cli/index.js` and `dist/mcp/index.js`,
 * even though a hosted run never executes a line of it. A bundle that carries
 * the local store is one `getDatabase()` call away from silently serving a
 * different dataset, and the residue is exactly what the station audit counts.
 *
 * Behind a dynamic import the bundler emits the SQLite half as a separate
 * chunk (`dist/chunks/*.js`, see the `--splitting --chunk-naming` flags on the
 * cli/mcp build steps in package.json), loaded only when a local-mode run
 * actually touches the store. The CLI and MCP bundles then contain zero
 * `bun:sqlite` references, which is the measurable acceptance bar.
 *
 * The routing gate itself lives one level up in `resolveConfigStore()`
 * (`selectsInstructionsLocalStore()` — the opt-in `HASNA_INSTRUCTIONS_LOCAL=1`
 * answered from the env dictionary alone, before any Keychain or disk read),
 * and `getDatabase()` keeps its own belt-and-braces refusal for a process
 * whose environment configures a hosted authority. This module adds no policy;
 * it only makes the local store lazily reachable through a single seam.
 */
export {
  createConfig,
  deleteConfig,
  getConfig,
  getConfigById,
  getConfigStats,
  listConfigs,
  updateConfig,
} from "./configs.js";
export {
  addConfigToProfile,
  createProfile,
  deleteProfile,
  getProfile,
  getProfileConfigsPage,
  getProfileConfigBindings,
  listProfilesPage,
  removeConfigFromProfile,
  resolveProfileForMachineRead,
  setProfileConfigBinding,
  updateProfile,
  addAssetToProfile,
  getProfileAssetBindings,
  removeAssetFromProfile,
  setProfileAssetBinding,
} from "./profiles.js";
export {
  createSnapshot,
  getSnapshot,
  getSnapshotByVersion,
  listSnapshots,
  pruneSnapshots,
} from "./snapshots.js";
export { listMachines, registerMachine, updateMachineApplied } from "./machines.js";
export { insertFeedback, resetLocalDatabase } from "./database.js";
export type { FeedbackInput } from "./database.js";
