import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { packMessagePreviewPage } from "../lib/message-previews.js";
import { STORE_SELECTING_KEYS } from "../lib/store/isolated-test-env.js";

const CLI = ["bun", "run", "./src/cli/index.tsx"];
const TIMEZONE_BEARING_ISO =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}(?:Z|[+-]\d{2}:\d{2})$/;

function cloudChildEnv(url: string): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined && !STORE_SELECTING_KEYS.includes(key)) env[key] = value;
  }
  env.HASNA_CONVERSATIONS_API_URL = url;
  env.HASNA_CONVERSATIONS_API_KEY = ["fixture", "not", "a", "credential"].join("-");
  env.CONVERSATIONS_AGENT_ID = "since-cloud-e2e";
  env.FORCE_COLOR = "0";
  return env;
}

async function runCli(args: string[], env: Record<string, string>) {
  const proc = Bun.spawn({
    cmd: [...CLI, ...args],
    cwd: process.cwd(),
    env,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [exitCode, stdout, stderr] = await Promise.all([
    proc.exited,
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);
  return { exitCode, stdout, stderr };
}

describe("top-level since cloud request (e2e)", () => {
  let server: ReturnType<typeof Bun.serve>;
  let env: Record<string, string>;
  let capturedSince: string | null = null;

  beforeAll(() => {
    server = Bun.serve({
      port: 0,
      hostname: "127.0.0.1",
      fetch(request) {
        const url = new URL(request.url);
        if (request.method === "GET" && url.pathname === "/v1/messages") {
          capturedSince = url.searchParams.get("since");
          return Response.json(packMessagePreviewPage([], {
            limit: url.searchParams.get("limit"),
            cursor: url.searchParams.get("cursor"),
          }));
        }
        return Response.json({ error: "Not found" }, { status: 404 });
      },
    });
    env = cloudChildEnv(`http://127.0.0.1:${server.port}`);
  });

  afterAll(() => {
    server?.stop(true);
  });

  test("sends a timezone-bearing absolute ISO cutoff", async () => {
    const result = await runCli(["since", "3m", "--limit", "1", "--json"], env);

    expect(result.exitCode, result.stderr).toBe(0);
    expect(JSON.parse(result.stdout)).toEqual([]);
    expect(capturedSince).toMatch(TIMEZONE_BEARING_ISO);
  });
});
