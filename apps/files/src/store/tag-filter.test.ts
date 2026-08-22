import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHasnaStorageClient } from "@hasna/contracts/client/storage";
import type { HasnaHttpTransport } from "@hasna/contracts/client/transport";
import { wrapExecutor, type PgExecutor } from "../generated/storage-kit/query.js";
import { listFiles as listCloudFiles, tagFile as cloudTagFile, untagFile as cloudUntagFile } from "../server/pg-store.js";
import type { FileWithTags } from "../types/index.js";
import { ApiStore } from "./api-store.js";
import { LocalStore } from "./local-store.js";

const MATCHING_TAG = "project:company-taxes";
const ABSENT_TAGS = ["project:monthly-filing", "project:ro-accounting"] as const;
const MEMBER_ID = "f_synthetic_tag_member";
const NON_MEMBER_ID = "f_synthetic_tag_non_member";

function syntheticFile(id: string, tags: string[]): FileWithTags {
  return {
    id,
    source_id: "src_synthetic_tag",
    machine_id: "m_synthetic_tag",
    path: `${id}.txt`,
    name: `${id}.txt`,
    ext: ".txt",
    size: 1,
    mime: "text/plain",
    status: "active",
    indexed_at: "2026-01-01T00:00:00.000Z",
    created_at: "2026-01-01T00:00:00.000Z",
    tags,
  };
}

function exactTagTransport(): HasnaHttpTransport {
  const member = syntheticFile(MEMBER_ID, [MATCHING_TAG]);
  const unrelated = syntheticFile(NON_MEMBER_ID, ["zz"]);
  return {
    baseUrl: "https://files.example.invalid/v1",
    async get(path: string, options?: { query?: Record<string, unknown> }) {
      if (path !== "/files") return {};
      const tag = options?.query?.tag;
      if (tag === MATCHING_TAG) return { items: [member] };
      if (ABSENT_TAGS.includes(tag as typeof ABSENT_TAGS[number])) return { items: [] };
      return { items: [unrelated] };
    },
    async post() { return {}; },
    async put() { return {}; },
    async patch() { return {}; },
    async del() { return {}; },
  } as unknown as HasnaHttpTransport;
}

describe("API exact tag filtering", () => {
  test("ApiStore sends the requested tag and never returns unrelated rows", async () => {
    const store = new ApiStore(createHasnaStorageClient("files", exactTagTransport()));

    const matching = await store.listFiles({ tag: MATCHING_TAG });
    expect(matching.map((file) => file.id)).toEqual([MEMBER_ID]);
    expect(matching.some((file) => file.id === NON_MEMBER_ID)).toBe(false);

    for (const tag of ABSENT_TAGS) {
      expect(await store.listFiles({ tag })).toEqual([]);
    }
  });

  test("cloud SQL joins exact tag membership and composes with source filters", async () => {
    const queries: Array<{ text: string; values: readonly unknown[] }> = [];
    const executor: PgExecutor = {
      async query(text: string, values: readonly unknown[] = []) {
        queries.push({ text, values });
        if (/^SELECT DISTINCT f\.\* FROM files f/i.test(text.trim())) {
          const exact = /\bJOIN file_tags\b/i.test(text)
            && /\bJOIN tags\b/i.test(text)
            && values.includes(MATCHING_TAG)
            && values.includes("src_synthetic_tag");
          return {
            rows: [exact
              ? syntheticFile(MEMBER_ID, [MATCHING_TAG])
              : syntheticFile(NON_MEMBER_ID, ["zz"])] as never[],
            rowCount: 1,
          };
        }
        if (/SELECT t\.name FROM tags/i.test(text)) {
          return { rows: [{ name: MATCHING_TAG }] as never[], rowCount: 1 };
        }
        return { rows: [], rowCount: 0 };
      },
    };

    const matching = await listCloudFiles(wrapExecutor(executor), {
      tag: MATCHING_TAG,
      source_id: "src_synthetic_tag",
      limit: 10,
    });

    expect(matching.map((file) => file.id)).toEqual([MEMBER_ID]);
    expect(queries.some(({ text, values }) =>
      /\bJOIN file_tags\b/i.test(text)
        && /\bJOIN tags\b/i.test(text)
        && values.includes(MATCHING_TAG)
        && values.includes("src_synthetic_tag"),
    )).toBe(true);
  });
});

const ENV_KEYS = ["HASNA_FILES_DATA_DIR", "HASNA_FILES_DB_PATH"] as const;
const savedEnv = new Map<string, string | undefined>();
let testDir: string | undefined;

for (const key of ENV_KEYS) savedEnv.set(key, process.env[key]);

