import { describe, expect, test } from "bun:test";
import { cpSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative, sep } from "node:path";

const repoRoot = join(import.meta.dir, "..");

describe("contract gap ratchet", () => {
  test("fails when the storage validation failure changes without changing its check id", () => {
    const parent = mkdtempSync(join(tmpdir(), "feedback-contract-gap-test-"));
    const workspace = join(parent, "repo");

    try {
      cpSync(repoRoot, workspace, {
        recursive: true,
        filter(source) {
          const firstSegment = relative(repoRoot, source).split(sep)[0];
          return ![".git", "dist", "node_modules"].includes(firstSegment ?? "");
        },
      });
      symlinkSync(join(repoRoot, "node_modules"), join(workspace, "node_modules"), "dir");

      const manifestPath = join(workspace, "hasna.contract.json");
      const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
      manifest.storage = {
        mode: "sqlite",
        engines: ["sqlite"],
        sqlitePath: "~/.hasna/feedback/feedback.db",
      };
      writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);

      const result = Bun.spawnSync(["bun", "scripts/check-contract-gap.ts"], {
        cwd: workspace,
        stdout: "pipe",
        stderr: "pipe",
      });
      const output = `${new TextDecoder().decode(result.stdout)}${new TextDecoder().decode(result.stderr)}`;

      expect(result.exitCode).toBe(1);
      expect(output).toContain("manifest_valid");
    } finally {
      rmSync(parent, { recursive: true, force: true });
    }
  });
});
