import type { AutomationsStoreOptions } from "../lib/store.js";
import { SqliteServerAutomationsStore } from "./sqlite-store.js";
import type { ServerAutomationsStore } from "./store.js";

export * from "./store.js";
export { SqliteServerAutomationsStore } from "./sqlite-store.js";

type ServerStorageEnvironment = {
  [key: string]: string | undefined;
  HASNA_AUTOMATIONS_DATABASE_URL?: string;
  AUTOMATIONS_DATABASE_URL?: string;
};

export type ServerStorageSelection =
  | { kind: "sqlite" }
  | { kind: "postgresql"; databaseUrl: string };

export function selectServerStorage(
  environment: ServerStorageEnvironment = process.env,
): ServerStorageSelection {
  const databaseUrl = environment.HASNA_AUTOMATIONS_DATABASE_URL || environment.AUTOMATIONS_DATABASE_URL;
  return databaseUrl ? { kind: "postgresql", databaseUrl } : { kind: "sqlite" };
}

export async function openServerAutomationsStoreFromEnv(options: { sqlite?: AutomationsStoreOptions } = {}): Promise<ServerAutomationsStore> {
  const storage = selectServerStorage();
  if (storage.kind === "sqlite") return new SqliteServerAutomationsStore(options.sqlite);
  const { PostgreSqlServerAutomationsStore } = await import("./postgresql/store.js");
  return PostgreSqlServerAutomationsStore.connect(storage.databaseUrl);
}
