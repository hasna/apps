import { expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

test("companion staging copies CLI sources without touching the live Swift build tree", () => {
  const root = mkdtempSync(join(tmpdir(), "recordings-staging-test-"));
  try {
    const source = join(root, "source");
    const staged = join(root, "staged");
    mkdirSync(join(source, "src/cli"), { recursive: true });
    mkdirSync(join(source, "src/native/Recordings/.build"), { recursive: true });
    mkdirSync(join(source, "migrations"));
    mkdirSync(staged);
    writeFileSync(join(source, "src/cli/index.ts"), "export const cli = true;");
    writeFileSync(join(source, "src/version.ts"), "export const version = 'test';");
    writeFileSync(join(source, "src/native/Recordings/.build/cache"), "changing Swift cache");
    writeFileSync(join(source, "migrations/schema.sql"), "SELECT 1;");

    // Execute the actual staging block, including its real copy commands. No build or
    // dependency resolver is needed to exercise which source trees it traverses.
    const script = readFileSync("scripts/build_companion_cli.sh", "utf8");
    const manifestCopy = script.indexOf('"$CP_EXECUTABLE" "$ROOT/package.json"');
    const start = script.indexOf("\n", manifestCopy) + 1;
    const end = script.indexOf("\nrun_bun() {");
    expect(manifestCopy).toBeGreaterThan(0);
    expect(end).toBeGreaterThan(start);
    const result = spawnSync("/bin/bash", ["-euc", script.slice(start, end)], {
      env: { ...process.env, ROOT: source, STAGED_ROOT: staged, CP_EXECUTABLE: "/bin/cp", MKDIR_EXECUTABLE: "/bin/mkdir" },
      encoding: "utf8",
      timeout: 10_000,
    });
    expect(result.status, result.stderr).toBe(0);
    expect(readFileSync(join(staged, "src/cli/index.ts"), "utf8")).toBe("export const cli = true;");
    expect(readFileSync(join(staged, "src/version.ts"), "utf8")).toBe("export const version = 'test';");
    expect(readFileSync(join(staged, "migrations/schema.sql"), "utf8")).toBe("SELECT 1;");
    expect(existsSync(join(staged, "src/native"))).toBe(false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
