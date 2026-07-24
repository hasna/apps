import { existsSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";

const REPO_ROOT = join(import.meta.dir, "../..");

export interface HostedCliResult {
  exitCode: number;
  stdout: string;
  stderr: string;
  timedOut: boolean;
}

export interface HostedCliHarness {
  readonly requests: string[];
  readonly databaseConnections: string[];
  run(args: readonly string[]): Promise<HostedCliResult>;
  createdPaths(): string[];
  sqliteExists(): boolean;
  dispose(): void;
}

export interface HostedCliHarnessOptions {
  environment?: Record<string, string>;
  databaseTripwire?: boolean;
}

function listCreatedPaths(root: string, directory = root): string[] {
  const paths: string[] = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    paths.push(relative(root, path));
    if (entry.isDirectory()) paths.push(...listCreatedPaths(root, path));
  }
  return paths.sort();
}

/**
 * Black-box CLI harness for the Stage-A hosted floor. The listener is a tripwire:
 * every command must fail before it can issue even one HTTP request or create a
 * local SQLite fallback.
 */
export function createHostedCliHarness(
  prefix: string,
  options: HostedCliHarnessOptions = {},
): HostedCliHarness {
  const root = mkdtempSync(join(tmpdir(), prefix));
  const runtimeRoot = mkdtempSync(join(tmpdir(), `${prefix}bun-`));
  const dbPath = join(root, "todos.db");
  const requests: string[] = [];
  const databaseConnections: string[] = [];
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch(request) {
      const url = new URL(request.url);
      requests.push(`${request.method} ${url.pathname}?${url.searchParams.toString()}`);
      return Response.json({ error: "network must remain unreachable" }, { status: 500 });
    },
  });
  const databaseServer = Bun.listen({
    hostname: "127.0.0.1",
    port: 0,
    socket: {
      open(socket) {
        databaseConnections.push("tcp-open");
        socket.end();
      },
      data() {},
    },
  });
  const databaseUrl = `postgres://fixture-user:fixture-pass@127.0.0.1:${databaseServer.port}/todos`;

  return {
    requests,
    databaseConnections,
    async run(args) {
      const proc = Bun.spawn(["bun", "run", "src/cli/index.tsx", ...args], {
        cwd: REPO_ROOT,
        env: {
          PATH: process.env.PATH ?? "",
          HOME: root,
          TMPDIR: root,
          LANG: "C.UTF-8",
          BUN_INSTALL: runtimeRoot,
          BUN_INSTALL_CACHE_DIR: join(runtimeRoot, "cache"),
          TODOS_DB_PATH: dbPath,
          TODOS_AUTO_PROJECT: "false",
          HASNA_TODOS_STORAGE_MODE: "self_hosted",
          TODOS_STORAGE_MODE: "self_hosted",
          HASNA_TODOS_API_URL: `http://127.0.0.1:${server.port}`,
          HASNA_TODOS_API_KEY: "synthetic-key",
          ...(options.databaseTripwire ? { HASNA_TODOS_DATABASE_URL: databaseUrl } : {}),
          ...options.environment,
        },
        stdout: "pipe",
        stderr: "pipe",
      });
      const stdoutPromise = new Response(proc.stdout).text();
      const stderrPromise = new Response(proc.stderr).text();
      const completion = await Promise.race([
        proc.exited.then((exitCode) => ({ exitCode, timedOut: false })),
        Bun.sleep(5_000).then(() => ({ exitCode: -1, timedOut: true })),
      ]);
      if (completion.timedOut) {
        proc.kill();
        await proc.exited;
      }
      const [stdout, stderr] = await Promise.all([stdoutPromise, stderrPromise]);
      return { ...completion, stdout, stderr };
    },
    sqliteExists() {
      return existsSync(dbPath) || existsSync(join(root, ".hasna", "todos", "todos.db"));
    },
    createdPaths() {
      // Bun materializes its own package cache under HOME before application
      // code executes. Exclude only that interpreter-owned subtree; every
      // product-owned path (including .hasna and SQLite files) remains visible.
      return listCreatedPaths(root).filter((path) => path !== ".bun" && !path.startsWith(".bun/"));
    },
    dispose() {
      server.stop(true);
      databaseServer.stop(true);
      rmSync(root, { recursive: true, force: true });
      rmSync(runtimeRoot, { recursive: true, force: true });
    },
  };
}
