import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

function runFixture(source: string, timeoutMs?: number, env: Record<string, string | undefined> = process.env) {
  const dir = mkdtempSync(join(tmpdir(), "machines-test-budget-"));
  const fixture = join(dir, "fixture.test.ts");
  writeFileSync(fixture, source);
  const args = ["test"];
  if (timeoutMs !== undefined) args.push("--timeout", String(timeoutMs));
  args.push(fixture);
  const startedAt = performance.now();
  try {
    const result = Bun.spawnSync([process.execPath, ...args], {
      cwd: process.cwd(),
      env,
      stdout: "pipe",
      stderr: "pipe",
      timeout: 8_000,
    });
    return {
      elapsedMs: performance.now() - startedAt,
      exitCode: result.exitCode,
      stderr: result.stderr.toString(),
    };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

describe("shared test harness budget", () => {
  test("keeps the canonical repository test command finite", () => {
    const packageJson = JSON.parse(
      readFileSync(new URL("../package.json", import.meta.url), "utf8"),
    ) as { scripts?: Record<string, string> };
    expect(packageJson.scripts?.test).toBe("bun test --timeout 10000");
    expect(packageJson.scripts?.["verify:release"]).toContain("bun run test");
  });

  test("isolates the suite from an incompatible operator manifest", () => {
    const operatorHome = mkdtempSync(join(tmpdir(), "machines-operator-home-"));
    const operatorData = join(operatorHome, ".hasna", "machines");
    mkdirSync(operatorData, { recursive: true });
    writeFileSync(join(operatorData, "machines.json"), JSON.stringify({
      version: 1,
      machines: [{
        id: "operator-machine",
        platform: "linux",
        workspacePath: "/srv/operator",
        heartbeatAliases: ["legacy-alias"],
      }],
    }));

    const env = { ...process.env, HOME: operatorHome };
    delete env.HASNA_MACHINES_DIR;
    delete env.HASNA_MACHINES_DB_PATH;
    delete env.HASNA_MACHINES_MANIFEST_PATH;
    delete env.HASNA_MACHINES_NOTIFICATIONS_PATH;
    const serveModule = new URL("../src/commands/serve.ts", import.meta.url).href;

    try {
      const result = runFixture(
        `import { expect, test } from "bun:test";
import { renderDashboardHtml } from ${JSON.stringify(serveModule)};
test("renders from isolated state", () => {
  expect(renderDashboardHtml()).toContain("<title>Machines Dashboard</title>");
});`,
        undefined,
        env,
      );
      expect(result.exitCode).toBe(0);
    } finally {
      rmSync(operatorHome, { recursive: true, force: true });
    }
  });

  test("an explicit timeout still fails a hanging test promptly", () => {
    const result = runFixture(
      `import { test } from "bun:test";
test("deliberate hang", () => new Promise(() => {}));`,
      100,
    );
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("timed out after 100ms");
    expect(result.elapsedMs).toBeLessThan(6_000);
  });

  test("an immediate assertion failure is not delayed by the integration budget", () => {
    const result = runFixture(
      `import { expect, test } from "bun:test";
test("deliberate fast failure", () => expect("actual").toBe("expected"));`,
    );
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("deliberate fast failure");
    expect(result.elapsedMs).toBeLessThan(2_500);
  });

  test("allows a legitimate process integration path beyond Bun's 5s default", async () => {
    const child = Bun.spawn(["bash", "-lc", "sleep 5.2"], {
      stdout: "ignore",
      stderr: "ignore",
    });
    expect(await child.exited).toBe(0);
  });
});
