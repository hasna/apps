import { assertTodosLocalStorageRole } from "./config.js";
import type { TodosStorageAdapter } from "./interfaces.js";
import { resolveTodosPublicRuntimeOwnerModulePath } from "./runtime-module-path.js";

export type CreateLocalSqliteTodosStorageAdapterOptions =
  import("./local-sqlite.js").CreateLocalSqliteTodosStorageAdapterOptions;

export function createLocalSqliteTodosStorageAdapter(
  options: CreateLocalSqliteTodosStorageAdapterOptions = {},
): TodosStorageAdapter {
  assertTodosLocalStorageRole(process.env);
  const ownerPath = resolveTodosPublicRuntimeOwnerModulePath(import.meta.url);
  const owner = require(ownerPath) as typeof import("../stage-a-public-runtime.js");
  return owner.localSqlite.createLocalSqliteTodosStorageAdapter(options);
}
