import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { Database } from "bun:sqlite";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { closeDatabase, getDatabase, resetDatabase } from "../db/database.js";
import { createTask } from "../db/tasks.js";
import { DEDUPE_SOURCE_KEY_ALLOWLIST, projectTasksForDedupe } from "./dedupe-projection.js";
import { findDuplicateTasks } from "./task-dedupe.js";

// Synthetic secret fixtures, assembled from fragments so the literal never
// appears in this file: the repo CI secret scan matches a bare xai prefix
// (case-insensitive) and a literal fixture would trip its commit gate. Same
// technique as apps/secrets/src/scanner.test.ts. The vendor's published
// shape is the xai prefix plus [a-z0-9]{20,80} (case-insensitive); model ids
// are hyphenated and must NOT be treated as credentials.
const XAI = ["x", "ai", "-"].join("");
const XAI_KEY_50 = `${XAI}7aBc9dEf0123456789abcdef0123456789abcdef0123456789`;
const XAI_KEY_32 = `${XAI}00aa11bb22cc33dd44ee55ff66778899aabbccdd`;

// The projection's exact top-level field set: the dedup fingerprint fields plus
// the bounded source-key metadata object. Nothing else — never free-form
// metadata, never tags, never comments/run/plan fields.
const PROJECTION_KEYS = [
  "assigned_to",
  "created_at",
  "description",
  "id",
  "metadata",
  "priority",
  "project_id",
  "short_id",
  "status",
  "task_list_id",
  "title",
  "updated_at",
].sort();

let db: Database;

beforeEach(() => {
  process.env["TODOS_DB_PATH"] = ":memory:";
  resetDatabase();
  db = getDatabase();
});

afterEach(() => {
  closeDatabase();
  delete process.env["TODOS_DB_PATH"];
});

describe("projectTasksForDedupe — bounded dedup projection", () => {
  test("carries ONLY allowlisted fields and never free-form metadata, tags, or composite state", () => {
    const task = createTask({
      title: "Duplicate scanner leak",
      description: "Normal description",
      tags: ["bug", "security"],
      metadata: {
        github_url: "https://github.com/hasna/todos/issues/42",
        github_number: 42,
        token: "free-form-token-value",
        api_key: "free-form-api-key-value",
        arbitrary: { nested: true },
      },
    }, db);

    const [projected] = projectTasksForDedupe([task]);
    expect(Object.keys(projected).sort()).toEqual(PROJECTION_KEYS);
    // metadata is the source-key allowlist ONLY — the free-form token/api_key/arbitrary
    // composites that carried the leaked values are never projected.
    expect(projected.metadata).toEqual({
      github_url: "https://github.com/hasna/todos/issues/42",
      github_number: 42,
    });
    for (const key of Object.keys(task.metadata)) {
      if (key === "github_url" || key === "github_number") continue;
      expect(key in projected.metadata).toBe(false);
    }
    expect("tags" in projected).toBe(false);
    // The allowlist is the exact source-key set the fingerprint consumes.
    expect([...DEDUPE_SOURCE_KEY_ALLOWLIST]).toEqual([
      "github_url",
      "github_issue_url",
      "github_pr_url",
      "source_url",
      "url",
      "external_url",
      "issue_url",
      "github_owner",
      "github_repo",
      "github_number",
    ]);
  });

  test("a task holding an xAI key in title/description/metadata never leaks it through the projection", () => {
    const task = createTask({
      title: `Rotate provider key ${XAI_KEY_50}`,
      description: `DEBUG: provider key ${XAI_KEY_50} rotated; export "token": "${XAI_KEY_32}" now`,
      metadata: {
        token: XAI_KEY_32,
        api_key: XAI_KEY_50,
        github_url: "https://github.com/hasna/todos/issues/42",
      },
    }, db);

    const [projected] = projectTasksForDedupe([task]);
    const serialized = JSON.stringify(projected);
    expect(serialized).not.toContain(XAI_KEY_50);
    expect(serialized).not.toContain(XAI_KEY_32);
    // free-form metadata is dropped entirely; the carried text is redacted.
    expect(projected.metadata).toEqual({ github_url: "https://github.com/hasna/todos/issues/42" });
    expect(projected.title).not.toContain(XAI_KEY_50);
    expect(projected.description).not.toContain(XAI_KEY_50);
    expect(projected.description).not.toContain(XAI_KEY_32);
  });

  test("findDuplicateTasks returns bounded projections, so dedup results never carry free-form metadata or secret values", () => {
    const issueA = createTask({
      title: "Parser crash on empty input",
      description: "Same imported issue",
      metadata: {
        github_url: "https://github.com/hasna/todos/issues/42",
        github_number: 42,
        token: XAI_KEY_32,
      },
    }, db);
    const issueB = createTask({
      title: "Parser crash on empty input",
      description: "Duplicate with a secret",
      metadata: {
        github_url: "https://github.com/hasna/todos/issues/42",
        github_number: 42,
        api_key: XAI_KEY_50,
      },
    }, db);

    const candidates = findDuplicateTasks({ threshold: 0.8 }, db);
    expect(candidates.length).toBeGreaterThan(0);
    const serialized = JSON.stringify(candidates);
    expect(serialized).not.toContain(XAI_KEY_50);
    expect(serialized).not.toContain(XAI_KEY_32);
    for (const candidate of candidates) {
      expect("token" in candidate.primary_task.metadata).toBe(false);
      expect("api_key" in candidate.primary_task.metadata).toBe(false);
      expect("token" in candidate.duplicate_task.metadata).toBe(false);
      expect("api_key" in candidate.duplicate_task.metadata).toBe(false);
      expect("tags" in candidate.primary_task).toBe(false);
      expect("tags" in candidate.duplicate_task).toBe(false);
    }
    // The ids needed to merge are still present and bounded. Primary is the
    // OLDER row (created_at tie-breaks to id), so either fixture may win.
    const pair = new Set([candidates[0]!.primary_task.id, candidates[0]!.duplicate_task.id]);
    expect(pair.has(issueA.id)).toBe(true);
    expect(pair.has(issueB.id)).toBe(true);
  });
});

