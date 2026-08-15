import { describe, expect, test, afterEach } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/**
 * Regression for todos task 2984bf26.
 *
 * `template-import` sends the parsed JSON file straight to POST /v1/templates
 * with no client-side transformation. When the server's schema rejects it (a
 * template task object missing `title_pattern`, an unknown field, etc.) it
 * replies 400 with a body shaped `{"error": "<specific reason>"}` — a
 * `HasnaHttpError` whose `.body` carries that reason.
 *
 * `handleError` (src/cli/helpers.ts) previously printed ONLY `e.message`,
 * which for a `HasnaHttpError` is the generic
 * "Hasna cloud request failed: POST /templates -> 400" — discarding the one
 * piece of information that explains WHY the import was rejected. That made a
 * legitimate, well-formed server rejection indistinguishable from an outage,
 * and cost multiple drivers a fix-on-sight investigation before the real
 * server response was ever read (via a raw curl, bypassing the CLI).
 *
 * This test asserts the SPECIFIC server-provided reason reaches the user —
 * on stderr for humans, and in the `{"error": ...}` envelope for --json
 * callers — not merely that some error is reported.
 */

const REPO_ROOT = join(import.meta.dir, "../..");
const TEST_API_KEY = "hasna_todos_test_key";
const tempRoots: string[] = [];

afterEach(() => {
  for (const root of tempRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

async function runCli(args: string[], root: string, baseUrl: string) {
  const proc = Bun.spawn(["bun", "run", "src/cli/index.tsx", ...args], {
    cwd: REPO_ROOT,
    env: {
      PATH: process.env.PATH ?? "",
      HOME: root,
      TMPDIR: root,
      LANG: "C.UTF-8",
      TODOS_DB_PATH: join(root, "todos.db"),
      TODOS_AUTO_PROJECT: "false",
      HASNA_TODOS_STORAGE_MODE: "self_hosted",
      HASNA_TODOS_API_URL: baseUrl,
      HASNA_TODOS_API_KEY: TEST_API_KEY,
    },
    stdout: "pipe",
    stderr: "pipe",
  });
  const stdout = await new Response(proc.stdout).text();
  const stderr = await new Response(proc.stderr).text();
  return { exitCode: await proc.exited, stdout, stderr };
}

describe("template-import surfaces the server's own 400 reason", () => {
  test("a malformed task object's rejection reason reaches stderr, not just the status code", async () => {
    const server = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      async fetch(request) {
        const url = new URL(request.url);
        if (url.pathname === "/v1/templates" && request.method === "POST") {
          // Mirrors the real /v1 server's validateTemplateCreate() reply for a
          // task object that fails validateTemplateTask() — e.g. one using
          // `title` instead of the required `title_pattern`.
          return Response.json({ error: "tasks must be valid template task objects" }, { status: 400 });
        }
        return Response.json({ error: "not found" }, { status: 404 });
      },
    });
    const root = mkdtempSync(join(tmpdir(), "todos-template-import-error-"));
    tempRoots.push(root);
    const templateFile = join(root, "bad-template.json");
    writeFileSync(
      templateFile,
      JSON.stringify({
        name: "bad-template",
        title_pattern: "does not matter",
        tasks: [{ title: "wrong field name" }],
      }),
    );
    try {
      const result = await runCli(["template-import", templateFile], root, `http://127.0.0.1:${server.port}`);
      expect(result.exitCode).not.toBe(0);
      // The old failure mode: stderr contained only the generic transport
      // message and never the word "tasks" or "title_pattern" at all.
      expect(result.stderr).toContain("tasks must be valid template task objects");
    } finally {
      server.stop(true);
    }
  });

  test("the same reason reaches the --json error envelope for machine callers", async () => {
    const server = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      async fetch(request) {
        const url = new URL(request.url);
        if (url.pathname === "/v1/templates" && request.method === "POST") {
          return Response.json({ error: "tasks must be valid template task objects" }, { status: 400 });
        }
        return Response.json({ error: "not found" }, { status: 404 });
      },
    });
    const root = mkdtempSync(join(tmpdir(), "todos-template-import-error-json-"));
    tempRoots.push(root);
    const templateFile = join(root, "bad-template.json");
    writeFileSync(
      templateFile,
      JSON.stringify({
        name: "bad-template",
        title_pattern: "does not matter",
        tasks: [{ title: "wrong field name" }],
      }),
    );
    try {
      const result = await runCli(["--json", "template-import", templateFile], root, `http://127.0.0.1:${server.port}`);
      expect(result.exitCode).not.toBe(0);
      const parsed = JSON.parse(result.stdout);
      expect(parsed.error).toContain("tasks must be valid template task objects");
    } finally {
      server.stop(true);
    }
  });
});
