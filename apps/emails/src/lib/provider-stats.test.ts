import { afterEach, it } from "bun:test";
import { getDatabase, resetDatabase, closeDatabase } from "../db/database.js";
import { createSqliteEmailStore } from "../store-sqlite/index.js";
import { createHttpEmailStore } from "../store-http/index.js";
import { startV1StoreApi, type V1StoreApi } from "../test-support/v1-store-api.js";
import { checkProviderStatistics } from "../test-support/provider-stats-check.js";
let api: V1StoreApi | undefined;
afterEach(() => { api?.stop(); api = undefined; closeDatabase(); });
it("preserves provider provenance and scopes every statistic over HTTP", async () => {
  const previous = process.env.EMAILS_DB_PATH;
  process.env.EMAILS_DB_PATH = ":memory:";
  process.env["HASNA_EMAILS_LOCAL"] = "1";
  try {
    resetDatabase();
    const backing = createSqliteEmailStore({ database: getDatabase(), detail: "provider statistics fixture" });
    api = await startV1StoreApi({ store: backing });
    const store = createHttpEmailStore({ baseUrl: api.baseUrl, credential: api.apiKey });
    await checkProviderStatistics(store);
  } finally {
    if (previous === undefined) delete process.env.EMAILS_DB_PATH;
    else process.env.EMAILS_DB_PATH = previous;
  }
});
