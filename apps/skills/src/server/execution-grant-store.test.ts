import { useDefaultTestTimeout } from "../test-preload.js";
import { expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SqliteSkillsStore } from "./sqlite-store.js";
import { publicPrincipal } from "./auth.js";

useDefaultTestTimeout();

test("SQLite grant history survives reopen and a failed history append rolls back the current policy", async () => {
  const root = mkdtempSync(join(tmpdir(), "skills-grant-durability-")),
    path = join(root, "store.sqlite");
  const principal = publicPrincipal();
  let store = new SqliteSkillsStore(path);
  try {
    await store.ensureBootstrapApiKey(crypto.randomUUID(), principal);
    const initial = await store.executionGrantStore.save(
      principal,
      "reviewed",
      [],
      null
    );
    const updated = await store.executionGrantStore.save(
      principal,
      "reviewed",
      [],
      initial!.revision
    );
    await store.close();
    store = new SqliteSkillsStore(path);
    expect(await store.executionGrantStore.get(principal, "reviewed")).toEqual(
      updated
    );
    expect(
      await store.executionGrantStore.get(
        principal,
        "reviewed",
        initial!.revision
      )
    ).toEqual(initial);
    const connection = new Database(path);
    try {
      connection.exec(
        "CREATE TRIGGER fixture_refuse_history BEFORE INSERT ON skills_execution_grant_revisions BEGIN SELECT RAISE(ABORT, 'fixture history unavailable'); END;"
      );
    } finally {
      connection.close();
    }
    await expect(
      store.executionGrantStore.save(
        principal,
        "reviewed",
        [],
        updated!.revision
      )
    ).rejects.toThrow("fixture history unavailable");
    expect(await store.executionGrantStore.get(principal, "reviewed")).toEqual(
      updated
    );
    expect(
      await store.executionGrantStore.get(
        { ...principal, orgId: "other-org" },
        "reviewed",
        initial!.revision
      )
    ).toBeNull();
  } finally {
    await store.close();
    rmSync(root, { recursive: true, force: true });
  }
});
