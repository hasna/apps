/** Dependency-light alternate source entrypoint. */
export * from "../storage.js";
export { inspectTodosStorageConfig } from "./config.js";
export {
  DEFAULT_TODOS_POSTGRES_CURSOR_TABLE,
  DEFAULT_TODOS_POSTGRES_SYNC_TABLE,
  PostgresTodosSyncStore,
  SHADOW_TRIGGER_TABLES,
  assertRuntimeShadowRemoteAccessDisabled,
} from "./stage-a-public-stubs.js";
