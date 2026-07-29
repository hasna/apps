import { getDatabase } from "../db/database.js";
import { createLocalSqliteTodosStorageAdapter } from "../storage/local-sqlite.js";
import { createLocalPrGroupLedger } from "../pr-groups/index.js";
import type { V1RequestDependencies } from "./v1.js";

export function createLocalV1Dependencies(): V1RequestDependencies {
  const database = getDatabase();
  const storage = createLocalSqliteTodosStorageAdapter({ db: database });
  const ledger = createLocalPrGroupLedger(database);
  return {
    ensureSchema: async () => {},
    getStorageAdapter: () => storage,
    getPrGroupLedger: () => ledger,
    getVerifier: (() => ({
      authenticate: async () => ({
        ok: true,
        principal: { agent: null, scopes: ["todos:*"] },
      }),
    })) as V1RequestDependencies["getVerifier"],
  };
}
