#!/usr/bin/env bun
import { mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { isolatedInstructionsTestEnv } from "../src/test-support/environment.js";

// Isolate before Bun starts or reads a user config, not only after test imports.
const home = mkdtempSync(join(realpathSync(tmpdir()), "instructions-test-run-"));
try {
  const child = Bun.spawn([process.execPath, "--no-env-file", "test", "--timeout", "120000", ...process.argv.slice(2)], {
    cwd: join(import.meta.dir, ".."),
    env: isolatedInstructionsTestEnv(home),
    stdin: "inherit", stdout: "inherit", stderr: "inherit",
  });
  process.exitCode = await child.exited;
} finally {
  rmSync(home, { recursive: true, force: true });
}
