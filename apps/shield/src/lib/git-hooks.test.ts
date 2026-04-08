import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { execFileSync } from "child_process";
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { installPrePushHook } from "./git-hooks.js";

describe("git hooks", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "security-hooks-"));
    execFileSync("git", ["init"], { cwd: tempDir, encoding: "utf-8" });
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  test("installPrePushHook writes a managed hook", () => {
    const result = installPrePushHook(tempDir);
    const contents = readFileSync(result.hookPath, "utf-8");

    expect(result.installed).toBe(true);
    expect(contents).toContain("managed-by-open-security");
    expect(contents).toContain("security secrets . --format terminal --fail-on high --no-git-history");
    expect(contents).toContain("bun run ./dist/cli/index.js secrets . --format terminal --fail-on high --no-git-history");
    expect(contents).toContain("bun run ./src/cli/index.tsx secrets . --format terminal --fail-on high --no-git-history");
    expect(statSync(result.hookPath).mode & 0o111).toBeGreaterThan(0);
  });

  test("installPrePushHook does not overwrite an unmanaged hook without force", () => {
    const hookPath = join(tempDir, ".git", "hooks", "pre-push");
    writeFileSync(hookPath, "#!/usr/bin/env bash\necho custom\n", "utf-8");

    const result = installPrePushHook(tempDir);
    expect(result.installed).toBe(false);
    expect(result.skipped).toBe(true);
    expect(result.reason).toContain("--force-hook");
    expect(readFileSync(hookPath, "utf-8")).toContain("echo custom");
  });

  test("installPrePushHook overwrites an unmanaged hook with force", () => {
    const hookPath = join(tempDir, ".git", "hooks", "pre-push");
    writeFileSync(hookPath, "#!/usr/bin/env bash\necho custom\n", "utf-8");

    const result = installPrePushHook(tempDir, { force: true });
    expect(result.installed).toBe(true);
    expect(result.skipped).toBe(false);
    expect(readFileSync(hookPath, "utf-8")).toContain("managed-by-open-security");
  });
});
