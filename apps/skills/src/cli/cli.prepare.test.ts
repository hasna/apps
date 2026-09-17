import { describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runCliInCwd } from "./cli.test-utils.js";
import { useDefaultTestTimeout } from "../test-preload.js";

useDefaultTestTimeout();

describe("explicit skill authoring preparation", () => {
  test("new records the selected executable kind", async () => {
    const home = mkdtempSync(join(tmpdir(), "skills-author-kind-"));
    try {
      const result = await runCliInCwd(["new", "fixture-executable", "--json"], home, { HOME: home });
      expect(result.exitCode).toBe(0);
      const created = JSON.parse(result.stdout);
      expect(created.manifest.kind).toBe("executable");
      expect(JSON.parse(readFileSync(join(created.path, "skill.json"), "utf8")).kind).toBe("executable");
    } finally { rmSync(home, { recursive: true, force: true }); }
  });

  test("edit, dry-run, prepare and validate preserve the prose and declared instruction kind", async () => {
    const home = mkdtempSync(join(tmpdir(), "skills-author-prepare-"));
    try {
      const env = { HOME: home };
      const created = await runCliInCwd(["create", "fixture-instruction", "--kind", "instruction", "--json"], home, env);
      expect(created.exitCode).toBe(0);
      const directory = join(home, ".hasna", "skills", "installed", "fixture-instruction");
      const manifestPath = join(directory, "skill.json"), documentPath = join(directory, "SKILL.md");
      const document = readFileSync(documentPath, "utf8") + "\nReviewed authoring example.\n";
      writeFileSync(documentPath, document);
      const before = readFileSync(manifestPath, "utf8");
      const invalid = await runCliInCwd(["validate", "fixture-instruction", "--json"], home, env);
      expect(invalid.exitCode).toBe(1);
      expect(JSON.parse(invalid.stdout).issues.some((issue: { code: string }) => issue.code === "contract.content_hash_mismatch")).toBe(true);

      const preview = await runCliInCwd(["prepare", "fixture-instruction", "--version", "0.2.0", "--dry-run", "--json"], home, env);
      expect(preview.exitCode).toBe(0);
      expect(JSON.parse(preview.stdout)).toMatchObject({ name: "fixture-instruction", version: "0.2.0", kind: "instruction", changed: true, written: false });
      expect(readFileSync(manifestPath, "utf8")).toBe(before);
      expect(readFileSync(documentPath, "utf8")).toBe(document);

      const prepared = await runCliInCwd(["prepare", "fixture-instruction", "--version", "0.2.0", "--json"], home, env);
      expect(prepared.exitCode).toBe(0);
      expect(JSON.parse(prepared.stdout)).toMatchObject({ version: "0.2.0", kind: "instruction", changed: true, written: true });
      expect(readFileSync(documentPath, "utf8")).toBe(document);
      const valid = await runCliInCwd(["validate", "fixture-instruction", "--json"], home, env);
      expect(valid.exitCode).toBe(0);
      const again = await runCliInCwd(["prepare", "fixture-instruction", "--version", "0.2.0", "--json"], home, env);
      expect(again.exitCode).toBe(0);
      expect(JSON.parse(again.stdout)).toMatchObject({ changed: false, written: false });
    } finally { rmSync(home, { recursive: true, force: true }); }
  });
});
