import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, expect, test } from "bun:test";
import {
  commitWorkflowRunManifest,
  discardWorkflowRunManifest,
  safeRunPathSlug,
  stageWorkflowRunManifest,
  workflowRunProjectSlug,
  workflowRunSubjectKey,
  writeWorkflowRunManifest,
} from "./run-artifacts.js";

describe("run-artifacts", () => {
  test("safeRunPathSlug normalizes unsafe path characters and truncates", () => {
    expect(safeRunPathSlug("Hello World/Task #42", "fallback")).toBe("hello-world-task-42");
    expect(safeRunPathSlug("  ", "fallback")).toBe("fallback");
    expect(safeRunPathSlug(undefined, "fallback")).toBe("fallback");
    expect(safeRunPathSlug("---", "fallback")).toBe("fallback");
    expect(safeRunPathSlug("a".repeat(200), "fallback")).toHaveLength(72);
    expect(safeRunPathSlug("Keep.dots_and-dashes", "fallback")).toBe("keep.dots_and-dashes");
  });

  test("workflowRunSubjectKey is deterministic and collision-resistant across refs", () => {
    const key = workflowRunSubjectKey("todos-task", "task-123");
    expect(key).toBe(workflowRunSubjectKey("todos-task", "task-123"));
    expect(key).toMatch(/^todos-task-task-123-[0-9a-f]{12}$/);
    expect(workflowRunSubjectKey("todos-task", "task-124")).not.toBe(key);
    expect(workflowRunSubjectKey(undefined, undefined)).toMatch(/^subject-subject-[0-9a-f]{12}$/);
    // Slug collisions must still produce distinct keys via the raw-ref hash.
    const left = workflowRunSubjectKey("kind", "ref/a");
    const right = workflowRunSubjectKey("kind", "ref a");
    expect(left).not.toBe(right);
  });

  test("workflowRunProjectSlug maps absolute paths to their basename and defaults to global", () => {
    expect(workflowRunProjectSlug(undefined)).toBe("global");
    expect(workflowRunProjectSlug("  ")).toBe("global");
    expect(workflowRunProjectSlug("/home/user/Repos/My Project")).toBe("my-project");
    expect(workflowRunProjectSlug("simple-key")).toBe("simple-key");
  });

  test("stage/commit writes the manifest atomically with restrictive permissions", () => {
    const root = mkdtempSync(join(tmpdir(), "loops-artifacts-"));
    try {
      const staged = stageWorkflowRunManifest({
        loopsDataDir: root,
        workflowRunId: "wfr-1",
        workflowId: "wf-1",
        workflowName: "example",
        invocationId: "inv-1",
        workItemId: "item-1",
        projectKey: "/repos/example",
        subjectKind: "todos-task",
        rawSubjectRef: "task-9",
        payload: { extra: "value" },
      });
      expect(staged.tmpPath).toBe(`${staged.manifestPath}.tmp`);
      expect(existsSync(staged.tmpPath)).toBe(true);
      expect(existsSync(staged.manifestPath)).toBe(false);
      expect(statSync(staged.tmpPath).mode & 0o777).toBe(0o600);
      expect(statSync(dirname(staged.manifestPath)).mode & 0o777).toBe(0o700);

      const committed = commitWorkflowRunManifest(staged);
      expect(committed).toBe(staged.manifestPath);
      expect(existsSync(staged.tmpPath)).toBe(false);
      const manifest = JSON.parse(readFileSync(committed, "utf8"));
      expect(manifest.version).toBe(1);
      expect(manifest.workflowRunId).toBe("wfr-1");
      expect(manifest.workflowId).toBe("wf-1");
      expect(manifest.workflowName).toBe("example");
      expect(manifest.invocationId).toBe("inv-1");
      expect(manifest.workItemId).toBe("item-1");
      expect(manifest.projectSlug).toBe("example");
      expect(manifest.subjectKey).toMatch(/^todos-task-task-9-[0-9a-f]{12}$/);
      expect(manifest.requiredReading).toEqual([]);
      expect(manifest.extra).toBe("value");
      expect(committed).toContain(join(root, "runs", "example"));
      expect(committed).toContain(join(manifest.subjectKey, "wfr-1", "manifest.json"));
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("discard removes the staged temp file without promoting it", () => {
    const root = mkdtempSync(join(tmpdir(), "loops-artifacts-discard-"));
    try {
      const staged = stageWorkflowRunManifest({
        loopsDataDir: root,
        workflowRunId: "wfr-2",
        workflowId: "wf-2",
        workflowName: "discarded",
        payload: {},
      });
      discardWorkflowRunManifest(staged);
      expect(existsSync(staged.tmpPath)).toBe(false);
      expect(existsSync(staged.manifestPath)).toBe(false);
      // The per-run directory staged for a run id that never got a DB row is
      // pruned too — discards must not leak empty runs/.../<runId>/ dirs.
      expect(existsSync(dirname(staged.manifestPath))).toBe(false);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("discard keeps a per-run directory that already holds other artifacts", () => {
    const root = mkdtempSync(join(tmpdir(), "loops-artifacts-discard-keep-"));
    try {
      const staged = stageWorkflowRunManifest({
        loopsDataDir: root,
        workflowRunId: "wfr-2b",
        workflowId: "wf-2b",
        workflowName: "discarded-with-artifacts",
        payload: {},
      });
      const runDir = dirname(staged.manifestPath);
      writeFileSync(join(runDir, "notes.txt"), "artifact");
      discardWorkflowRunManifest(staged);
      expect(existsSync(staged.tmpPath)).toBe(false);
      expect(existsSync(runDir)).toBe(true);
      expect(existsSync(join(runDir, "notes.txt"))).toBe(true);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("writeWorkflowRunManifest stages and commits in one call", () => {
    const root = mkdtempSync(join(tmpdir(), "loops-artifacts-write-"));
    try {
      const path = writeWorkflowRunManifest({
        loopsDataDir: root,
        workflowRunId: "wfr-3",
        workflowId: "wf-3",
        workflowName: "oneshot",
        payload: {},
      });
      expect(existsSync(path)).toBe(true);
      expect(existsSync(`${path}.tmp`)).toBe(false);
      expect(JSON.parse(readFileSync(path, "utf8")).projectSlug).toBe("global");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
