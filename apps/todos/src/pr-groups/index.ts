import type { Database } from "bun:sqlite";
import { getDatabase } from "../db/database.js";
import { PrGroupLedger } from "./ledger.js";
import { SqlitePrGroupLedgerPersistence } from "./sqlite.js";

export * from "./types.js";
export * from "./ledger.js";
export * from "./sqlite.js";
export * from "./http-client.js";
export * from "./postgres.js";

export function createLocalPrGroupLedger(db: Database = getDatabase()): PrGroupLedger {
  return new PrGroupLedger(new SqlitePrGroupLedgerPersistence(db));
}
