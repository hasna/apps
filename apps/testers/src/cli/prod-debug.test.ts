import { describe, expect, test } from "bun:test";
import { spawnSync } from "bun";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

describe("testers prod-debug CLI", () => {
  test("prints a safe JSON plan and redacts sensitive URL params", () => {
    const proc = spawnSync({
      cmd: [
        "bun",
        "run",
        "src/cli/index.tsx",
        "prod-debug",
        "https://alumia.com/andrei/projects/prkps88yh4ky?code=secret-oauth-code&agent=8510a9f7-9d91-41e7-ba0f-cecb17b9b929",
        "--json",
        "--reason",
        "prod auth bug",
      ],
      env: { ...process.env, TESTERS_DB_PATH: ":memory:" },
      stdout: "pipe",
      stderr: "pipe",
    });

    expect(proc.exitCode).toBe(0);
    const output = proc.stdout.toString();
    expect(output).not.toContain("secret-oauth-code");
    const plan = JSON.parse(output);
    expect(plan.target.orgSlug).toBe("andrei");
    expect(plan.target.projectRef).toBe("prkps88yh4ky");
    expect(plan.supportAccess.browserReady).toBe(false);
    expect(plan.blocked.join("\n")).toContain("No audited support browser/session grant");
  });

  test("loads generic prod-debug app profiles from config", () => {
    const dir = mkdtempSync(join(tmpdir(), "testers-prod-debug-"));
    try {
      writeFileSync(join(dir, "config.json"), JSON.stringify({
        prodDebug: {
          apps: {
            demo: {
              origins: ["https://demo.example.com"],
              supportGrantRef: "$TESTERS_SUPPORT_GRANT",
              supportUrlTemplate: "https://support.demo.example.com/session?grant={supportGrant}&target={targetUrlEncoded}",
            },
          },
        },
      }));

      const proc = spawnSync({
        cmd: [
          "bun",
          "run",
          "src/cli/index.tsx",
          "prod-debug",
          "https://demo.example.com/acme/projects/proj-1",
          "--json",
        ],
        env: {
          ...process.env,
          HASNA_TESTERS_DIR: dir,
          TESTERS_DB_PATH: ":memory:",
          TESTERS_SUPPORT_GRANT: "grant-secret-value",
        },
        stdout: "pipe",
        stderr: "pipe",
      });

      expect(proc.exitCode).toBe(0);
      const output = proc.stdout.toString();
      expect(output).not.toContain("grant-secret-value");
      const plan = JSON.parse(output);
      expect(plan.setup.profile).toBe("demo");
      expect(plan.supportAccess.browserReady).toBe(true);
      expect(plan.supportAccess.grantId).toBe("[configured]");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
