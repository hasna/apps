/**
 * Test harness for the HOSTED path of a CLI command module.
 *
 * The CLI verbs ported here are still listed as `local-only` in
 * `src/cli/stage-a.ts` (W6 owns that file), so a spawned `todos <verb>` is
 * refused before the action ever runs. That refusal is stage-a's contract, not
 * this port's: the thing that has to be proved now is that the ACTION, given a
 * hosted credential, talks to `/v1` and never opens the local store.
 *
 * So the harness registers the real command module on a fresh commander
 * program, drives it through `parseAsync` with the same global options the CLI
 * defines, and points the real credential resolver at a real `Bun.serve`
 * origin. When the stage-a entries land, the end-to-end spawn test is a
 * one-line addition on top of this.
 */
import { expect } from "bun:test";
import { Command } from "commander";
import { randomUUID } from "node:crypto";
import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export interface HostedRequest {
  method: string;
  path: string;
  query: URLSearchParams;
  body: unknown;
}

export interface HostedCommandContext {
  /** Run the CLI argv (without the `node todos` prefix) against the fixture. */
  run: (argv: string[]) => Promise<{ stdout: string; stderr: string; exitCode: number | null }>;
  requests: HostedRequest[];
  home: string;
}

type Route = (req: HostedRequest) => unknown;

/**
 * Register `register(program)` on a fresh program with a hosted credential in
 * `process.env`, run the given argv against a real `/v1` fixture origin, then
 * assert no SQLite file was created under the temp HOME.
 */
export async function withHostedCommands(
  register: (program: Command) => void,
  routes: Record<string, Route>,
  run: (ctx: HostedCommandContext) => Promise<void>,
): Promise<void> {
  const home = mkdtempSync(join(tmpdir(), "todos-hosted-cli-"));
  const requests: HostedRequest[] = [];
  const apiKey = `fixture-hosted-cli-${randomUUID()}`;
  const matchers = Object.entries(routes).map(([key, handler]) => {
    const [method, pattern] = key.split(" ", 2) as [string, string];
    const source = pattern
      .split("/")
      .map((segment) => (segment.startsWith(":") ? "([^/]+)" : segment.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")))
      .join("/");
    return { method, regex: new RegExp(`^${source}$`), handler };
  });

  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    async fetch(req) {
      expect(req.headers.get("authorization") ?? req.headers.get("x-api-key")).toContain(apiKey);
      const url = new URL(req.url);
      const body = req.method === "GET" || req.method === "DELETE" ? undefined : await req.json().catch(() => undefined);
      const entry: HostedRequest = { method: req.method, path: url.pathname, query: url.searchParams, body };
      requests.push(entry);
      for (const matcher of matchers) {
        if (matcher.method !== req.method || !matcher.regex.test(url.pathname)) continue;
        const result = matcher.handler(entry);
        if (result instanceof Response) return result;
        if (result === undefined) return new Response(null, { status: 204 });
        return Response.json(result);
      }
      return Response.json({ error: `no fixture route for ${req.method} ${url.pathname}` }, { status: 404 });
    },
  });

  const saved: Record<string, string | undefined> = {};
  const setEnv = (key: string, value: string | undefined) => {
    if (!(key in saved)) saved[key] = process.env[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  };
  for (const key of Object.keys(process.env)) {
    if (/^(HASNA_|TODOS_)/.test(key)) setEnv(key, undefined);
  }
  setEnv("HOME", home);
  setEnv("HASNA_STATION", `fixture-${randomUUID()}`);
  setEnv("HASNA_TODOS_API_URL", server.url.origin);
  setEnv("HASNA_TODOS_API_KEY", apiKey);

  const log = console.log;
  const errorLog = console.error;
  const realExit = process.exit;
  try {
    await run({
      requests,
      home,
      run: async (argv) => {
        const out: string[] = [];
        const err: string[] = [];
        let exitCode: number | null = null;
        console.log = (...args: unknown[]) => { out.push(args.map(String).join(" ")); };
        console.error = (...args: unknown[]) => { err.push(args.map(String).join(" ")); };
        // `handleError` ends the process; in-process we turn that into a throw
        // so the test can assert the refusal instead of killing the runner.
        (process as { exit: unknown }).exit = ((code?: number) => {
          exitCode = code ?? 0;
          throw new Error(`__cli_exit_${exitCode}`);
        }) as typeof process.exit;
        const program = new Command();
        program.exitOverride();
        program
          .name("todos")
          .option("-j, --json", "Output as JSON")
          .option("--project <id>", "Project")
          .option("--agent <id>", "Agent");
        register(program);
        try {
          await program.parseAsync(argv, { from: "user" });
        } catch (error) {
          if (!(error instanceof Error) || !error.message.startsWith("__cli_exit_")) throw error;
        } finally {
          console.log = log;
          console.error = errorLog;
          (process as { exit: unknown }).exit = realExit;
        }
        return { stdout: out.join("\n"), stderr: err.join("\n"), exitCode };
      },
    });

    expect(
      readdirSync(home, { recursive: true }).map(String).filter((entry) => /\.(db|sqlite|sqlite3)(-wal|-shm)?$/.test(entry)),
    ).toEqual([]);
  } finally {
    console.log = log;
    console.error = errorLog;
    (process as { exit: unknown }).exit = realExit;
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    server.stop(true);
    rmSync(home, { recursive: true, force: true });
  }
}
