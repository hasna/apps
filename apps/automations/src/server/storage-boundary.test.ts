import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { AutomationsStore } from "../index.js";
import { selectServerStorage } from "./index.js";
import { SqliteServerAutomationsStore } from "./sqlite-store.js";

function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    return entry.isDirectory() ? sourceFiles(path) : entry.name.endsWith(".ts") ? [path] : [];
  });
}

describe("storage loading boundary", () => {
  test("keeps PostgreSQL and its environment switch in server modules", () => {
    const sourceRoot = join(import.meta.dir, "..");
    const serverEnvironmentKeys = ["HASNA_AUTOMATIONS_DATABASE_URL", "AUTOMATIONS_DATABASE_URL"];
    const violations = sourceFiles(sourceRoot).flatMap((path) => {
      const source = readFileSync(path, "utf8");
      const name = relative(sourceRoot, path);
      if (name.startsWith("server/")) return [];
      return source.includes('from "postgres"') || serverEnvironmentKeys.some((key) => source.includes(key)) ? [name] : [];
    });
    expect(violations).toEqual([]);
  });

  test("selects PostgreSQL from the alias with primary-key precedence", () => {
    expect(selectServerStorage({ AUTOMATIONS_DATABASE_URL: "alias-database" })).toEqual({
      kind: "postgresql",
      databaseUrl: "alias-database",
    });
    expect(selectServerStorage({
      HASNA_AUTOMATIONS_DATABASE_URL: "primary-database",
      AUTOMATIONS_DATABASE_URL: "alias-database",
    })).toEqual({
      kind: "postgresql",
      databaseUrl: "primary-database",
    });
    expect(selectServerStorage({})).toEqual({ kind: "sqlite" });
  });

  test("keeps SQLite list pages bounded and keyset-stable", async () => {
    const store = new SqliteServerAutomationsStore({ dbPath: ":memory:" });
    try {
      for (let index = 0; index < 103; index += 1) {
        const id = `sqlite-page-${String(index).padStart(3, "0")}`;
        await store.createAutomation({
          schemaVersion: "1.0",
          id,
          name: id,
          version: "1.0.0",
          triggers: [{ kind: "event", source: "sqlite-page", type: "created" }],
          actions: [{ id: "work", actionId: "actions.work" }],
        });
      }
      const first = await store.listAutomations();
      const second = await store.listAutomations({
        limit: 100,
        after: { createdAt: first.at(-1)!.createdAt, id: first.at(-1)!.id },
      });
      expect(first).toHaveLength(100);
      expect(second).toHaveLength(3);
      expect(new Set([...first, ...second].map(({ id }) => id)).size).toBe(103);
      expect([...first, ...second].map(({ id }) => id)).toEqual(
        (await store.listAutomations({ limit: 1_000 })).map(({ id }) => id),
      );
      await expect(store.listAutomations({ limit: 0 })).rejects.toThrow("positive number");
    } finally {
      await store.close();
    }
  });

  test("root SDK and local store ignore the server database URL", () => {
    const previousPrimary = process.env.HASNA_AUTOMATIONS_DATABASE_URL;
    const previousAlias = process.env.AUTOMATIONS_DATABASE_URL;
    Reflect.set(process.env, "HASNA_AUTOMATIONS_DATABASE_URL", "not-a-database-url");
    Reflect.set(process.env, "AUTOMATIONS_DATABASE_URL", "not-an-alias-database-url");
    const store = new AutomationsStore({ dbPath: ":memory:" });
    try {
      expect(store.path).toBe(":memory:");
      expect(store.status()).toMatchObject({ dbPath: ":memory:", counts: { automations: 0 } });
      const cliSource = readFileSync(join(import.meta.dir, "../cli/index.ts"), "utf8");
      expect(cliSource).toContain('from "../index.js"');
      expect(cliSource).toContain("new AutomationsStore(");
    } finally {
      store.close();
      if (previousPrimary === undefined) delete process.env.HASNA_AUTOMATIONS_DATABASE_URL;
      else process.env.HASNA_AUTOMATIONS_DATABASE_URL = previousPrimary;
      if (previousAlias === undefined) delete process.env.AUTOMATIONS_DATABASE_URL;
      else process.env.AUTOMATIONS_DATABASE_URL = previousAlias;
    }
  });

  test("keeps the legacy SQLite store unreachable and enforces same-runner fences", async () => {
    const store = new SqliteServerAutomationsStore({ dbPath: ":memory:" });
    try {
      expect("store" in store).toBe(false);
      expect(Reflect.ownKeys(store)).not.toContain("store");
      expect((store as unknown as { store?: AutomationsStore }).store).toBeUndefined();
      expect("completeAction" in store).toBe(false);
      expect("failAction" in store).toBe(false);
      expect((store as unknown as { completeAction?: unknown }).completeAction).toBeUndefined();
      expect((store as unknown as { failAction?: unknown }).failAction).toBeUndefined();

      await store.createAutomation({
        schemaVersion: "1.0",
        id: "automation-sqlite-fence",
        name: "SQLite fence",
        version: "1.0.0",
        triggers: [{ kind: "event", source: "storage-boundary", type: "created" }],
        actions: [{ id: "work", actionId: "actions.work" }],
      });
      const run = await store.createRun({
        id: "run-sqlite-fence",
        automationId: "automation-sqlite-fence",
        trigger: { kind: "manual" },
      });
      const action = await store.enqueueAction({
        id: "action-sqlite-fence",
        automationRunId: run.id,
        stepId: "work",
        actionId: "actions.work",
        availableAt: "2026-08-11T00:00:00.000Z",
        invocation: {
          id: "invocation-sqlite-fence",
          actionId: "actions.work",
          manifestVersion: "1.0.0",
          input: {},
          requestedAt: "2026-08-11T00:00:00.000Z",
        },
      });
      const original = await store.claimNextAction({
        runnerId: "same-runner",
        now: "2026-08-11T00:00:00.000Z",
        leaseMs: 1_000,
      });
      const takeover = await store.claimNextAction({
        runnerId: "same-runner",
        now: "2026-08-11T00:00:01.000Z",
        leaseMs: 10_000,
      });

      expect(original?.fenceToken).toBe(1);
      expect(takeover?.fenceToken).toBe(2);
      await expect(store.renewActionLease({
        actionId: action.id,
        runnerId: "same-runner",
        fenceToken: original!.fenceToken,
        now: "2026-08-11T00:00:02.000Z",
      })).rejects.toThrow("stale or expired");
      await expect(store.completeActionFenced({
        actionId: action.id,
        runnerId: "same-runner",
        fenceToken: original!.fenceToken,
        now: "2026-08-11T00:00:02.000Z",
      })).rejects.toThrow("stale or expired");
      await expect(store.failActionFenced({
        actionId: action.id,
        runnerId: "same-runner",
        fenceToken: original!.fenceToken,
        now: "2026-08-11T00:00:02.000Z",
        error: { code: "STALE", message: "stale" },
      })).rejects.toThrow("stale or expired");

      expect((await store.completeActionFenced({
        actionId: action.id,
        runnerId: "same-runner",
        fenceToken: takeover!.fenceToken,
        now: "2026-08-11T00:00:02.000Z",
        result: { summary: "done" },
      })).status).toBe("succeeded");

      const retryAction = await store.enqueueAction({
        id: "action-sqlite-fenced-failure",
        automationRunId: run.id,
        stepId: "retry-work",
        actionId: "actions.retry-work",
        maxAttempts: 2,
        availableAt: "2026-08-11T00:00:03.000Z",
        invocation: {
          id: "invocation-sqlite-fenced-failure",
          actionId: "actions.retry-work",
          manifestVersion: "1.0.0",
          input: {},
          requestedAt: "2026-08-11T00:00:03.000Z",
        },
      });
      const failureClaim = await store.claimNextAction({
        runnerId: "failure-runner",
        now: "2026-08-11T00:00:03.000Z",
        leaseMs: 10_000,
      });
      expect(failureClaim?.id).toBe(retryAction.id);
      expect((await store.renewActionLease({
        actionId: retryAction.id,
        runnerId: "failure-runner",
        fenceToken: failureClaim!.fenceToken,
        now: "2026-08-11T00:00:04.000Z",
        leaseMs: 10_000,
      })).leaseExpiresAt).toBe("2026-08-11T00:00:14.000Z");
      expect((await store.failActionFenced({
        actionId: retryAction.id,
        runnerId: "failure-runner",
        fenceToken: failureClaim!.fenceToken,
        now: "2026-08-11T00:00:05.000Z",
        retryBackoffMs: 0,
        error: { code: "RETRY", message: "retry", retryable: true },
      })).status).toBe("retrying");
      console.log(
        `CONTROL old_fence=${original!.fenceToken} current_fence=${takeover!.fenceToken} public_adapter_bypass=blocked`,
      );
    } finally {
      await store.close();
    }
  });
});
