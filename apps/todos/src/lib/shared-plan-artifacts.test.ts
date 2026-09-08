import { test, expect } from "bun:test";
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  renameSync,
  realpathSync,
  symlinkSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  writeSharedPlanArtifact,
  inspectSharedPlanArtifact,
} from "./shared-plan-artifacts.js";
import type { Plan } from "../types/index.js";
test("shared Markdown keeps legacy filename diagnostics and refuses directory/target symlinks", () => {
  const root = mkdtempSync(join(tmpdir(), "plan-artifacts-api-"));
  const outside = mkdtempSync(join(tmpdir(), "plan-artifacts-outside-"));
  const plan = {
    id: "12345678-abcd",
    name: "Example",
    slug: "example",
    project_id: "project-id",
    status: "active",
    created_at: "2026-01-01",
    updated_at: "2026-01-01",
  } as Plan;
  try {
    const result = writeSharedPlanArtifact(plan, [], root)!;
    expect(result.path.endsWith("example--12345678.md")).toBe(true);
    const legacy = join(root, ".hasna/todos/plans/project-id", `${plan.id}.md`);
    renameSync(result.path, legacy);
    expect(inspectSharedPlanArtifact(plan, [], root)?.path).toBe(realpathSync(legacy));
    const external = join(outside, "target.md");
    writeFileSync(external, "keep");
    symlinkSync(external, result.path);
    expect(() => writeSharedPlanArtifact(plan, [], root)).toThrow();
    expect(readFileSync(external, "utf8")).toBe("keep");
    expect(() => inspectSharedPlanArtifact(plan, [], root)).toThrow();
    rmSync(join(root, ".hasna"), { recursive: true });
    symlinkSync(outside, join(root, ".hasna"));
    expect(() => writeSharedPlanArtifact(plan, [], root)).toThrow();
  } finally {
    rmSync(root, { recursive: true, force: true });
    rmSync(outside, { recursive: true, force: true });
  }
});
