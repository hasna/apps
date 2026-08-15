import { describe, expect, test } from "bun:test";
import { mkdtemp } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { activeMutationChainCount } from "./storage.base.js";
import { SqliteFeedbackStore, resolveFeedbackMigrationSource } from "./storage.sqlite.js";

/**
 * PATCH-ONLY BY CONSTRUCTION, and stated so the distinction stays visible.
 *
 * These assert internals introduced by this change, so they cannot run against
 * the pre-fix tree and it would be meaningless to try — there is nothing there
 * to assert on. That is fine, and it is a different thing from a REGRESSION
 * test for a defect, which must run on both trees or its pre-fix run proves
 * nothing. The behavioural regression tests live in
 * `storage.sqlite.concurrency.test.ts` and `storage.sqlite.identity.test.ts`,
 * both of which import only API present on both trees. Do not move a
 * behavioural assertion into this file to make an import convenient.
 */
async function tempDir(): Promise<string> {
  return mkdtemp(join(tmpdir(), "open-feedback-internals-"));
}

describe("mutation chain registry", () => {
  test("chains are released once idle", async () => {
    const store = new SqliteFeedbackStore({
      dataDir: await tempDir(),
      eventSink: null,
      taskSink: null,
      notify: false,
    });
    try {
      const item = await store.createFeedback({ appId: "app", message: "x" });
      await store.updateFeedbackStatus(item.id, "triaged");
      // Let the settle callback that clears the entry run.
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(activeMutationChainCount()).toBe(0);
    } finally {
      store.close();
    }
  });
});

describe("resolveFeedbackMigrationSource", () => {
  test("prefers the data dir over the database's own directory", async () => {
    const dataDir = await tempDir();
    const databaseDir = await tempDir();
    expect(resolveFeedbackMigrationSource({ dataDir, databasePath: join(databaseDir, "custom.db") })).toBe(
      join(dataDir, "feedback.jsonl"),
    );
  });
});