// ---- CLI integration: the surfaces workflows capture ----------------------
// The canonical-machine abstraction exists so dedup workflows consume the
// bounded projection instead of the credential-bearing list/compact/csv output.
// These spawn the real CLI against a temp DB, mirroring the O15-00170 repro.

const CLI_ROOT = join(import.meta.dir, "../..");
const tempRoots: string[] = [];

async function runCli(args: string[], root: string): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  const proc = Bun.spawn(["bun", "run", "src/cli/index.tsx", ...args], {
    cwd: CLI_ROOT,
    env: {
      PATH: process.env.PATH ?? "",
      HOME: join(root, "home"),
      TMPDIR: root,
      LANG: "C.UTF-8",
      TODOS_DB_PATH: join(root, "todos.db"),
      TODOS_AUTO_PROJECT: "false",
      // Fail-closed ruling (hasna/apps#1613): this env is built from scratch
      // (no ambient spread), so the local store needs the explicit opt-in.
      HASNA_TODOS_LOCAL: "1",
      TODOS_LOCAL: "1",
    },
    stdout: "pipe",
    stderr: "pipe",
  });
  const stdout = await new Response(proc.stdout).text();
  const stderr = await new Response(proc.stderr).text();
  return { exitCode: await proc.exited, stdout, stderr };
}

describe("todos dedupe project --json (canonical-machine surface)", () => {
  // Each CLI spawn is a cold bun process (~1s); the surface sweep needs a
  // generous budget so the assertion is about behavior, not startup cost.
  test("emits only the bounded projection; list/compact/csv redact value-shaped xAI keys; free-form metadata is dropped", async () => {
    const root = mkdtempSync(join(tmpdir(), "todos-dedupe-projection-"));
    tempRoots.push(root);
    try {
      const project = JSON.parse(
        (await runCli(["projects", "--add", join(root, "proj"), "--name", "Probe", "-j"], root)).stdout,
      );
      const desc = `DEBUG: provider key ${XAI_KEY_50} rotated; export "token": "${XAI_KEY_32}" now`;
      const title = `probe ${XAI_KEY_50} leak`;
      // A free-form metadata value under a non-secret key, with no recognizable
      // value prefix — the shape the pattern redactor cannot catch (the
      // env-secret-assignment gap). list/compact/csv carry it; the projection
      // structurally drops it because free-form metadata is never projected.
      const freeFormSecret = "CONFIDENTIAL-EVIDENCE-7f3a9c21e5d84b60";
      const add = await runCli(
        ["task", "upsert", "--fingerprint", "o15-00170-fixture", "--title", title, "--description", desc, "--metadata-json", JSON.stringify({ note: freeFormSecret, github_url: "https://github.com/hasna/todos/issues/42" }), "--project", project.id, "-j"],
        root,
      );
      expect(add.exitCode).toBe(0);

      // list/compact/csv redact the value-shaped xAI keys now (the redactor gap
      // from the repro is closed), but they still carry free-form metadata the
      // pattern redactor cannot see — which is exactly why dedup workflows must
      // consume the bounded projection, never list output.
      const listJson = await runCli(["list", "--project", project.id, "--json"], root);
      expect(listJson.exitCode).toBe(0);
      expect(listJson.stdout).not.toContain(XAI_KEY_50);
      expect(listJson.stdout).not.toContain(XAI_KEY_32);
      expect(listJson.stdout).toContain("[REDACTED_TOKEN]");
      expect(listJson.stdout).toContain(freeFormSecret);
      const compact = await runCli(["list", "--project", project.id, "--format", "compact"], root);
      expect(compact.exitCode).toBe(0);
      expect(compact.stdout).not.toContain(XAI_KEY_50);
      const csv = await runCli(["list", "--project", project.id, "--format", "csv"], root);
      expect(csv.exitCode).toBe(0);
      expect(csv.stdout).not.toContain(XAI_KEY_50);

      // The dedupe projection surface never carries the value nor the free-form
      // metadata, and its field set is exactly the bounded allowlist.
      const dedupeJson = await runCli(["dedupe", "project", project.id, "--json"], root);
      expect(dedupeJson.exitCode).toBe(0);
      expect(dedupeJson.stdout).not.toContain(XAI_KEY_50);
      expect(dedupeJson.stdout).not.toContain(XAI_KEY_32);
      expect(dedupeJson.stdout).not.toContain(freeFormSecret);
      const parsed = JSON.parse(dedupeJson.stdout);
      expect(Array.isArray(parsed.tasks)).toBe(true);
      expect(Object.keys(parsed.tasks[0]!).sort()).toEqual(PROJECTION_KEYS);
      expect(parsed.tasks[0]!.metadata).toEqual({ github_url: "https://github.com/hasna/todos/issues/42" });

      // dedupe scan results are bounded too.
      const scanJson = await runCli(["dedupe", "scan", "--json"], root);
      expect(scanJson.exitCode).toBe(0);
      expect(scanJson.stdout).not.toContain(XAI_KEY_50);
      expect(scanJson.stdout).not.toContain(XAI_KEY_32);
      expect(scanJson.stdout).not.toContain(freeFormSecret);
    } finally {
      for (const r of tempRoots.splice(0)) rmSync(r, { recursive: true, force: true });
    }
  }, 120_000);
});
