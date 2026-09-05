import { describe, expect, test } from "bun:test";
import { fileURLToPath } from "node:url";
import { withoutUnhostedNotice } from "../testing/spawn-env.js";

describe("installed Conversations producer authority compatibility", () => {
  test("accepts canonical forward/inverse receipts and rejects cross-project reuse", async () => {
    const fixture = fileURLToPath(new URL(
      "../../fixtures/project-resource-link-producer-verifier.installed-authority.ts",
      import.meta.url,
    ));
    const child = Bun.spawn(["bun", fixture], {
      cwd: process.cwd(),
      env: process.env,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
      child.exited,
    ]);

    expect(withoutUnhostedNotice(stderr)).toBe("");
    expect(exitCode).toBe(0);
    expect(stdout).toContain(
      "INSTALLED_AUTHORITY_FORWARD=projects.production-producer-authority-readback.v1",
    );
    expect(stdout).toContain("INSTALLED_AUTHORITY_PROJECT_ISOLATION=PASS:");
    expect(stdout).toContain(
      "INSTALLED_AUTHORITY_INVERSE=projects.production-producer-authority-readback.v1",
    );
  });
});
