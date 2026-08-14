import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createBunPackageIsolatedTempDir,
  projectExternalBunDuplicatePackageWarning,
} from "./bun-fixture-isolation.js";

function runBunEval(cwd: string, source: string): { exitCode: number | null; stderr: string; stdout: string } {
  const proc = Bun.spawnSync([process.execPath, "--eval", source], {
    cwd,
    stdout: "pipe",
    stderr: "pipe",
  });
  return {
    exitCode: proc.exitCode,
    stderr: proc.stderr.toString(),
    stdout: proc.stdout.toString(),
  };
}

describe("Bun fixture package isolation", () => {
  test("projects the external temp ancestor warning while preserving real stderr exactly", () => {
    const contaminated = mkdtempSync(join(tmpdir(), "todos-bun-contaminated-"));
    let safeRoot: string | null = null;
    try {
      writeFileSync(
        join(contaminated, "package.json"),
        "{\"private\":true,\"dependencies\":{\"@hasna/todos\":\"a\",\"@hasna/todos\":\"b\"}}\n",
      );
      const unsafe = join(contaminated, "unsafe", "child");
      mkdirSync(unsafe, { recursive: true });

      const unsafeResult = runBunEval(unsafe, "console.log('UNSAFE_STDOUT')");
      expect(unsafeResult.exitCode).toBe(0);
      expect(unsafeResult.stderr).toContain("warn: Duplicate key \"@hasna/todos\"");
      expect(unsafeResult.stderr).toContain(join(contaminated, "package.json"));

      safeRoot = createBunPackageIsolatedTempDir("safe-");
      const safeChild = join(safeRoot, "child");
      mkdirSync(safeChild, { recursive: true });

      const externalWarning =
        `38 |     "@hasna/todos": "/tmp/tmp.uklFn8WTDg/conflict-oss",\n` +
        `         ^\n` +
        `warn: Duplicate key "@hasna/todos" in object literal\n` +
        `   at ${join(tmpdir(), "package.json")}:38:5\n\n`;
      const projected = projectExternalBunDuplicatePackageWarning(
        `REAL_STDERR_LINE\n${externalWarning}AFTER_STDERR_LINE\n`,
      );

      expect(projected.removed).toEqual([externalWarning]);
      expect(projected.removed[0]).toBe(externalWarning);
      expect(projected.stderr).toBe("REAL_STDERR_LINE\nAFTER_STDERR_LINE\n");

      const realStderr = runBunEval(safeChild, "console.error('REAL_STDERR_LINE')");
      expect(realStderr.exitCode).toBe(0);
      const projectedRealStderr = projectExternalBunDuplicatePackageWarning(realStderr.stderr);
      expect(projectedRealStderr.stderr).toBe("REAL_STDERR_LINE\n");
      expect(projectedRealStderr.removed.join("")).not.toContain("REAL_STDERR_LINE");
      expect(realStderr.stdout).toBe("");

      const differentPath = externalWarning.replace(join(tmpdir(), "package.json"), join(contaminated, "package.json"));
      const projectedDifferentPath = projectExternalBunDuplicatePackageWarning(`REAL_STDERR_LINE\n${differentPath}`);
      expect(projectedDifferentPath.stderr).toBe(`REAL_STDERR_LINE\n${differentPath}`);
      expect(projectedDifferentPath.removed).toEqual([]);

      const differentKey = externalWarning.replaceAll("@hasna/todos", "@hasna/accounts");
      const projectedDifferentKey = projectExternalBunDuplicatePackageWarning(`REAL_STDERR_LINE\n${differentKey}`);
      expect(projectedDifferentKey.stderr).toBe(`REAL_STDERR_LINE\n${differentKey}`);
      expect(projectedDifferentKey.removed).toEqual([]);
    } finally {
      rmSync(contaminated, { recursive: true, force: true });
      if (safeRoot) rmSync(safeRoot, { recursive: true, force: true });
    }
  });
});
