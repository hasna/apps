import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "bun:test";
import type { Loop } from "../types.js";

const cliPath = join(dirname(fileURLToPath(import.meta.url)), "index.ts");

interface CliResult {
  status: number;
  stdout: string;
  stderr: string;
}

async function runCli(
  dataDir: string,
  args: string[],
  env: Record<string, string> = {},
): Promise<CliResult> {
  const child = Bun.spawn([process.execPath, cliPath, ...args], {
    env: {
      ...process.env,
      HOME: dataDir,
      HASNA_LOOPS_API_URL: "",
      HASNA_LOOPS_API_KEY: "",
      LOOPS_DATA_DIR: dataDir,
      ...env,
    },
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, status] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);
  return { status, stdout, stderr };
}

function hostedLoop(overrides: Partial<Loop> & Pick<Loop, "id" | "name">): Loop {
  return {
    labels: [],
    status: "active",
    schedule: { type: "every", every: "5m" },
    target: { type: "command", command: "true" },
    nextRunAt: "2099-01-01T00:00:00.000Z",
    createdAt: "2020-01-01T00:00:00.000Z",
    updatedAt: "2020-01-01T00:00:00.000Z",
    ...overrides,
  } as Loop;
}

function hostedEnv(port: number): Record<string, string> {
  return {
    HASNA_LOOPS_API_URL: `http://127.0.0.1:${port}`,
    HASNA_LOOPS_API_KEY: "test-hosted-key",
  };
}

describe("hosted run-now (1fb09589)", () => {
  test("loops run-now schedules the loop due now through the hosted API instead of refusing", async () => {
    const dataDir = mkdtempSync(join(tmpdir(), "loops-hosted-run-now-"));
    const loop = hostedLoop({ id: "loop-run-now", name: "loop-run-now", status: "paused" });
    const scheduledFor = "2026-08-18T12:00:00.000Z";
    const paths: string[] = [];
    const server = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      fetch(request) {
        const url = new URL(request.url);
        paths.push(`${request.method} ${url.pathname}`);
        if (request.method === "GET" && url.pathname === `/v1/loops/${loop.id}`) {
          return Response.json({ ok: true, loop });
        }
        if (request.method === "POST" && url.pathname === `/v1/loops/${loop.id}/run-now`) {
          return Response.json({
            ok: true,
            loop: { ...loop, status: "active", nextRunAt: scheduledFor },
            scheduledFor,
          });
        }
        return Response.json({ ok: false, error: "not_found" }, { status: 404 });
      },
    });

    try {
      const result = await runCli(dataDir, ["--json", "run-now", loop.id], hostedEnv(server.port as number));
      // The CLI must use the hosted route: no local-only refusal, no local sqlite touch.
      expect(result.status).toBe(0);
      expect(result.stderr).not.toContain("not available while flipped");
      const value = JSON.parse(result.stdout) as {
        loop: { id: string; status: string; nextRunAt?: string };
        scheduledFor: string;
        runNow: { source: string; advancesLoop: boolean };
      };
      expect(value.loop.id).toBe(loop.id);
      expect(value.loop.status).toBe("active");
      expect(value.scheduledFor).toBe(scheduledFor);
      expect(value.loop.nextRunAt).toBe(scheduledFor);
      expect(value.runNow.source).toBe("hosted");
      expect(value.runNow.advancesLoop).toBe(false);
      // It really reached the control plane rather than a local island.
      expect(paths).toContain(`POST /v1/loops/${loop.id}/run-now`);
      expect(result.stdout).not.toContain("test-hosted-key");
    } finally {
      server.stop(true);
      rmSync(dataDir, { recursive: true, force: true });
    }
  });
});
