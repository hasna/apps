import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { Database } from "bun:sqlite";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { closeDatabase, getDatabase, openLocalSqliteDatabase, resetDatabase } from "../db/database.js";
import { createTask } from "../db/tasks.js";
import { discoverTaskRouteSources } from "./task-route-sources.js";

let root = "";
let previousTodosDbPath: string | undefined;
let previousHasnaTodosDbPath: string | undefined;
let templateStorePath = "";

function repoPath(name: string): string {
  return join(root, name);
}

function storePath(name: string): string {
  return join(repoPath(name), ".hasna", "todos", "todos.db");
}

function seedStore(
  repoName: string,
  options: {
    title?: string;
    taskId?: string;
    tags?: string[];
    metadata?: Record<string, unknown>;
    workingDir?: string;
    requiresApproval?: boolean;
  } = {},
): string {
  const sourceRepo = repoPath(repoName);
  const dbPath = storePath(repoName);
  mkdirSync(dirname(dbPath), { recursive: true });
  copyFileSync(templateStorePath, dbPath);
  const db = openLocalSqliteDatabase(dbPath);
  try {
    db.run("PRAGMA foreign_keys = ON");
    const task = createTask({
      title: options.title ?? `Route ${repoName}`,
      status: "pending",
      priority: "medium",
      working_dir: options.workingDir ?? sourceRepo,
      tags: options.tags ?? [],
      metadata: options.metadata ?? { route_enabled: true },
      requires_approval: options.requiresApproval,
    }, db);

    if (options.taskId && options.taskId !== task.id) {
      db.run("UPDATE tasks SET id = ? WHERE id = ?", [options.taskId, task.id]);
      db.run("UPDATE task_tags SET task_id = ? WHERE task_id = ?", [options.taskId, task.id]);
    }
  } finally {
    db.close();
  }
  return dbPath;
}

function compactDiscovery(result: ReturnType<typeof discoverTaskRouteSources>) {
  return {
    stores: result.stores.map((store) => ({
      source_repo_path: store.source_repo_path,
      source_db_path: store.source_db_path,
      status: store.status,
      candidate_count: store.candidate_count,
      returned_candidate_count: store.returned_candidate_count,
      errors: store.errors.map((error) => error.code),
    })),
    candidates: result.candidates.map((candidate) => ({
      source_store_id: candidate.source_store_id,
      source_repo_path: candidate.source_repo_path,
      source_db_path: candidate.source_db_path,
      source_task_key: candidate.source_task_key,
      source_selected_by_input: candidate.source_selected_by_input,
      task_id: candidate.task_id,
      title: candidate.title,
      eligible: candidate.route_state.eligible,
      reasons: candidate.route_state.reasons,
    })),
    errors: result.errors.map((error) => ({
      source_db_path: error.source_db_path,
      code: error.code,
    })),
  };
}

function tableCounts(dbPath: string): { tasks: number; projects: number; taskLists: number } {
  const db = new Database(dbPath, { readonly: true, create: false });
  try {
    const tasks = db.query("SELECT COUNT(*) AS count FROM tasks").get() as { count: number };
    const projects = db.query("SELECT COUNT(*) AS count FROM projects").get() as { count: number };
    const taskLists = db.query("SELECT COUNT(*) AS count FROM task_lists").get() as { count: number };
    return {
      tasks: tasks.count,
      projects: projects.count,
      taskLists: taskLists.count,
    };
  } finally {
    db.close();
  }
}

function record(value: unknown): Record<string, unknown> {
  expect(value && typeof value === "object" && !Array.isArray(value)).toBe(true);
  return value as Record<string, unknown>;
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "todos-route-sources-test-"));
  previousTodosDbPath = process.env["TODOS_DB_PATH"];
  previousHasnaTodosDbPath = process.env["HASNA_TODOS_DB_PATH"];
  delete process.env["TODOS_DB_PATH"];
  delete process.env["HASNA_TODOS_DB_PATH"];
  resetDatabase();
  templateStorePath = join(root, "template", "todos.db");
  const templateDb = getDatabase(templateStorePath);
  templateDb.run("PRAGMA wal_checkpoint(TRUNCATE)");
  closeDatabase();
  resetDatabase();
});

