import { expect, test } from "bun:test";
import { resolve } from "node:path";
import { useDefaultTestTimeout } from "../test-preload.js";
useDefaultTestTimeout();

test("the repository content gate rejects payloads and accepts public software", () => {
  const root = resolve(import.meta.dir, "../../../..");
  const result = Bun.spawnSync([process.execPath, "tooling/ci/check-skill-content.ts", "--self-test"], { cwd: root });
  expect(result.exitCode).toBe(0);
  expect(result.stdout.toString()).toContain("software accepted, payloads rejected");
});

test("the legacy drift command invokes the content boundary instead of expecting a bundled corpus", () => {
  const root = resolve(import.meta.dir, "../..");
  const result = Bun.spawnSync(["bash", "scripts/check_skill_corpus_drift.sh", "--base", "HEAD"], { cwd: root });
  expect(result.exitCode).toBe(0);
  expect(result.stdout.toString()).toContain("no tracked skill payloads");
});
