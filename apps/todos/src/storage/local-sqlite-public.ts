import { assertTodosLocalStorageRole } from "./config.js";
import type { TodosStorageAdapter } from "./interfaces.js";
import { resolveTodosStorageRuntimeModulePath } from "./runtime-module-path.js";

export type CreateLocalSqliteTodosStorageAdapterOptions =
  import("./local-sqlite.js").CreateLocalSqliteTodosStorageAdapterOptions;

export function createLocalSqliteTodosStorageAdapter(
  options: CreateLocalSqliteTodosStorageAdapterOptions = {},
): TodosStorageAdapter {
  assertTodosLocalStorageRole(process.env);
  const runtimePath = resolveTodosStorageRuntimeModulePath(import.meta.url, "local-sqlite");
  const runtime = require(runtimePath) as typeof import("./local-sqlite.js");
  return runtime.createLocalSqliteTodosStorageAdapter(options);
}