afterEach(() => {
  closeDatabase();
  resetDatabase();
  if (previousTodosDbPath === undefined) delete process.env["TODOS_DB_PATH"];
  else process.env["TODOS_DB_PATH"] = previousTodosDbPath;
  if (previousHasnaTodosDbPath === undefined) delete process.env["HASNA_TODOS_DB_PATH"];
  else process.env["HASNA_TODOS_DB_PATH"] = previousHasnaTodosDbPath;
  rmSync(root, { recursive: true, force: true });
  root = "";
  templateStorePath = "";
});

describe("task route source discovery", () => {
  it("keeps identical task ids distinct across independent source stores", () => {
    const sharedTaskId = "00000000-0000-4000-8000-000000000001";
    const firstStore = seedStore("repo-one", { taskId: sharedTaskId, title: "Same id in repo one" });
    const secondStore = seedStore("repo-two", { taskId: sharedTaskId, title: "Same id in repo two" });

    const result = discoverTaskRouteSources({ sourceStores: [firstStore, secondStore] });

    expect(result.schema_version).toBe("todos.task_route_sources.v1");
    expect(result.total_candidate_count).toBe(2);
    expect(result.returned_candidate_count).toBe(2);
    expect(result.truncated).toBe(false);
    expect(result.errors).toEqual([]);
    expect(result.candidates).toHaveLength(2);
    expect(result.candidates.map((candidate) => candidate.task_id)).toEqual([sharedTaskId, sharedTaskId]);
    expect(new Set(result.candidates.map((candidate) => candidate.source_store_id)).size).toBe(2);
    expect(new Set(result.candidates.map((candidate) => candidate.source_repo_path)).size).toBe(2);
    expect(new Set(result.candidates.map((candidate) => candidate.source_db_path)).size).toBe(2);
    expect(new Set(result.candidates.map((candidate) => candidate.source_task_key)).size).toBe(2);
    for (const candidate of result.candidates) {
      expect(candidate.source_task_key).toBe(`${candidate.source_store_id}:${sharedTaskId}`);
      expect(candidate.source_selected_by_input).toBe(true);
      expect("source_allowed" in candidate).toBe(false);
      expect(candidate.route_state.eligible).toBe(true);
      expect(candidate.route_state.gates.route_enabled).toBe(true);
    }
  });

  it("isolates missing and corrupt stores without failing the whole scan", () => {
    const validStore = seedStore("repo-valid", { title: "Valid routable task" });
    const missingStore = storePath("repo-missing");
    const corruptStore = storePath("repo-corrupt");
    mkdirSync(join(repoPath("repo-corrupt"), ".hasna", "todos"), { recursive: true });
    writeFileSync(corruptStore, "not a sqlite database");

    const result = discoverTaskRouteSources({ sourceStores: [missingStore, validStore, corruptStore] });

    expect(result.candidates.map((candidate) => candidate.title)).toEqual(["Valid routable task"]);
    expect(result.stores).toHaveLength(3);
    expect(result.stores.find((store) => store.source_db_path === validStore)).toMatchObject({
      status: "ok",
      candidate_count: 1,
      returned_candidate_count: 1,
      errors: [],
    });
    expect(result.stores.find((store) => store.source_db_path === missingStore)).toMatchObject({
      status: "missing",
      candidate_count: 0,
      returned_candidate_count: 0,
    });
    expect(result.stores.find((store) => store.source_db_path === corruptStore)).toMatchObject({
      status: "error",
      candidate_count: 0,
      returned_candidate_count: 0,
    });
    expect(result.errors.map((error) => error.source_db_path).sort()).toEqual([corruptStore, missingStore].sort());
    expect(result.errors.find((error) => error.source_db_path === missingStore)?.code).toBe("STORE_MISSING");
    expect(["STORE_UNREADABLE", "STORE_INVALID"]).toContain(
      result.errors.find((error) => error.source_db_path === corruptStore)?.code,
    );
    expect(existsSync(join(repoPath("repo-missing"), ".hasna"))).toBe(false);
  });

  it("keeps store accounting deterministic when result limit truncates returned candidates", () => {
    const alpha = seedStore("repo-alpha", { title: "Alpha limited task" });
    const beta = seedStore("repo-beta", { title: "Beta limited task" });
    const gamma = seedStore("repo-gamma", { title: "Gamma limited task" });

    const result = discoverTaskRouteSources({
      sourceStores: [gamma, alpha, beta],
      limit: 1,
    });

    expect(result.sourceStores).toEqual([alpha, beta, gamma]);
    expect(result.stores.map((store) => store.source_db_path)).toEqual([alpha, beta, gamma]);
    expect(result.total_candidate_count).toBe(3);
    expect(result.returned_candidate_count).toBe(1);
    expect(result.truncated).toBe(true);
    expect(result.candidates.map((candidate) => candidate.title)).toEqual(["Alpha limited task"]);
    expect(result.stores.map((store) => ({
      title: store.source_repo_path?.split("/").pop(),
      candidate_count: store.candidate_count,
      returned_candidate_count: store.returned_candidate_count,
    }))).toEqual([
      { title: "repo-alpha", candidate_count: 1, returned_candidate_count: 1 },
      { title: "repo-beta", candidate_count: 1, returned_candidate_count: 0 },
      { title: "repo-gamma", candidate_count: 1, returned_candidate_count: 0 },
    ]);
  });

  it("applies include/exclude filters deterministically without mutating scanned stores or default storage", () => {
    const firstStore = seedStore("repo-alpha", { title: "Alpha task" });
    const secondStore = seedStore("repo-beta", { title: "Beta task" });
    const thirdStore = seedStore("repo-gamma", { title: "Gamma task" });
    const defaultDbPath = join(root, "default-home", ".hasna", "todos", "todos.db");
    process.env["TODOS_DB_PATH"] = defaultDbPath;
    const before = new Map([
      [firstStore, tableCounts(firstStore)],
      [secondStore, tableCounts(secondStore)],
      [thirdStore, tableCounts(thirdStore)],
    ]);

    const input = {
      sourceStores: [firstStore, secondStore, thirdStore],
      include: ["repo-"],
      exclude: ["repo-beta"],
    };
    const first = discoverTaskRouteSources(input);
    const second = discoverTaskRouteSources(input);

    expect(compactDiscovery(second)).toEqual(compactDiscovery(first));
    expect(first.candidates.map((candidate) => candidate.title)).toEqual(["Alpha task", "Gamma task"]);
    expect(first.candidates.every((candidate) => !candidate.source_db_path.includes("repo-beta"))).toBe(true);
    expect(tableCounts(firstStore)).toEqual(before.get(firstStore));
    expect(tableCounts(secondStore)).toEqual(before.get(secondStore));
    expect(tableCounts(thirdStore)).toEqual(before.get(thirdStore));
    expect(existsSync(defaultDbPath)).toBe(false);
  });

  it("matches include globs against source repo basenames for operator-friendly open-* filters", () => {
    const openAlpha = seedStore("open-alpha", { title: "Open alpha task" });
    const openBeta = seedStore("open-beta", { title: "Open beta task" });
    const internal = seedStore("internal-gamma", { title: "Internal gamma task" });

    const result = discoverTaskRouteSources({
      sourceStores: [internal, openBeta, openAlpha],
      include: ["open-*"],
    });

    expect(result.errors).toEqual([]);
    expect(result.candidates.map((candidate) => candidate.title).sort()).toEqual(["Open alpha task", "Open beta task"]);
    expect(result.candidates.every((candidate) => candidate.source_repo_path?.split("/").pop()?.startsWith("open-"))).toBe(true);
  });

  it("discovers source-root stores in sorted path order", () => {
    seedStore("zeta-root", { title: "Zeta root task" });
    seedStore("alpha-root", { title: "Alpha root task" });

    const result = discoverTaskRouteSources({ sourceRoots: [root] });

    expect(result.errors).toEqual([]);
    expect(result.stores.map((store) => store.source_repo_path?.split("/").pop())).toEqual(["alpha-root", "zeta-root"]);
    expect(result.candidates.map((candidate) => candidate.title)).toEqual(["Alpha root task", "Zeta root task"]);
  });

  it("treats auto:route as authorization but never overrides explicit deny gates", () => {
    const tagOnlyStore = seedStore("repo-auto-intent", {
      title: "Tag intent only",
      tags: ["auto:route"],
      metadata: {},
    });
    const noAutoStore = seedStore("repo-no-auto", {
      title: "No auto override",
      tags: ["auto:route"],
      metadata: { route_enabled: true, automation: { no_auto: true } },
    });
    const approvalStore = seedStore("repo-approval", {
      title: "Approval override",
      tags: ["auto:route"],
      metadata: { route_enabled: true },
      requiresApproval: true,
    });

    const result = discoverTaskRouteSources({ sourceStores: [tagOnlyStore, noAutoStore, approvalStore] });
    const byTitle = new Map(result.candidates.map((candidate) => [candidate.title, candidate]));

    // auto:route with no explicit route_enabled is the opt-in signal the OpenLoops
    // drain routes on, so route_state authorizes it — eligibility is computed the
    // same single way the drain admits work (no more route_not_enabled / drain-routes
    // disagreement).
    expect(byTitle.get("Tag intent only")?.route_state.gates.tag_opt_in).toBe(true);
    expect(byTitle.get("Tag intent only")?.route_state.gates.route_enabled).toBe(true);
    expect(byTitle.get("Tag intent only")?.route_state.eligible).toBe(true);
    expect(byTitle.get("Tag intent only")?.route_state.reasons).not.toContain("route_not_enabled");
    expect(byTitle.get("Tag intent only")?.route_state.route_class).toBe("eligible");

    // The tag never overrides an explicit deny gate.
    expect(byTitle.get("No auto override")?.route_state.gates.route_enabled).toBe(true);
    expect(byTitle.get("No auto override")?.route_state.eligible).toBe(false);
    expect(byTitle.get("No auto override")?.route_state.reasons).toContain("no_auto");
    expect(byTitle.get("No auto override")?.route_state.route_class).toBe("unroutable");

    expect(byTitle.get("Approval override")?.route_state.gates.route_enabled).toBe(true);
    expect(byTitle.get("Approval override")?.route_state.eligible).toBe(false);
    expect(byTitle.get("Approval override")?.route_state.reasons).toContain("requires_approval");
    expect(byTitle.get("Approval override")?.route_state.route_class).toBe("unroutable");
  });

  it("redacts metadata enough for persistence and does not emit task comments", () => {
    const apiKeyFixture = ["super", "secret", "value"].join("-");
    const tokenFixture = ["another", "secret", "value"].join("-");
    const redactedStore = seedStore("repo-redacted", {
      title: "Redacted metadata",
      metadata: {
        route_enabled: true,
        api_key: apiKeyFixture,
        nested: { token: tokenFixture },
        comments: ["private customer note"],
      },
    });

    const result = discoverTaskRouteSources({ sourceStores: [redactedStore] });
    const [candidate] = result.candidates;
    const serialized = JSON.stringify(candidate);

    expect(candidate?.metadata.api_key).toBe("[REDACTED]");
    expect(record(candidate?.metadata.nested).token).toBe("[REDACTED]");
    expect(candidate?.metadata.comments).toBe("[REDACTED_COMMENT]");
    expect(serialized).not.toContain(apiKeyFixture);
    expect(serialized).not.toContain(tokenFixture);
    expect(serialized).not.toContain("private customer note");
  });
});
