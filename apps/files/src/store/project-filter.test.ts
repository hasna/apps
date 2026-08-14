import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHasnaStorageClient } from "@hasna/contracts/client/storage";
import type { HasnaHttpTransport } from "@hasna/contracts/client/transport";
import { wrapExecutor, type PgExecutor } from "../generated/storage-kit/query.js";
import {
  listFiles as listCloudFiles,
  type ListFilesQuery,
} from "../server/pg-store.js";
import type { FileWithTags } from "../types/index.js";
import { ApiStore } from "./api-store.js";
import { LocalStore } from "./local-store.js";

const MEMBER_ID = "f_synthetic_member";
const NON_MEMBER_ID = "f_synthetic_non_member";
const PROJECT_ID = "prj_synthetic_membership";

function syntheticFile(id: string, indexedAt: string): FileWithTags {
  return {
    id,
    source_id: "src_synthetic",
    machine_id: "m_synthetic",
    path: `${id}.txt`,
    name: `${id}.txt`,
    ext: ".txt",
    size: 1,
    mime: "text/plain",
    status: "active",
    indexed_at: indexedAt,
    created_at: indexedAt,
    tags: [],
  };
}

function projectMembershipTransport(): HasnaHttpTransport {
  const files = [
    syntheticFile(NON_MEMBER_ID, "2026-01-02T00:00:00.000Z"),
    syntheticFile(MEMBER_ID, "2026-01-01T00:00:00.000Z"),
  ];
  const membership = new Map<string, Set<string>>();

  return {
    baseUrl: "https://files.example.invalid/v1",
    async get(path: string, options?: { query?: Record<string, unknown> }) {
      if (path !== "/files") return {};
      const query = options?.query ?? {};
      const projectId = typeof query.project_id === "string" ? query.project_id : undefined;
      const sourceId = typeof query.source_id === "string" ? query.source_id : undefined;
      const limit = typeof query.limit === "number" ? query.limit : 50;
      const projectFiles = projectId
        ? files.filter((file) => membership.get(projectId)?.has(file.id))
        : files;
      const selected = sourceId
        ? projectFiles.filter((file) => file.source_id === sourceId)
        : projectFiles;
      return { items: selected.slice(0, limit) };
    },
    async post(path: string, body?: unknown) {
      const match = /^\/projects\/([^/]+)\/files$/.exec(path);
      if (match) {
        const projectId = decodeURIComponent(match[1]!);
        const fileId = (body as { file_id?: string } | undefined)?.file_id;
        if (fileId) {
          const members = membership.get(projectId) ?? new Set<string>();
          members.add(fileId);
          membership.set(projectId, members);
        }
      }
      return { ok: true };
    },
    async put() { return {}; },
    async patch() { return {}; },
    async del() { return { ok: true }; },
  } as unknown as HasnaHttpTransport;
}

describe("project membership filtering", () => {
  test("ApiStore returns the added member and excludes non-members", async () => {
    const transport = projectMembershipTransport();
    const store = new ApiStore(createHasnaStorageClient("files", transport));

    await store.addToProject(PROJECT_ID, MEMBER_ID);
    const files = await store.listFiles({ project_id: PROJECT_ID, limit: 1 });
    const sourceFiles = await store.listFiles({
      project_id: PROJECT_ID,
      source_id: "src_synthetic",
      limit: 1,
    });

    expect(files.map((file) => file.id)).toEqual([MEMBER_ID]);
    expect(files.some((file) => file.id === NON_MEMBER_ID)).toBe(false);
    expect(sourceFiles.map((file) => file.id)).toEqual([MEMBER_ID]);
    expect(sourceFiles.some((file) => file.id === NON_MEMBER_ID)).toBe(false);
  });

  test("cloud SQL returns the project member and excludes non-members", async () => {
    const queries: Array<{ text: string; values?: readonly unknown[] }> = [];
    const executor: PgExecutor = {
      async query(text: string, values?: readonly unknown[]) {
        queries.push({ text, values });
        if (/^SELECT f\.\* FROM files f/i.test(text.trim())
          && /\bJOIN project_files\b/i.test(text)
          && values?.includes(PROJECT_ID)) {
          return { rows: [syntheticFile(MEMBER_ID, "2026-01-01T00:00:00.000Z")], rowCount: 1 };
        }
        if (/^SELECT .* FROM files/i.test(text.trim())) {
          return { rows: [syntheticFile(NON_MEMBER_ID, "2026-01-02T00:00:00.000Z")], rowCount: 1 };
        }
        return { rows: [], rowCount: 0 };
      },
    };
    const query: ListFilesQuery & { project_id: string } = {
      project_id: PROJECT_ID,
      source_id: "src_synthetic",
      limit: 1,
    };

    const files = await listCloudFiles(wrapExecutor(executor), query);

    expect(files.map((file) => file.id)).toEqual([MEMBER_ID]);
    expect(files.some((file) => file.id === NON_MEMBER_ID)).toBe(false);
    expect(queries.some(({ text, values }) =>
      /\bJOIN project_files\b/i.test(text)
        && /\bf\.source_id\b/i.test(text)
        && values?.includes(PROJECT_ID)
        && values.includes("src_synthetic"),
    )).toBe(true);
  });
});

const ENV_KEYS = ["HASNA_FILES_DATA_DIR", "HASNA_FILES_DB_PATH"] as const;
const savedEnv = new Map<string, string | undefined>();
let testDir: string | undefined;

for (const key of ENV_KEYS) savedEnv.set(key, process.env[key]);

beforeEach(() => {
  testDir = mkdtempSync(join(tmpdir(), "files-project-filter-"));
  process.env.HASNA_FILES_DATA_DIR = testDir;
  process.env.HASNA_FILES_DB_PATH = join(testDir, "files.db");
});

afterEach(async () => {
  const { closeDb } = await import("../db/database.js");
  closeDb();
  for (const key of ENV_KEYS) {
    const value = savedEnv.get(key);
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  if (testDir) rmSync(testDir, { recursive: true, force: true });
  testDir = undefined;
});

describe("local project membership filtering", () => {
  test("LocalStore still returns the member and excludes non-members", async () => {
    const { getCurrentMachine } = await import("../db/machines.js");
    const { createSource } = await import("../db/sources.js");
    const { upsertFile } = await import("../db/files.js");
    const { createProject, addToProject } = await import("../db/projects.js");

    const machine = getCurrentMachine();
    const source = createSource({
      name: "Synthetic source",
      type: "local",
      path: testDir,
      machine_id: machine.id,
    });
    const member = upsertFile({
      id: MEMBER_ID,
      source_id: source.id,
      machine_id: machine.id,
      path: "member.txt",
      name: "member.txt",
      ext: ".txt",
      size: 1,
      mime: "text/plain",
      status: "active",
    });
    const nonMember = upsertFile({
      id: NON_MEMBER_ID,
      source_id: source.id,
      machine_id: machine.id,
      path: "non-member.txt",
      name: "non-member.txt",
      ext: ".txt",
      size: 1,
      mime: "text/plain",
      status: "active",
    });
    const project = createProject("Synthetic membership");
    addToProject(project.id, member.id);

    const files = await new LocalStore().listFiles({ project_id: project.id });

    expect(files.map((file) => file.id)).toEqual([member.id]);
    expect(files.some((file) => file.id === nonMember.id)).toBe(false);
  });
});
