import { expect, test } from "bun:test";
import { join } from "node:path";

test("Emails OCI migration admission refuses drift before AWS mutations", () => {
  const result = Bun.spawnSync(["python3", "-I", "-B", "tooling/deploy/emails-current/migration_admission_test.py"], {
    cwd: join(import.meta.dir, "../../../.."),
    timeout: 30_000,
  });
  expect(new TextDecoder().decode(result.stderr)).toContain("OK");
  expect(result.exitCode).toBe(0);
}, 30_000);
