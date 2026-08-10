import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { existsSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { getDatabase, resetDatabase } from "../db/database.js";
import { createMemory } from "../db/memories.js";
import { registerProject } from "../db/projects.js";
import { createSessionJob } from "../db/session-jobs.js";
import {
  assertLocalStoreBackend,
  blankLlmProviderEnv,
  isolatedStoreEnv,
} from "../test-support/store-isolation.js";

const DB_PATH = join(tmpdir(), `mementos-project-resources-${Date.now()}.db`);
const CLI_PATH = new URL("./index.tsx", import.meta.url).pathname;
const CLI_ENV = isolatedStoreEnv(DB_PATH, { extra: blankLlmProviderEnv() });
const TEST_TIMEOUT_MS = 60_000;

async function runCli(
  ...args: string[]
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  const proc = Bun.spawn(["bun", "run", CLI_PATH, ...args], {
    env: CLI_ENV,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);
  return {
    stdout: stdout.trim(),
    stderr: stderr.trim(),
    exitCode: await proc.exited,
  };
}

let projectId = "";
let memoryId = "";

beforeAll(async () => {
  await assertLocalStoreBackend(CLI_PATH, CLI_ENV, DB_PATH);
  const db = getDatabase(DB_PATH);
  const project = registerProject(
    "CLI Producer",
    "/projects/cli-producer",
    undefined,
    undefined,
    db,
  );
  projectId = project.id;
  createMemory({
    key: "cli-project-knowledge",
    value: "knowledge",
    category: "knowledge",
    project_id: project.id,
  }, "merge", db);
  memoryId = createMemory({
    key: "cli-project-memory",
    value: "memory",
    category: "history",
    project_id: project.id,
  }, "merge", db).id;
  createMemory({
    key: "cli-global-memory",
    value: "outside",
    category: "history",
  }, "merge", db);
  createSessionJob({
    session_id: "cli-producer-session",
    transcript: "session transcript",
    project_id: project.id,
  }, db);
}, TEST_TIMEOUT_MS);

afterAll(() => {
  resetDatabase();
  for (const suffix of ["", "-wal", "-shm"]) {
    const file = DB_PATH + suffix;
    if (existsSync(file)) unlinkSync(file);
  }
});

describe("project-resources CLI", () => {
  test("pages, exhausts, and reads an exact stable ID", async () => {
    const first = await runCli(
      "--json",
      "project-resources",
      projectId,
      "--limit",
      "2",
    );
    expect(first.exitCode).toBe(0);
    expect(first.stderr).not.toContain("error:");
    const firstBody = JSON.parse(first.stdout) as Record<string, any>;
    expect(firstBody).toMatchObject({
      schema: "mementos.project-resources.v1",
      project_id: projectId,
      count: 2,
      total: 4,
      has_more: true,
      complete: true,
      truncated: false,
    });

    const second = await runCli(
      "--json",
      "project-resources",
      projectId,
      "--limit",
      "2",
      "--cursor",
      String(firstBody.next_cursor),
    );
    expect(second.exitCode).toBe(0);
    const secondBody = JSON.parse(second.stdout) as Record<string, any>;
    expect(secondBody).toMatchObject({
      count: 2,
      total: 4,
      has_more: false,
      next_cursor: null,
      collection_revision: firstBody.collection_revision,
    });
    const stableKeys = [...firstBody.resources, ...secondBody.resources]
      .map((resource: Record<string, string>) =>
        `${resource.resource_kind}:${resource.stable_id}`);
    expect(new Set(stableKeys).size).toBe(4);

    const all = await runCli(
      "--json",
      "project-resources",
      projectId,
      "--limit",
      "1",
      "--all",
    );
    expect(all.exitCode).toBe(0);
    expect(JSON.parse(all.stdout)).toMatchObject({
      count: 4,
      total: 4,
      has_more: false,
      next_cursor: null,
    });

    const exact = await runCli(
      "--json",
      "project-resources",
      projectId,
      "--resource-kind",
      "memory",
      "--resource-id",
      memoryId,
    );
    expect(exact.exitCode).toBe(0);
    expect(JSON.parse(exact.stdout)).toMatchObject({
      project_id: projectId,
      resource: { resource_kind: "memory", stable_id: memoryId },
    });
  }, TEST_TIMEOUT_MS);
});
