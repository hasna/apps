/**
 * Server backend selection — configuration-driven, never a mode enum.
 *
 * The data backend is the only runtime switch (canonical @hasna/* doctrine):
 * SQLite by default (zero-config on-box), PostgreSQL when
 * HASNA_MESSAGES_DATABASE_URL is set. The client (CLI / MCP / SDK) talks to
 * the server's HTTP API or a local store — it never opens Postgres directly.
 */
import type { MessagesStore } from "../service";
import { SqliteMessagesStore } from "./sqlite-store";
import { PostgresMessagesStore } from "./postgres-store";

export interface ResolvedStore {
  store: MessagesStore;
  backend: "sqlite" | "postgresql";
  close(): Promise<void>;
}

export async function resolveStore(): Promise<ResolvedStore> {
  const databaseUrl = process.env.HASNA_MESSAGES_DATABASE_URL;
  if (databaseUrl && databaseUrl.length > 0) {
    const store = new PostgresMessagesStore(databaseUrl);
    await store.init();
    return {
      store,
      backend: "postgresql",
      close: () => store.close(),
    };
  }
  const store = new SqliteMessagesStore();
  return {
    store,
    backend: "sqlite",
    close: () => Promise.resolve(store.close()),
  };
}
