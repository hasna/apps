import { afterEach, describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  deleteProjectDataModelsExact as publicDeleteProjectDataModelsExact,
  deleteProjectDataRecordsExact as publicDeleteProjectDataRecordsExact,
  withProjectDataTransaction as publicWithProjectDataTransaction,
} from "../project-store.js";
import {
  deleteProjectDataModelsExact as rootDeleteProjectDataModelsExact,
  deleteProjectDataRecordsExact as rootDeleteProjectDataRecordsExact,
  withProjectDataTransaction as rootWithProjectDataTransaction,
} from "../index.js";
import {
  PROJECTS_HOME_ENV,
  createProjectDataModel,
  createProjectDataRecord,
  deleteProjectDataModelsExact,
  deleteProjectDataRecordsExact,
  ensureProjectStore,
  getProjectDataModel,
  getProjectDataRecord,
  getProjectDatabase,
  getProjectStorePaths,
  inspectProjectStoreWithLoops,
  linkProjectLoop,
  listProjectDataModels,
  listProjectDataRecords,
  listProjectLoopSummaries,
  withProjectDataTransaction,
  type LoopsClientLike,
  type ProjectStoreProject,
} from "./project-store.js";

describe("project store", () => {
  afterEach(() => {
    delete process.env[PROJECTS_HOME_ENV];
  });

  test("stores project-specific app data under data/<workspace_id>/project.db", () => {
    const root = mkdtempSync(join(tmpdir(), "project-store-"));
    process.env[PROJECTS_HOME_ENV] = root;
    const project: ProjectStoreProject = {
      id: "wks_storetest",
      name: "Store Test",
      slug: "store-test",
      status: "active",
      kind: "project",
      primary_path: "/tmp/store-test",
    };

    try {
      const summary = ensureProjectStore(project);
      const paths = getProjectStorePaths(project);
      expect(summary.paths.db_path).toBe(join(root, "data", project.id, "project.db"));
      expect(existsSync(paths.db_path)).toBe(true);

      const model = createProjectDataModel(project, {
        name: "Dataset",
        schema: { type: "object", properties: { title: { type: "string" } } },
      });
      const record = createProjectDataRecord(project, {
        model_id: model.id,
        key: "alpha",
        title: "Alpha",
        data: { title: "Alpha" },
      });
      expect(listProjectDataRecords(project, model.id)).toEqual([record]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("rejects path traversal project ids for project store paths", () => {
    const root = mkdtempSync(join(tmpdir(), "project-store-paths-"));
    process.env[PROJECTS_HOME_ENV] = root;

    try {
      expect(() => getProjectStorePaths(".")).toThrow("Invalid project id");
      expect(() => getProjectStorePaths("..")).toThrow("Invalid project id");
      expect(() => getProjectStorePaths("../escape")).toThrow("Invalid project id");
      expect(getProjectStorePaths("wks_safe").project_dir).toBe(join(root, "data", "wks_safe"));
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("links OpenLoops records and summarizes them through an SDK-like client", async () => {
    const root = mkdtempSync(join(tmpdir(), "project-store-loops-"));
    process.env[PROJECTS_HOME_ENV] = root;
    const project: ProjectStoreProject = {
      id: "wks_looptest",
      name: "Loop Test",
      slug: "loop-test",
      status: "active",
      kind: "project",
      primary_path: null,
    };
    const fakeClient: LoopsClientLike = {
      get(idOrName) {
        if (idOrName !== "loop_123") throw new Error("missing");
        return {
          id: "loop_123",
          name: "Daily Check",
          status: "active",
          schedule: { type: "interval", everyMs: 86_400_000 },
          target: { type: "command" },
          nextRunAt: "2026-06-27T00:00:00.000Z",
          updatedAt: "2026-06-26T00:00:00.000Z",
        };
      },
      runs(loopId) {
        expect(loopId).toBe("loop_123");
        return [{
          id: "run_123",
          scheduledFor: "2026-06-26T00:00:00.000Z",
          attempt: 1,
          status: "succeeded",
          finishedAt: "2026-06-26T00:00:01.000Z",
          durationMs: 1000,
        }];
      },
    };

    try {
      const link = linkProjectLoop(project, { loop_id: "loop_123", loop_name: "Daily Check", role: "maintenance" });
      expect(link.role).toBe("maintenance");

      const loops = await listProjectLoopSummaries(project, { loopsClient: fakeClient, includeRuns: true });
      expect(loops[0]?.status).toBe("linked");
      expect(loops[0]?.loop?.name).toBe("Daily Check");
      expect(loops[0]?.runs[0]?.status).toBe("succeeded");

      const summary = await inspectProjectStoreWithLoops(project, { loopsClient: fakeClient, includeRuns: true });
      expect(summary.counts.loop_links).toBe(1);
      expect(summary.loops?.[0]?.link.loop_id).toBe("loop_123");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("exports exact project-data transaction and delete APIs through both public surfaces", () => {
    expect(publicWithProjectDataTransaction).toBe(withProjectDataTransaction);
    expect(publicDeleteProjectDataRecordsExact).toBe(deleteProjectDataRecordsExact);
    expect(publicDeleteProjectDataModelsExact).toBe(deleteProjectDataModelsExact);
    expect(rootWithProjectDataTransaction).toBe(withProjectDataTransaction);
    expect(rootDeleteProjectDataRecordsExact).toBe(deleteProjectDataRecordsExact);
    expect(rootDeleteProjectDataModelsExact).toBe(deleteProjectDataModelsExact);
  });

  test("atomically validates, deletes exact records before empty models, and preserves other projects", () => {
    const root = mkdtempSync(join(tmpdir(), "project-store-delete-"));
    process.env[PROJECTS_HOME_ENV] = root;
    const project = projectFixture("wks_atomicdelete", "Atomic Delete");
    const otherProject = projectFixture("wks_atomicother", "Atomic Other");
    const db = getProjectDatabase(project);

    try {
      const targetModel = createProjectDataModel(project, { name: "Rollback Target" }, db);
      const survivorModel = createProjectDataModel(project, { name: "Survivor" }, db);
      const targetRecordA = createProjectDataRecord(project, {
        model_id: targetModel.id,
        key: "target-a",
      }, db);
      const targetRecordB = createProjectDataRecord(project, {
        model_id: targetModel.id,
        key: "target-b",
      }, db);
      const survivorRecord = createProjectDataRecord(project, {
        model_id: survivorModel.id,
        key: "survivor",
      }, db);
      const otherModel = createProjectDataModel(otherProject, { name: "Other Project" });
      const otherRecord = createProjectDataRecord(otherProject, {
        model_id: otherModel.id,
        key: "other",
      });

      const result = withProjectDataTransaction(project, db, (transactionDb) => {
        expect(transactionDb).toBe(db);
        expect(listProjectDataRecords(project, targetModel.id, transactionDb)).toHaveLength(2);

        const records = deleteProjectDataRecordsExact(project, transactionDb, {
          targets: [
            { id: targetRecordA.id, model_id: targetModel.id },
            { id: targetRecordB.id, model_id: targetModel.id },
          ],
          expected_count: 2,
        });
        expect(listProjectDataRecords(project, targetModel.id, transactionDb)).toEqual([]);

        const models = deleteProjectDataModelsExact(project, transactionDb, {
          targets: [{ id: targetModel.id, slug: targetModel.slug }],
          expected_count: 1,
        });
        expect(getProjectDataModel(project, targetModel.id, transactionDb)).toBeNull();
        return { records, models };
      });

      expect(result.records).toEqual({
        deleted_ids: [targetRecordA.id, targetRecordB.id],
        deleted_count: 2,
      });
      expect(result.models).toEqual({
        deleted_ids: [targetModel.id],
        deleted_count: 1,
      });
      expect(getProjectDataRecord(project, survivorModel.id, survivorRecord.id, db)).toEqual(survivorRecord);
      expect(getProjectDataRecord(otherProject, otherModel.id, otherRecord.id)).toEqual(otherRecord);
      expect(db.query<{ value: number }, []>("SELECT 1 AS value").get()?.value).toBe(1);
      expect(db.query<{ foreign_keys: number }, []>("PRAGMA foreign_keys").get()?.foreign_keys).toBe(1);
      expect(db.query<{ timeout: number }, []>("PRAGMA busy_timeout").get()?.timeout).toBeGreaterThanOrEqual(5_000);
    } finally {
      db.close();
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("rejects a caller connection for another project without mutating either store", () => {
    const root = mkdtempSync(join(tmpdir(), "project-store-wrong-db-"));
    process.env[PROJECTS_HOME_ENV] = root;
    const project = projectFixture("wks_wrongdbone", "Wrong DB One");
    const otherProject = projectFixture("wks_wrongdbtwo", "Wrong DB Two");
    const db = getProjectDatabase(project);

    try {
      const model = createProjectDataModel(project, { name: "Owned Model" }, db);
      const otherModel = createProjectDataModel(otherProject, { name: "Other Model" });

      expect(() => withProjectDataTransaction(otherProject, db, () => {
        throw new Error("must not run");
      })).toThrow(/canonical project\.db|belongs to project/i);

      expect(getProjectDataModel(project, model.id, db)).toEqual(model);
      expect(getProjectDataModel(otherProject, otherModel.id)).toEqual(otherModel);
      expect(db.query<{ value: number }, []>("SELECT 1 AS value").get()?.value).toBe(1);
    } finally {
      db.close();
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("rejects duplicate, nonexistent, mismatched, and count-mismatched record targets with rollback", () => {
    const root = mkdtempSync(join(tmpdir(), "project-store-record-guards-"));
    process.env[PROJECTS_HOME_ENV] = root;
    const project = projectFixture("wks_recordguards", "Record Guards");
    const db = getProjectDatabase(project);

    try {
      const model = createProjectDataModel(project, { name: "Guarded Model" }, db);
      const otherModel = createProjectDataModel(project, { name: "Other Model" }, db);
      const recordA = createProjectDataRecord(project, { model_id: model.id, key: "a" }, db);
      const recordB = createProjectDataRecord(project, { model_id: model.id, key: "b" }, db);

      expect(() => withProjectDataTransaction(project, db, (transactionDb) => {
        deleteProjectDataRecordsExact(project, transactionDb, {
          targets: [
            { id: recordA.id, model_id: model.id },
            { id: recordA.id, model_id: model.id },
          ],
          expected_count: 2,
        });
      })).toThrow(/duplicate/i);

      expect(() => withProjectDataTransaction(project, db, (transactionDb) => {
        deleteProjectDataRecordsExact(project, transactionDb, {
          targets: [{ id: recordA.id, model_id: model.id }],
          expected_count: 2,
        });
      })).toThrow(/expected_count/i);

      expect(() => withProjectDataTransaction(project, db, (transactionDb) => {
        deleteProjectDataRecordsExact(project, transactionDb, {
          targets: [{ id: "pdr_missing", model_id: model.id }],
          expected_count: 1,
        });
      })).toThrow(/not found/i);

      expect(() => withProjectDataTransaction(project, db, (transactionDb) => {
        deleteProjectDataRecordsExact(project, transactionDb, {
          targets: [{ id: recordA.id, model_id: otherModel.id }],
          expected_count: 1,
        });
      })).toThrow(/model/i);

      db.run(`
        CREATE TRIGGER ignore_record_b_delete
        BEFORE DELETE ON project_data_records
        WHEN OLD.id = '${recordB.id}'
        BEGIN
          SELECT RAISE(IGNORE);
        END
      `);
      expect(() => withProjectDataTransaction(project, db, (transactionDb) => {
        deleteProjectDataRecordsExact(project, transactionDb, {
          targets: [
            { id: recordA.id, model_id: model.id },
            { id: recordB.id, model_id: model.id },
          ],
          expected_count: 2,
        });
      })).toThrow(/affected-count mismatch/i);

      expect(listProjectDataRecords(project, model.id, db)).toHaveLength(2);
      expect(db.query<{ value: number }, []>("SELECT 1 AS value").get()?.value).toBe(1);
    } finally {
      db.close();
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("requires explicit record deletion before model deletion and never relies on cascade", () => {
    const root = mkdtempSync(join(tmpdir(), "project-store-no-cascade-"));
    process.env[PROJECTS_HOME_ENV] = root;
    const project = projectFixture("wks_nocascade", "No Cascade");
    const db = getProjectDatabase(project);

    try {
      const model = createProjectDataModel(project, { name: "Nonempty Model" }, db);
      const record = createProjectDataRecord(project, {
        model_id: model.id,
        key: "must-delete-first",
      }, db);

      expect(() => withProjectDataTransaction(project, db, (transactionDb) => {
        deleteProjectDataModelsExact(project, transactionDb, {
          targets: [{ id: model.id, slug: model.slug }],
          expected_count: 1,
        });
      })).toThrow(/not empty/i);
      expect(getProjectDataRecord(project, model.id, record.id, db)).toEqual(record);
      expect(getProjectDataModel(project, model.id, db)).toEqual(model);

      withProjectDataTransaction(project, db, (transactionDb) => {
        deleteProjectDataRecordsExact(project, transactionDb, {
          targets: [{ id: record.id, model_id: model.id }],
          expected_count: 1,
        });
        deleteProjectDataModelsExact(project, transactionDb, {
          targets: [{ id: model.id, slug: model.slug }],
          expected_count: 1,
        });
      });
      expect(listProjectDataModels(project, db)).toEqual([]);
    } finally {
      db.close();
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("rolls back callback throws, invalid modes, async callbacks, and keeps the caller DB open", () => {
    const root = mkdtempSync(join(tmpdir(), "project-store-transaction-guards-"));
    process.env[PROJECTS_HOME_ENV] = root;
    const project = projectFixture("wks_txguards", "Transaction Guards");
    const db = getProjectDatabase(project);

    try {
      const model = createProjectDataModel(project, { name: "Rollback Model" }, db);
      const record = createProjectDataRecord(project, { model_id: model.id, key: "rollback" }, db);

      expect(() => withProjectDataTransaction(project, db, (transactionDb) => {
        deleteProjectDataRecordsExact(project, transactionDb, {
          targets: [{ id: record.id, model_id: model.id }],
          expected_count: 1,
        });
        throw new Error("callback failed");
      })).toThrow("callback failed");
      expect(getProjectDataRecord(project, model.id, record.id, db)).toEqual(record);

      expect(() => withProjectDataTransaction(project, db, () => undefined, {
        mode: "deferred" as "immediate",
      })).toThrow(/transaction mode/i);

      expect(() => withProjectDataTransaction(project, db, (async () => undefined) as never))
        .toThrow(/synchronous callback/i);
      expect(getProjectDataRecord(project, model.id, record.id, db)).toEqual(record);
      expect(db.query<{ value: number }, []>("SELECT 1 AS value").get()?.value).toBe(1);
    } finally {
      db.close();
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("BEGIN IMMEDIATE excludes concurrent project-data writers and releases the lock after commit", () => {
    const root = mkdtempSync(join(tmpdir(), "project-store-exclusive-"));
    process.env[PROJECTS_HOME_ENV] = root;
    const project = projectFixture("wks_exclusive", "Exclusive");
    const db = getProjectDatabase(project);
    const concurrentDb = getProjectDatabase(project);

    try {
      const model = createProjectDataModel(project, { name: "Exclusive Model" }, db);
      concurrentDb.run("PRAGMA busy_timeout=10");

      withProjectDataTransaction(project, db, () => {
        expect(() => createProjectDataRecord(project, {
          model_id: model.id,
          key: "blocked-writer",
        }, concurrentDb)).toThrow(/locked|busy/i);
      });

      const record = createProjectDataRecord(project, {
        model_id: model.id,
        key: "writer-after-commit",
      }, concurrentDb);
      expect(getProjectDataRecord(project, model.id, record.id, db)).toEqual(record);
      expect(db.query<{ value: number }, []>("SELECT 1 AS value").get()?.value).toBe(1);
      expect(concurrentDb.query<{ value: number }, []>("SELECT 1 AS value").get()?.value).toBe(1);
    } finally {
      concurrentDb.close();
      db.close();
      rmSync(root, { recursive: true, force: true });
    }
  });
});

function projectFixture(id: string, name: string): ProjectStoreProject {
  return {
    id,
    name,
    slug: name.toLowerCase().replace(/[^a-z0-9]+/g, "-"),
    status: "active",
    kind: "project",
    primary_path: null,
  };
}
