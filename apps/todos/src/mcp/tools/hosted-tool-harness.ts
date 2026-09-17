/**
 * Test harness for the HOSTED path of an MCP tool module.
 *
 * The port-to-API work needs one thing proved per tool: with a hosted
 * credential resolved, the tool's handler talks to the real `/v1` route and
 * NEVER opens the local store. Spawning `todos-mcp` once per tool would cost
 * seconds each, so this registers the module's tools against a capture server
 * in-process and drives the REAL credential resolver (`getTodosCloudClient`
 * reads `process.env`) against a REAL `Bun.serve` origin.
 *
 * It is deliberately a fixture, not a mock of the client: the request that the
 * assertion sees is the request the transport actually sent.
 */
import { expect } from "bun:test";
import { randomUUID } from "node:crypto";
import { mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export interface HostedRequest {
  method: string;
  path: string;
  query: URLSearchParams;
  body: unknown;
}

export type ToolHandler = (params: Record<string, unknown>) => Promise<{
  content: Array<{ type: string; text: string }>;
  isError?: boolean;
}>;

export interface HostedToolContext {
  /** Invoke a registered tool by name; throws when the module never registered it. */
  call: (tool: string, params?: Record<string, unknown>) => Promise<string>;
  /** Same, but asserts the tool reported `isError`. */
  callExpectingError: (tool: string, params?: Record<string, unknown>) => Promise<string>;
  /** Every request the fixture origin received, in order. */
  requests: HostedRequest[];
  /** Tool names the module registered. */
  registered: string[];
  /** Temp HOME for this fixture; asserted free of `*.db*` on teardown. */
  home: string;
}

type Route = (req: HostedRequest) => unknown;

/**
 * Run `register` against a capture server with a hosted credential in
 * `process.env`, then assert no SQLite file was created under the temp HOME.
 *
 * `routes` maps `"<METHOD> <pathname>"` (pathname may contain `:param`) to a
 * response body. An unmatched request is a 404 the tool will surface as an
 * error — fixtures must therefore be explicit about the routes they expect.
 */
export async function withHostedTools(
  register: (server: { tool: (...args: unknown[]) => void }, helpers: Record<string, unknown>) => void,
  routes: Record<string, Route>,
  run: (ctx: HostedToolContext) => Promise<void>,
  helperOverrides: Record<string, unknown> = {},
): Promise<void> {
  const home = mkdtempSync(join(tmpdir(), "todos-hosted-tools-"));
  const requests: HostedRequest[] = [];
  const apiKey = `fixture-hosted-${randomUUID()}`;
  const matchers = Object.entries(routes).map(([key, handler]) => {
    const [method, pattern] = key.split(" ", 2) as [string, string];
    const names: string[] = [];
    const source = pattern
      .split("/")
      .map((segment) => {
        if (!segment.startsWith(":")) return segment.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        names.push(segment.slice(1));
        return "([^/]+)";
      })
      .join("/");
    return { method, regex: new RegExp(`^${source}$`), names, handler };
  });

  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    async fetch(req) {
      // Fail the test loudly if the transport ever drops the credential.
      expect(req.headers.get("authorization") ?? req.headers.get("x-api-key")).toContain(apiKey);
      const url = new URL(req.url);
      const body = req.method === "GET" || req.method === "DELETE" ? undefined : await req.json().catch(() => undefined);
      const entry: HostedRequest = { method: req.method, path: url.pathname, query: url.searchParams, body };
      requests.push(entry);
      for (const matcher of matchers) {
        if (matcher.method !== req.method) continue;
        const match = matcher.regex.exec(url.pathname);
        if (!match) continue;
        const params: Record<string, string> = {};
        matcher.names.forEach((name, index) => { params[name] = decodeURIComponent(match[index + 1]!); });
        const result = matcher.handler({ ...entry, ...({ params } as never) });
        if (result === undefined) return new Response(null, { status: 204 });
        if (result instanceof Response) return result;
        return Response.json(result);
      }
      return Response.json({ error: `no fixture route for ${req.method} ${url.pathname}` }, { status: 404 });
    },
  });

  const handlers = new Map<string, ToolHandler>();
  const captureServer = {
    tool: (...args: unknown[]) => {
      const name = args[0] as string;
      const handler = args[args.length - 1] as ToolHandler;
      handlers.set(name, handler);
    },
    // Some modules also register MCP resources/prompts. Registration must not
    // throw; their handlers are lazy, so capturing and never invoking them is
    // enough to reach the tool handlers this harness exists to drive.
    resource: () => {},
    prompt: () => {},
  };

  const saved: Record<string, string | undefined> = {};
  const setEnv = (key: string, value: string | undefined) => {
    if (!(key in saved)) saved[key] = process.env[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  };
  // Strip anything that could re-point the resolver at a real station, a real
  // account or a local database, then point it at the fixture origin.
  for (const key of Object.keys(process.env)) {
    if (/^(HASNA_|TODOS_)/.test(key)) setEnv(key, undefined);
  }
  setEnv("HOME", home);
  setEnv("HASNA_STATION", `fixture-${randomUUID()}`);
  setEnv("HASNA_TODOS_API_URL", server.url.origin);
  setEnv("HASNA_TODOS_API_KEY", apiKey);

  try {
    register(captureServer, {
      shouldRegisterTool: () => true,
      resolveId: (id: string) => id,
      formatError: (error: unknown) => (error instanceof Error ? error.message : String(error)),
      formatTask: (task: { id: string; title: string }) => `${task.id} ${task.title}`,
      formatTaskDetail: (task: { id: string; title: string }) => `${task.id} ${task.title}`,
      getAgentFocus: () => undefined,
      applyFocus: () => {},
      ...helperOverrides,
    });

    const invoke = async (tool: string, params: Record<string, unknown> = {}) => {
      const handler = handlers.get(tool);
      if (!handler) throw new Error(`tool not registered: ${tool}`);
      return handler(params);
    };

    await run({
      registered: [...handlers.keys()],
      requests,
      home,
      call: async (tool, params) => {
        const result = await invoke(tool, params);
        expect(result.isError ?? false, `${tool}: ${result.content[0]?.text}`).toBe(false);
        return result.content.map((part) => part.text).join("\n");
      },
      callExpectingError: async (tool, params) => {
        const result = await invoke(tool, params);
        expect(result.isError, `${tool} unexpectedly succeeded`).toBe(true);
        return result.content.map((part) => part.text).join("\n");
      },
    });

    // The point of the port: a hosted credential must never produce a store file.
    expect(
      readdirSync(home, { recursive: true }).map(String).filter((entry) => /\.(db|sqlite|sqlite3)(-wal|-shm)?$/.test(entry)),
    ).toEqual([]);
  } finally {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    server.stop(true);
    rmSync(home, { recursive: true, force: true });
  }
}

/** Convenience for fixtures that also need a credentials file on disk. */
export function writeCredentialsFile(home: string, url: string, key: string): void {
  const dir = join(home, ".hasna/todos/config");
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  writeFileSync(join(dir, "credentials"), `HASNA_TODOS_API_URL=${url}\nHASNA_TODOS_API_KEY=${key}\n`, { mode: 0o600 });
}
