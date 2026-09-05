import { todosLocalModeNotice } from "./stage-a.js";
import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { projectExternalBunDuplicatePackageWarning } from "../test/bun-fixture-isolation.js";
import { deliverTodosApiKeyViaDisk } from "../testing.js";

const REPO_ROOT = join(import.meta.dir, "../..");
const tempRoots: string[] = [];

type CliResult = {
  exitCode: number;
  stdout: string;
  stderr: string;
};

async function runCli(
  args: string[],
  env: Record<string, string>,
  cwd: string,
): Promise<CliResult> {
  const proc = Bun.spawn(
    ["bun", "run", join(REPO_ROOT, "src/cli/index.tsx"), ...args],
    {
      cwd,
      env,
      stdout: "pipe",
      stderr: "pipe",
    },
  );
  const stdout = await new Response(proc.stdout).text();
  const stderr = await new Response(proc.stderr).text();
  const projected = projectExternalBunDuplicatePackageWarning(stderr);
  return { exitCode: await proc.exited, stdout, stderr: projected.stderr };
}

afterEach(() => {
  for (const root of tempRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe("local-only commands with hosted routing configured", () => {
  test("redaction executes locally while remote-supported status stays on HTTP", async () => {
    const requests: string[] = [];
    const server = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      fetch(request) {
        const url = new URL(request.url);
        requests.push(`${request.method} ${url.pathname}`);
        if (url.pathname === "/v1/stats") {
          return Response.json({ tasks: 0, projects: 0 });
        }
        if (url.pathname === "/v1/tasks") {
          return Response.json({ tasks: [], count: 0, total: 0 });
        }
        return Response.json({ error: "fixture route missing" }, { status: 404 });
      },
    });

    const root = mkdtempSync(join(tmpdir(), "todos-local-only-routing-"));
    tempRoots.push(root);
    const cwd = join(root, "cwd");
    const home = join(root, "home");
    mkdirSync(cwd);
    mkdirSync(home);
    const positiveFixture = join(root, "positive.diff");
    const negativeFixture = join(root, "negative.diff");
    writeFileSync(positiveFixture, "+SAFE-REDACTION-FIXTURE-1234\n");
    writeFileSync(negativeFixture, "+ordinary staged diff text\n");

    const env = deliverTodosApiKeyViaDisk({
      PATH: process.env.PATH ?? "",
      BUN_INSTALL: process.env.BUN_INSTALL ?? join(process.env.HOME ?? "/home/hasna", ".bun"),
      HOME: home,
      TMPDIR: root,
      LANG: "C.UTF-8",
      TODOS_DB_PATH: ":memory:",
      TODOS_AUTO_PROJECT: "false",
      HASNA_TODOS_API_URL: `http://127.0.0.1:${server.port}`,
      HASNA_TODOS_API_KEY: "[REDACTED_SECRET]",
});

    try {
      const configured = await runCli([
        "--json",
        "redaction",
        "add",
        "--pattern",
        "SAFE-REDACTION-FIXTURE-[0-9]{4}",
      ], env, cwd);
      // A local run is never silent about being local (hasna/apps#1720): with a
      // hosted authority configured, a local-only command that said nothing
      // would look exactly like a hosted read of an empty store. The notice is
      // the whole stderr — nothing else is emitted — and it goes to stderr so
      // the `--json` document on stdout stays parseable.
      expect({ exitCode: configured.exitCode, stderr: configured.stderr.trim() }).toEqual({
        exitCode: 0,
        stderr: todosLocalModeNotice("local-only-command"),
      });
      expect(JSON.parse(configured.stdout).redaction_patterns).toContain(
        "SAFE-REDACTION-FIXTURE-[0-9]{4}",
      );

      const configPath = join(home, ".hasna", "todos", "config.json");
      expect(existsSync(configPath)).toBe(true);
      expect(readFileSync(configPath, "utf8")).toContain(
        "SAFE-REDACTION-FIXTURE-[0-9]{4}",
      );

      const positive = await runCli([
        "redaction",
        "scan",
        "--file",
        positiveFixture,
        "--json",
      ], env, cwd);
      expect({ exitCode: positive.exitCode, stderr: positive.stderr.trim() }).toEqual({
        exitCode: 0,
        stderr: todosLocalModeNotice("local-only-command"),
      });
      expect(JSON.parse(positive.stdout)).toEqual({
        ok: false,
        findings: [
          {
            pattern: "custom:SAFE-REDACTION-FIXTURE-[0-9]{4}",
            count: 1,
          },
        ],
      });
      expect(positive.stdout).not.toContain("SAFE-REDACTION-FIXTURE-1234");

      const negative = await runCli([
        "redaction",
        "scan",
        "--file",
        negativeFixture,
        "--json",
      ], env, cwd);
      expect({ exitCode: negative.exitCode, stderr: negative.stderr.trim() }).toEqual({
        exitCode: 0,
        stderr: todosLocalModeNotice("local-only-command"),
      });
      expect(JSON.parse(negative.stdout)).toEqual({ ok: true, findings: [] });

      expect(requests).toEqual([]);

      const status = await runCli(["status", "--json"], env, cwd);
      expect({ exitCode: status.exitCode, stderr: status.stderr }).toEqual({
        exitCode: 0,
        stderr: "",
      });
      expect(JSON.parse(status.stdout)).toMatchObject({
        source: "cloud",
        transport: "http-v1",
      });
      expect(requests[0]).toBe("GET /v1/stats");
      expect(requests.slice(1).length).toBeGreaterThan(0);
      expect(requests.slice(1).every((request) => request === "GET /v1/tasks")).toBe(true);
    } finally {
      server.stop(true);
    }
  });
});
