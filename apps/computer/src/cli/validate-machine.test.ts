import { describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "../..");

function runCli(args: string[]) {
  return spawnSync("bun", ["src/cli/index.ts", ...args], {
    cwd: repoRoot,
    encoding: "utf8",
    env: {
      ...process.env,
      COMPUTER_DB_PATH: join(repoRoot, ".tmp-validate-machine.db"),
    },
  });
}

describe("computer validate-machine CLI", () => {
  test("emits packaged installed-smoke JSON with explicit readiness", () => {
    const result = runCli(["validate-machine", "--json", "--allow-failures", "--skip-screenshot"]);

    expect(result.status).toBe(0);
    const payload = JSON.parse(result.stdout) as {
      schema_version: string;
      package: { name: string };
      checks: Array<{ id: string; status: string }>;
      readiness: { ready: boolean; blockers: string[] };
    };

    expect(payload.schema_version).toBe("open-computer.installed-machine-smoke.v1");
    expect(payload.package.name).toBe("@hasna/computer");
    expect(payload.checks.some((check) => check.id === "local-headless-status")).toBe(true);
    expect(payload.checks.some((check) => check.id === "app-drivers")).toBe(true);
    expect(payload.checks).toContainEqual(expect.objectContaining({ id: "native-tools", status: "passed" }));
    expect(payload.checks).toContainEqual(expect.objectContaining({ id: "packaged-helpers", status: "passed" }));
    expect(payload.checks).toContainEqual(expect.objectContaining({ id: "local-screenshot", status: "skipped" }));
    expect(payload.readiness.ready).toBe(false);
    expect(payload.readiness.blockers.length).toBeGreaterThan(0);
  });

  test("help advertises the validation command", () => {
    const result = runCli(["--help"]);

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("validate-machine");
  });

  test("screenshot reports platform unavailability without a stack trace", () => {
    const result = runCli(["screenshot"]);

    if (process.platform === "darwin") {
      expect(result.status).toBe(0);
      expect(result.stdout).toContain("Screenshot");
      return;
    }

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("Screenshot capture is unavailable on this platform.");
    expect(result.stderr).not.toContain("Bun v");
    expect(result.stderr).not.toContain("at captureScreenshot");
  });
});