beforeEach(() => {
  testDir = mkdtempSync(join(tmpdir(), "files-tag-filter-"));
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

describe("cloud tag normalization mirrors the local store", () => {
  test("tagFile stores lowercase and listFiles/untagFile look up lowercase", async () => {
    // In-memory executor simulating a case-sensitive tags table: the stored
    // name is the key, exactly like a real Postgres `=` comparison, so a
    // mixed-case lookup cannot find a lowercase row and vice versa.
    const stored = new Map<string, string>(); // stored tag name -> tag id
    const queries: Array<{ text: string; values: readonly unknown[] }> = [];
    const executor: PgExecutor = {
      async query(text: string, values: readonly unknown[] = []) {
        queries.push({ text, values });
        const sql = text.trim();
        if (/^SELECT id FROM tags WHERE name = \$1/i.test(sql)) {
          const id = stored.get(String(values[0]));
          return { rows: id ? ([{ id }] as never[]) : ([] as never[]), rowCount: id ? 1 : 0 };
        }
        if (/^INSERT INTO tags/i.test(sql)) {
          const id = String(values[0]);
          const name = String(values[1]);
          if (!stored.has(name)) stored.set(name, id);
          return { rows: [], rowCount: 1 };
        }
        if (/^INSERT INTO file_tags/i.test(sql)) return { rows: [], rowCount: 1 };
        if (/^DELETE FROM file_tags/i.test(sql)) {
          // values: [fileId, tagName] — the subquery resolves the tag id by name
          return { rows: [], rowCount: stored.has(String(values[1])) ? 1 : 0 };
        }
        if (/^SELECT DISTINCT f\.\*/i.test(sql)) {
          // The tag filter is one of several bound params (status comes first),
          // so match on membership like a real `t_filter.name = $N` join.
          const tag = values.find((v) => typeof v === "string" && stored.has(v));
          return {
            rows: tag !== undefined ? ([syntheticFile(MEMBER_ID, [String(tag)])] as never[]) : ([] as never[]),
            rowCount: tag !== undefined ? 1 : 0,
          };
        }
        if (/SELECT t\.name FROM tags/i.test(sql)) {
          const names = [...stored.keys()];
          return { rows: names.map((name) => ({ name })) as never[], rowCount: names.length };
        }
        return { rows: [], rowCount: 0 };
      },
    };
    const client = wrapExecutor(executor);

    // Storing a mixed-case tag must land as lowercase "alumia" — never a
    // case-duplicate row (the local store lowercases on both lookup and insert).
    await cloudTagFile(client, MEMBER_ID, "Alumia");
    const tagInsert = queries.find((q) => /^INSERT INTO tags/i.test(q.text.trim()))!;
    expect(tagInsert.values[1]).toBe("alumia");

    // The lowercase filter matches the normalized stored tag.
    expect((await listCloudFiles(client, { tag: "alumia", limit: 10 })).map((file) => file.id)).toEqual([MEMBER_ID]);

    // A mixed-case filter is normalized to the same key before it reaches SQL.
    const mixedCase = await listCloudFiles(client, { tag: "Alumia", limit: 10 });
    const fileSelects = queries.filter((q) => /^SELECT DISTINCT f\.\*/i.test(q.text.trim()));
    expect(fileSelects[fileSelects.length - 1].values).toContain("alumia");
    expect(fileSelects[fileSelects.length - 1].values).not.toContain("Alumia");
    expect(mixedCase.map((file) => file.id)).toEqual([MEMBER_ID]);

    // Untag resolves the tag by the normalized name too.
    await cloudUntagFile(client, MEMBER_ID, "Alumia");
    const deleteQ = queries.find((q) => /^DELETE FROM file_tags/i.test(q.text.trim()))!;
    expect(deleteQ.values).toEqual([MEMBER_ID, "alumia"]);
  });
});

describe("local exact tag filtering", () => {
  test("composes source and tag filters without losing the exact member", async () => {
    const { getCurrentMachine } = await import("../db/machines.js");
    const { createSource } = await import("../db/sources.js");
    const { upsertFile } = await import("../db/files.js");
    const { tagFile } = await import("../db/tags.js");

    const machine = getCurrentMachine();
    const source = createSource({
      name: "Synthetic tag source",
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
    const unrelated = upsertFile({
      id: NON_MEMBER_ID,
      source_id: source.id,
      machine_id: machine.id,
      path: "unrelated.txt",
      name: "unrelated.txt",
      ext: ".txt",
      size: 1,
      mime: "text/plain",
      status: "active",
    });
    tagFile(member.id, MATCHING_TAG);
    tagFile(unrelated.id, "zz");

    const store = new LocalStore();
    expect((await store.getFile(member.id))?.tags).toContain(MATCHING_TAG);
    expect((await store.listFiles({ source_id: source.id })).map((file) => file.id)).toContain(member.id);
    expect((await store.listFiles({
      source_id: source.id,
      tag: MATCHING_TAG,
    })).map((file) => file.id)).toEqual([member.id]);
    for (const tag of ABSENT_TAGS) {
      expect(await store.listFiles({ source_id: source.id, tag })).toEqual([]);
    }
  });
});
