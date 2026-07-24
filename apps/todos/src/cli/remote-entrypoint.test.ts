import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { chmodSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import ts from "typescript";
import {
  getTodosCliCommandCapabilityMatrix,
  initializeTodosCliAuthority,
  type TodosCliAuthorityInitialization,
} from "./stage-a.js";
import { resetTodosCloudClient } from "./cloud-router.js";

const REPO_ROOT = join(import.meta.dir, "../..");
const TASK_FIXTURE_ID = "11111111-1111-4111-8111-111111111111";
const OTHER_TASK_FIXTURE_ID = "22222222-2222-4222-8222-222222222222";
const tempRoots: string[] = [];
let buildRoot: string | undefined;
let executable: string;

type CliResult = { exitCode: number; stdout: string; stderr: string };

async function buildCli(): Promise<string> {
  const ignoredBuildParent = join(REPO_ROOT, ".tmp");
  mkdirSync(ignoredBuildParent, { recursive: true });
  buildRoot = mkdtempSync(join(ignoredBuildParent, "remote-cli-entrypoint-"));
  const build = await Bun.build({
    entrypoints: [join(REPO_ROOT, "src/cli/index.tsx")],
    outdir: buildRoot,
    target: "bun",
    external: ["ink", "react", "chalk", "@modelcontextprotocol/sdk", "@hasna/contracts/client/storage"],
  });
  expect(build.success).toBe(true);
  expect(build.outputs).toHaveLength(1);
  return build.outputs[0]!.path;
}

async function runCli(executable: string, args: string[], env: Record<string, string>, cwd = REPO_ROOT): Promise<CliResult> {
  const proc = Bun.spawn(["bun", executable, ...args], {
    cwd,
    env: { ...env, NODE_PATH: join(REPO_ROOT, "node_modules") },
    stdout: "pipe",
    stderr: "pipe",
  });
  const stdout = await new Response(proc.stdout).text();
  const stderr = await new Response(proc.stderr).text();
  return { exitCode: await proc.exited, stdout, stderr };
}

function recursiveInventory(root: string, relative = ""): string[] {
  if (!existsSync(root)) return [];
  const entries = readdirSync(root).sort();
  return entries.flatMap((entry) => {
    const childRelative = relative ? `${relative}/${entry}` : entry;
    const child = join(root, entry);
    return lstatSync(child).isDirectory()
      ? [`${childRelative}/`, ...recursiveInventory(child, childRelative)]
      : [childRelative];
  });
}

function expectNoLocalDatabase(root: string, explicitPath: string): void {
  expect(existsSync(explicitPath)).toBe(false);
  expect(existsSync(join(root, ".todos"))).toBe(false);
  expect(existsSync(join(root, ".hasna", "todos", "todos.db"))).toBe(false);
  expect(existsSync(join(root, ".hasna", "todos"))).toBe(false);
}

function registeredCliNames(): Set<string> {
  const files = [
    join(REPO_ROOT, "src/cli/index.tsx"),
    ...readdirSync(join(REPO_ROOT, "src/cli/commands"))
      .filter((name) => /\.tsx?$/.test(name))
      .map((name) => join(REPO_ROOT, "src/cli/commands", name)),
  ];
  const names = new Set<string>(["help"]);
  const rootCommand = (expression: ts.Expression): string | null => {
    let current = expression;
    while (ts.isCallExpression(current) && ts.isPropertyAccessExpression(current.expression)) {
      const property = current.expression;
      if (property.name.text === "command" && ts.isIdentifier(property.expression) && property.expression.text === "program") {
        const argument = current.arguments[0];
        return argument && ts.isStringLiteral(argument) ? argument.text.split(/[ <[]/)[0]! : null;
      }
      current = property.expression;
    }
    return null;
  };
  for (const file of files) {
    const source = ts.createSourceFile(file, readFileSync(file, "utf8"), ts.ScriptTarget.Latest, true);
    const visit = (node: ts.Node): void => {
      if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)) {
        const property = node.expression;
        if (property.name.text === "command" && ts.isIdentifier(property.expression) && property.expression.text === "program") {
          const argument = node.arguments[0];
          if (argument && ts.isStringLiteral(argument)) names.add(argument.text.split(/[ <[]/)[0]!);
        }
        if (property.name.text === "alias" || property.name.text === "aliases") {
          const canonical = rootCommand(property.expression);
          if (canonical) {
            const argument = node.arguments[0];
            if (argument && ts.isStringLiteral(argument)) names.add(argument.text);
            if (argument && ts.isArrayLiteralExpression(argument)) {
              for (const item of argument.elements) if (ts.isStringLiteral(item)) names.add(item.text);
            }
          }
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(source);
  }
  return names;
}

beforeAll(async () => {
  executable = await buildCli();
});

beforeEach(() => {
  resetTodosCloudClient();
});

afterEach(() => {
  resetTodosCloudClient();
  for (const root of tempRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

afterAll(() => {
  if (buildRoot) rmSync(buildRoot, { recursive: true, force: true });
});

describe("remote CLI entrypoint authority boundary", () => {
  test("every registered canonical command and alias has exactly one Stage-A capability owner", () => {
    const registered = [...registeredCliNames()].sort();
    const matrix = getTodosCliCommandCapabilityMatrix();
    expect([...matrix.keys()].sort()).toEqual(registered);
    expect([...matrix.values()].filter((owner) => owner === "local-only").length).toBeGreaterThanOrEqual(97);
    expect([...matrix.values()].every((owner) => ["diagnostic", "remote-http", "local-only"].includes(owner))).toBe(true);
  });

  test("selects HTTP before local-capable command modules initialize", () => {
    const result: TodosCliAuthorityInitialization = initializeTodosCliAuthority(
      ["--json", "status"],
      {
        HASNA_TODOS_STORAGE_MODE: "remote",
        HASNA_TODOS_API_URL: "https://authority.invalid",
        HASNA_TODOS_API_KEY: "fixture-remote-key",
      },
    );

    expect(result).toEqual({
      route: "remote-http",
      v1_base_url: "https://authority.invalid/v1",
    });
    expect(() => initializeTodosCliAuthority(
      ["task", "--json", "upsert", "--fingerprint", "fixture", "--title", "Fixture"],
      {
        HASNA_TODOS_STORAGE_MODE: "remote",
        HASNA_TODOS_API_URL: "https://authority.invalid",
        HASNA_TODOS_API_KEY: "fixture-remote-key",
      },
    )).not.toThrow();

    expect(() => initializeTodosCliAuthority(
      ["storage", "artifacts", "upload", "--run-id", "status"],
      {
        HASNA_TODOS_STORAGE_MODE: "remote",
        HASNA_TODOS_API_URL: "https://authority.invalid",
        HASNA_TODOS_API_KEY: "fixture-remote-key",
      },
    )).toThrow("REMOTE_COMMAND_UNSUPPORTED");
    expect(() => initializeTodosCliAuthority(
      ["config", "--set", "danger=true"],
      {
        HASNA_TODOS_STORAGE_MODE: "remote",
        HASNA_TODOS_API_URL: "https://authority.invalid",
        HASNA_TODOS_API_KEY: "fixture-remote-key",
      },
    )).toThrow("REMOTE_COMMAND_UNSUPPORTED");
    expect(() => initializeTodosCliAuthority(
      ["projects", "--add", "/workspace/example", "--dry-run"],
      {
        HASNA_TODOS_STORAGE_MODE: "remote",
        HASNA_TODOS_API_URL: "https://authority.invalid",
        HASNA_TODOS_API_KEY: "fixture-remote-key",
      },
    )).toThrow("REMOTE_COMMAND_UNSUPPORTED");

    for (const args of [
      ["--project", "--help", "storage", "artifacts", "upload", "--run-id", "status"],
      ["--agent", "--help", "config", "--set", "danger=true"],
      ["--session", "--help", "projects", "--dry-run", "--add", "/workspace/example"],
      ["--unknown-leading", "--help"],
      ["storage", "--project", "fixture", "status", "extra"],
      ["config", "--get", "--help"],
      ["list", "--tags", "one"],
      ["list", "--tag=one"],
      ["list", "--recurring"],
      ["claim", "fixture-agent", "--stale-minutes", "30"],
      ["claim", "fixture-agent", "--steal-stale"],
      ["status", "--agent", "fixture-agent"],
      ["bulk", "unknown", TASK_FIXTURE_ID],
      ["bulk", "done", TASK_FIXTURE_ID, "--plan", "fixture-plan"],
      ["projects", "--path-prefix", "/tmp", "--deregister", "fixture"],
      ["plans", "--write-artifacts"],
    ]) {
      expect(() => initializeTodosCliAuthority(args, {
        HASNA_TODOS_STORAGE_MODE: "remote",
        HASNA_TODOS_API_URL: "https://authority.invalid",
        HASNA_TODOS_API_KEY: "fixture-remote-key",
      })).toThrow("REMOTE_COMMAND_UNSUPPORTED");
    }

    for (const args of [
      ["storage", "status"],
      ["config"],
      ["config", "--get", "completion_guard.enabled"],
      ["init", "fixture-agent"],
      ["agents"],
      ["heartbeat", "fixture-agent"],
      ["release", "fixture-agent"],
      ["lock", "11111111-1111-4111-8111-111111111111"],
      ["unlock", "11111111-1111-4111-8111-111111111111"],
      ["active"],
      ["timeline"],
      ["--project=fixture", "lists"],
      ["lists", "--project", "fixture", "--json"],
      ["storage", "--project=fixture", "status"],
      ["--agent=fixture-agent", "comment", TASK_FIXTURE_ID, "note"],
      ["history", TASK_FIXTURE_ID],
      ["approve", TASK_FIXTURE_ID],
      ["bulk", "done", TASK_FIXTURE_ID],
      // Bulk plan reassignment is serviced remotely (shared plan lookup + PATCH
      // per task), so it must not fail closed under remote authority.
      ["bulk", "plan", TASK_FIXTURE_ID, "--plan", "fixture-plan"],
      ["bulk", "move-plan", TASK_FIXTURE_ID, "--plan", "fixture-plan"],
      ["bulk", "plan", TASK_FIXTURE_ID, "--clear-plan"],
      ["deps", TASK_FIXTURE_ID, "--needs", OTHER_TASK_FIXTURE_ID],
      // `deps <id>` works remotely, so its presentation-only flags must stay
      // supported too: `--graph`/`--direction` degrade to the same flat edges
      // rather than flipping a working command to REMOTE_COMMAND_UNSUPPORTED.
      ["deps", TASK_FIXTURE_ID],
      ["deps", TASK_FIXTURE_ID, "--graph"],
      ["deps", TASK_FIXTURE_ID, "--graph", "--json"],
      ["deps", TASK_FIXTURE_ID, "--direction=up"],
      ["deps", TASK_FIXTURE_ID, "--direction", "down"],
      ["link-commit", TASK_FIXTURE_ID, "abc123"],
      ["find-commit", "abc123"],
      ["link-ref", TASK_FIXTURE_ID, "branch/name"],
      ["find-ref", "branch/name"],
      ["record-verification", TASK_FIXTURE_ID, "bun test"],
      ["recap"],
      ["standup"],
      // Dedicated alias mutators must share the same remote capability surface as
      // their `update --assign`/`update --tags` equivalents (assign-tag-untag bug).
      ["assign", TASK_FIXTURE_ID, "fixture-agent"],
      ["tag", TASK_FIXTURE_ID, "fixture-tag"],
      ["untag", TASK_FIXTURE_ID, "fixture-tag"],
    ]) {
      expect(() => initializeTodosCliAuthority(args, {
        HASNA_TODOS_STORAGE_MODE: "remote",
        HASNA_TODOS_API_URL: "https://authority.invalid",
        HASNA_TODOS_API_KEY: "fixture-remote-key",
      })).not.toThrow();
    }
  });

  test("shell-completion generation stays diagnostic in remote mode even with a shell argument", () => {
    for (const args of [
      ["completions", "bash"],
      ["completions", "zsh"],
      ["completions", "fish"],
      ["completion", "bash"],
      ["completion", "zsh"],
      ["completion", "fish"],
    ]) {
      const result = initializeTodosCliAuthority(args, {
        HASNA_TODOS_STORAGE_MODE: "remote",
        HASNA_TODOS_API_URL: "https://authority.invalid",
        HASNA_TODOS_API_KEY: "fixture-remote-key",
      });
      expect(result).toEqual({
        route: "remote-diagnostic",
        v1_base_url: "https://authority.invalid/v1",
      });
    }
  });

  test("built Stage-A adversarial invocations leave synthetic cwd and HOME byte-for-byte absent", async () => {
    const requests: string[] = [];
    const server = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      fetch(request) {
        requests.push(`${request.method} ${new URL(request.url).pathname}`);
        return Response.json({ error: "Stage A should have rejected before HTTP" }, { status: 500 });
      },
    });
    const root = mkdtempSync(join(tmpdir(), "todos-stage-a-adversarial-"));
    tempRoots.push(root);
    const cwd = join(root, "cwd");
    const home = join(root, "home");
    mkdirSync(cwd);
    mkdirSync(home);
    const localDbPath = join(root, "must-not-exist", "todos.db");
    const env = {
      PATH: process.env.PATH ?? "",
      BUN_INSTALL: process.env.BUN_INSTALL ?? join(process.env.HOME ?? "/home/hasna", ".bun"),
      HOME: home,
      TMPDIR: root,
      LANG: "C.UTF-8",
      TODOS_DB_PATH: localDbPath,
      HASNA_TODOS_STORAGE_MODE: "remote",
      HASNA_TODOS_API_URL: `http://127.0.0.1:${server.port}`,
      HASNA_TODOS_API_KEY: "fixture-remote-key",
    };
    const before = recursiveInventory(cwd);
    try {
      for (const args of [
        ["storage", "artifacts", "upload", "--run-id", "status"],
        ["storage", "artifacts", "upload", "--run-id", "--help"],
        ["--project", "--help", "storage", "artifacts", "upload", "--run-id", "status"],
        ["--unknown-leading", "--help"],
        ["config", "--set", "danger=true"],
        ["config", "--get", "--help"],
        ["projects", "--add", "/workspace/example", "--dry-run"],
        ["projects", "--update", "example", "--name", "changed", "--dry-run"],
        ["list", "--tags", "fixture"],
        ["list", "--recurring"],
        ["claim", "fixture-agent", "--stale-minutes", "30"],
        ["claim", "fixture-agent", "--steal-stale"],
        ["--project", "fixture", "claim", "fixture-agent"],
        ["--agent", "fixture", "status"],
        ["bulk", "unknown", TASK_FIXTURE_ID],
        ["bulk", "done", TASK_FIXTURE_ID, "--plan", "fixture-plan"],
        ["projects", "--deregister", "fixture", "--path-prefix", "/tmp"],
        ["plans", "--write-artifacts"],
        ["agents-normalize"],
      ]) {
        const requestCount = requests.length;
        const result = await runCli(executable, args, env, cwd);
        expect({ args, exitCode: result.exitCode }).toEqual({ args, exitCode: 1 });
        expect(result.stderr).toContain("REMOTE_COMMAND_UNSUPPORTED");
        expect(requests).toHaveLength(requestCount);
        expect(recursiveInventory(cwd)).toEqual(before);
        expectNoLocalDatabase(home, localDbPath);
      }
    } finally {
      server.stop(true);
    }
  }, 45_000);

  test("every local-only command family rejects in the built entrypoint before HTTP or filesystem access", async () => {
    const requests: string[] = [];
    const server = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      fetch(request) {
        requests.push(`${request.method} ${new URL(request.url).pathname}`);
        return Response.json({ error: "local-only command reached HTTP" }, { status: 500 });
      },
    });
    const root = mkdtempSync(join(tmpdir(), "todos-stage-a-local-inventory-"));
    tempRoots.push(root);
    const cwd = join(root, "cwd");
    const home = join(root, "home");
    mkdirSync(cwd);
    mkdirSync(home);
    const localDbPath = join(root, "must-not-exist", "todos.db");
    const env = {
      PATH: process.env.PATH ?? "",
      BUN_INSTALL: process.env.BUN_INSTALL ?? join(process.env.HOME ?? "/home/hasna", ".bun"),
      HOME: home,
      TMPDIR: root,
      LANG: "C.UTF-8",
      TODOS_DB_PATH: localDbPath,
      HASNA_TODOS_STORAGE_MODE: "remote",
      HASNA_TODOS_API_URL: `http://127.0.0.1:${server.port}`,
      HASNA_TODOS_API_KEY: "fixture-remote-key",
    };
    const before = recursiveInventory(cwd);
    try {
      const localOnly = [...getTodosCliCommandCapabilityMatrix()]
        .filter(([, owner]) => owner === "local-only")
        .map(([command]) => command)
        .sort();
      expect(localOnly.length).toBeGreaterThanOrEqual(97);
      for (const command of localOnly) {
        const result = await runCli(executable, [command], env, cwd);
        expect({ command, exitCode: result.exitCode }).toEqual({ command, exitCode: 1 });
        expect(result.stderr).toContain("REMOTE_COMMAND_UNSUPPORTED");
        expect(requests).toHaveLength(0);
        expect(recursiveInventory(cwd)).toEqual(before);
        expectNoLocalDatabase(home, localDbPath);
      }
    } finally {
      server.stop(true);
    }
  }, 45_000);

  test("built help and manual advertise only remote-executable commands", async () => {
    const env = {
      PATH: process.env.PATH ?? "",
      BUN_INSTALL: process.env.BUN_INSTALL ?? join(process.env.HOME ?? "/home/hasna", ".bun"),
      HOME: mkdtempSync(join(tmpdir(), "todos-remote-help-")),
      LANG: "C.UTF-8",
      HASNA_TODOS_STORAGE_MODE: "remote",
      HASNA_TODOS_API_URL: "https://authority.invalid",
      HASNA_TODOS_API_KEY: "fixture-remote-key",
    };
    tempRoots.push(env.HOME);

    const localOnly = [...getTodosCliCommandCapabilityMatrix()]
      .filter(([, owner]) => owner === "local-only")
      .map(([command]) => command);

    const manual = await runCli(executable, ["manual", "--json"], env);
    expect(manual.exitCode).toBe(0);
    const parsed = JSON.parse(manual.stdout) as {
      local_only: boolean;
      examples: string[];
      commands: { path: string[] }[];
    };
    const advertised = parsed.commands.map((entry) => entry.path[0] ?? "");
    // Regression: no advertised command may be one Stage A rejects at runtime.
    expect(advertised.filter((name) => localOnly.includes(name))).toEqual([]);
    for (const name of ["status", "list", "add"]) expect(advertised).toContain(name);
    for (const name of ["ready", "usage", "burndown", "summary", "verify-providers"]) {
      expect(advertised).not.toContain(name);
    }
    expect(parsed.local_only).toBe(false);
    expect(parsed.examples.some((example) => example.startsWith("todos ready"))).toBe(false);

    const help = await runCli(executable, ["--help"], env);
    expect(help.exitCode).toBe(0);
    expect(help.stdout).not.toMatch(/\bburndown\b/);
    expect(help.stdout).not.toMatch(/\bverify-providers\b/);
    expect(help.stdout).toMatch(/\bstatus\b/);
  });

  test("built status command uses /v1 and never opens the local or Postgres adapter", async () => {
    const requests: Array<{ method: string; path: string; authorization: string | null }> = [];
    const server = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      fetch(request) {
        const url = new URL(request.url);
        requests.push({
          method: request.method,
          path: url.pathname,
          authorization: request.headers.get("authorization"),
        });
        if (url.pathname === "/v1/stats") {
          return Response.json({ tasks: 0, projects: 0 });
        }
        if (url.pathname === "/v1/tasks") {
          return Response.json({ tasks: [], count: 0 });
        }
        return Response.json({ error: "route not present in fixture" }, { status: 404 });
      },
    });
    const root = mkdtempSync(join(tmpdir(), "todos-remote-entrypoint-"));
    tempRoots.push(root);
    const localDbPath = join(root, "local-adapter-must-not-open", "todos.db");

    try {
      const result = await runCli(executable, ["--json", "status"], {
          PATH: process.env.PATH ?? "",
          BUN_INSTALL: process.env.BUN_INSTALL ?? join(process.env.HOME ?? "/home/hasna", ".bun"),
          HOME: root,
          TMPDIR: root,
          LANG: "C.UTF-8",
          TODOS_AUTO_PROJECT: "false",
          TODOS_DB_PATH: localDbPath,
          HASNA_TODOS_STORAGE_MODE: "remote",
          HASNA_TODOS_API_URL: `http://127.0.0.1:${server.port}`,
          HASNA_TODOS_API_KEY: "fixture-remote-key",
      });

      expect({ exitCode: result.exitCode, stderr: result.stderr }).toEqual({ exitCode: 0, stderr: "" });
      expect(JSON.parse(result.stdout)).toMatchObject({
        source: "cloud",
        transport: "http-v1",
        authority: { v1_base_url: `http://127.0.0.1:${server.port}/v1`, local_fallback: false },
        total: 0,
      });
      expect(requests.some((request) => request.path === "/v1/stats")).toBe(true);
      expect(requests.some((request) => request.path === "/v1/tasks")).toBe(true);
      expect(requests.every((request) => request.authorization === "Bearer fixture-remote-key")).toBe(true);
      expect(existsSync(join(root, "local-adapter-must-not-open"))).toBe(false);
      expectNoLocalDatabase(root, localDbPath);

      for (const diagnostic of [["--json", "config"], ["--json", "storage", "status"]]) {
        const diagnosticResult = await runCli(executable, diagnostic, {
          PATH: process.env.PATH ?? "",
          BUN_INSTALL: process.env.BUN_INSTALL ?? join(process.env.HOME ?? "/home/hasna", ".bun"),
          HOME: root,
          TMPDIR: root,
          LANG: "C.UTF-8",
          TODOS_DB_PATH: localDbPath,
          HASNA_TODOS_STORAGE_MODE: "remote",
          HASNA_TODOS_API_URL: `http://127.0.0.1:${server.port}`,
          HASNA_TODOS_API_KEY: "fixture-remote-key",
        });
        expect({ exitCode: diagnosticResult.exitCode, stderr: diagnosticResult.stderr }).toEqual({ exitCode: 0, stderr: "" });
        expect(() => JSON.parse(diagnosticResult.stdout)).not.toThrow();
        expectNoLocalDatabase(root, localDbPath);
      }

      const missingUrl = await runCli(executable, ["--json", "projects"], {
        PATH: process.env.PATH ?? "",
        BUN_INSTALL: process.env.BUN_INSTALL ?? join(process.env.HOME ?? "/home/hasna", ".bun"),
        HOME: root,
        TMPDIR: root,
        LANG: "C.UTF-8",
        TODOS_DB_PATH: localDbPath,
        HASNA_TODOS_STORAGE_MODE: "remote",
        HASNA_TODOS_API_KEY: "fixture-remote-key",
      });
      expect(missingUrl.exitCode).toBe(1);
      expect(missingUrl.stderr).toContain("REMOTE_API_URL_MISSING");
      expectNoLocalDatabase(root, localDbPath);

      const missingKey = await runCli(executable, ["--json", "projects"], {
        PATH: process.env.PATH ?? "",
        BUN_INSTALL: process.env.BUN_INSTALL ?? join(process.env.HOME ?? "/home/hasna", ".bun"),
        HOME: root,
        TMPDIR: root,
        LANG: "C.UTF-8",
        TODOS_DB_PATH: localDbPath,
        HASNA_TODOS_STORAGE_MODE: "remote",
        HASNA_TODOS_API_URL: `http://127.0.0.1:${server.port}`,
      });
      expect(missingKey.exitCode).toBe(1);
      expect(missingKey.stderr).toContain("REMOTE_API_KEY_MISSING");
      expectNoLocalDatabase(root, localDbPath);
    } finally {
      server.stop(true);
    }
  });

  test("built safe coordination handlers use only V1 and preserve a synthetic filesystem", async () => {
    const TASK_ID = "11111111-1111-4111-8111-111111111111";
    const AGENT_ID = "22222222-2222-4222-8222-222222222222";
    const requests: Array<{ method: string; path: string; body: Record<string, unknown> }> = [];
    const server = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      async fetch(request) {
        const url = new URL(request.url);
        const body = request.method === "GET" ? {} : await request.json().catch(() => ({})) as Record<string, unknown>;
        requests.push({ method: request.method, path: `${url.pathname}${url.search}`, body });
        if (request.headers.get("authorization") !== "Bearer fixture-remote-key") {
          return Response.json({ error: "fixture auth required" }, { status: 401 });
        }
        const agent = { id: AGENT_ID, name: "fixture-agent", last_seen_at: "2026-07-18T00:00:00.000Z" };
        const task = {
          id: TASK_ID,
          short_id: "FIX-1",
          title: "Fixture task",
          status: "in_progress",
          priority: "medium",
          updated_at: "2026-07-18T00:00:00.000Z",
        };
        if (url.pathname === "/v1/agents" && request.method === "POST") return Response.json({ agent }, { status: 201 });
        if (url.pathname === "/v1/agents" && request.method === "GET") return Response.json({ agents: [agent], count: 1 });
        if (url.pathname === "/v1/agents/fixture-agent/heartbeat") return Response.json({ agent });
        if (url.pathname === "/v1/agents/fixture-agent/release") return Response.json({ agent, released: true });
        if (url.pathname === `/v1/tasks/${TASK_ID}/lock`) return Response.json({ result: { success: true, locked_by: "fixture-agent" } });
        if (url.pathname === `/v1/tasks/${TASK_ID}/unlock`) return Response.json({ success: true });
        if (url.pathname === "/v1/tasks" && url.searchParams.get("status") === "in_progress") {
          return Response.json({ tasks: [task], count: 1, total: 1 });
        }
        if (url.pathname === "/v1/activity") return Response.json({ activity: [], count: 0 });
        return Response.json({ error: `fixture route missing: ${request.method} ${url.pathname}` }, { status: 404 });
      },
    });
    const root = mkdtempSync(join(tmpdir(), "todos-safe-coordination-"));
    tempRoots.push(root);
    const cwd = join(root, "cwd");
    const home = join(root, "home");
    mkdirSync(cwd);
    mkdirSync(home);
    const localDbPath = join(root, "must-not-exist", "todos.db");
    const env = {
      PATH: process.env.PATH ?? "",
      BUN_INSTALL: process.env.BUN_INSTALL ?? join(process.env.HOME ?? "/home/hasna", ".bun"),
      HOME: home,
      TMPDIR: root,
      LANG: "C.UTF-8",
      TODOS_AUTO_PROJECT: "false",
      TODOS_DB_PATH: localDbPath,
      HASNA_TODOS_STORAGE_MODE: "remote",
      HASNA_TODOS_API_URL: `http://127.0.0.1:${server.port}`,
      HASNA_TODOS_API_KEY: "fixture-remote-key",
    };
    const before = recursiveInventory(cwd);
    try {
      for (const args of [
        ["--json", "init", "fixture-agent"],
        ["--json", "agents"],
        ["--json", "heartbeat", "fixture-agent"],
        ["--json", "release", "fixture-agent"],
        ["--agent", "fixture-agent", "--json", "lock", TASK_ID],
        ["--agent", "fixture-agent", "--json", "unlock", TASK_ID],
        ["--json", "active"],
        ["--json", "timeline"],
      ]) {
        const result = await runCli(executable, args, env, cwd);
        expect({ args, exitCode: result.exitCode, stderr: result.stderr }).toEqual({ args, exitCode: 0, stderr: "" });
        expect(() => JSON.parse(result.stdout)).not.toThrow();
        expect(recursiveInventory(cwd)).toEqual(before);
        expectNoLocalDatabase(home, localDbPath);
      }
      expect(requests.map((request) => `${request.method} ${request.path}`)).toEqual([
        "POST /v1/agents",
        "GET /v1/agents",
        "POST /v1/agents/fixture-agent/heartbeat",
        "POST /v1/agents/fixture-agent/release",
        `POST /v1/tasks/${TASK_ID}/lock`,
        `POST /v1/tasks/${TASK_ID}/unlock`,
        "GET /v1/tasks?status=in_progress",
        "GET /v1/activity?limit=5000",
      ]);
    } finally {
      server.stop(true);
    }
  });

  test("built deps --graph/--direction stay on /v1 and render the same flat edges as base deps", async () => {
    // Regression: a lone `--graph`/`--direction` flag used to flip a working
    // `deps <id>` into REMOTE_COMMAND_UNSUPPORTED at Stage A. The recursive graph
    // is a local-only view, so in remote mode these flags must degrade to the same
    // flat dependency/blocked-by edges instead of failing closed.
    const TASK_ID = "44444444-4444-4444-8444-444444444444";
    const DEP_ID = "55555555-5555-4555-8555-555555555555";
    const requests: string[] = [];
    const server = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      fetch(request) {
        const url = new URL(request.url);
        requests.push(`${request.method} ${url.pathname}`);
        if (request.headers.get("authorization") !== "Bearer fixture-remote-key") {
          return Response.json({ error: "fixture auth required" }, { status: 401 });
        }
        if (url.pathname === `/v1/tasks/${TASK_ID}/dependencies` && request.method === "GET") {
          return Response.json({
            dependencies: [{ task_id: TASK_ID, depends_on: DEP_ID }],
            blocked_by: [],
          });
        }
        return Response.json({ error: `fixture route missing: ${request.method} ${url.pathname}` }, { status: 404 });
      },
    });
    const root = mkdtempSync(join(tmpdir(), "todos-deps-graph-"));
    tempRoots.push(root);
    const cwd = join(root, "cwd");
    const home = join(root, "home");
    mkdirSync(cwd);
    mkdirSync(home);
    const localDbPath = join(root, "must-not-exist", "todos.db");
    const env = {
      PATH: process.env.PATH ?? "",
      BUN_INSTALL: process.env.BUN_INSTALL ?? join(process.env.HOME ?? "/home/hasna", ".bun"),
      HOME: home,
      TMPDIR: root,
      LANG: "C.UTF-8",
      TODOS_AUTO_PROJECT: "false",
      TODOS_DB_PATH: localDbPath,
      HASNA_TODOS_STORAGE_MODE: "remote",
      HASNA_TODOS_API_URL: `http://127.0.0.1:${server.port}`,
      HASNA_TODOS_API_KEY: "fixture-remote-key",
    };
    const before = recursiveInventory(cwd);
    try {
      const baseJson = { dependencies: [{ task_id: TASK_ID, depends_on: DEP_ID }], blocked_by: [] };
      for (const args of [
        ["--json", "deps", TASK_ID],
        ["--json", "deps", TASK_ID, "--graph"],
        ["--json", "deps", TASK_ID, "--direction", "up"],
        ["deps", TASK_ID, "--graph"],
      ]) {
        const requestCount = requests.length;
        const result = await runCli(executable, args, env, cwd);
        expect({ args, exitCode: result.exitCode, stderr: result.stderr }).toEqual({ args, exitCode: 0, stderr: "" });
        // Every variant reaches HTTP (no Stage-A rejection, no local fallback).
        expect(requests[requestCount]).toBe(`GET /v1/tasks/${TASK_ID}/dependencies`);
        if (args.includes("--json")) {
          expect(JSON.parse(result.stdout)).toEqual(baseJson);
        } else {
          expect(result.stdout).toContain(DEP_ID);
        }
        expect(recursiveInventory(cwd)).toEqual(before);
        expectNoLocalDatabase(home, localDbPath);
      }
    } finally {
      server.stop(true);
    }
  }, 45_000);

  test("built remote done persists every evidence field and rejects invalid confidence before requests", async () => {
    const TASK_ID = "33333333-3333-4333-8333-333333333333";
    const requests: Array<{ method: string; path: string; body: Record<string, unknown> }> = [];
    let advertiseEvidence = false;
    const server = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      async fetch(request) {
        const url = new URL(request.url);
        const body = await request.json().catch(() => ({})) as Record<string, unknown>;
        requests.push({ method: request.method, path: url.pathname, body });
        if (url.pathname === "/v1/openapi.json") {
          return Response.json(advertiseEvidence ? {
            openapi: "3.1.0",
            paths: {
              "/v1/tasks/{id}/complete": {
                post: {
                  requestBody: {
                    content: {
                      "application/json": { schema: { $ref: "#/components/schemas/CompleteTaskInput" } },
                    },
                  },
                },
              },
            },
            components: {
              schemas: {
                CompleteTaskInput: {
                  type: "object",
                  properties: {
                    agent_id: { type: "string" },
                    attachment_ids: { type: "array", items: { type: "string" } },
                    files_changed: { type: "array", items: { type: "string" } },
                    test_results: { type: "string" },
                    commit_hash: { type: "string" },
                    notes: { type: "string" },
                    confidence: { type: "number" },
                  },
                },
              },
            },
          } : {
            openapi: "3.1.0",
            paths: { "/v1/tasks/{id}/complete": { post: { responses: {} } } },
          });
        }
        if (url.pathname === `/v1/tasks/${TASK_ID}/complete`) {
          return Response.json({ task: { id: TASK_ID, title: "Done", status: "completed", confidence: body.confidence, metadata: { _evidence: body } } });
        }
        return Response.json({ error: "fixture route missing" }, { status: 404 });
      },
    });
    const root = mkdtempSync(join(tmpdir(), "todos-done-evidence-"));
    tempRoots.push(root);
    const cwd = join(root, "cwd");
    const home = join(root, "home");
    mkdirSync(cwd);
    mkdirSync(home);
    const localDbPath = join(root, "must-not-exist", "todos.db");
    const env = {
      PATH: process.env.PATH ?? "",
      BUN_INSTALL: process.env.BUN_INSTALL ?? join(process.env.HOME ?? "/home/hasna", ".bun"),
      HOME: home,
      TMPDIR: root,
      LANG: "C.UTF-8",
      TODOS_DB_PATH: localDbPath,
      HASNA_TODOS_STORAGE_MODE: "remote",
      HASNA_TODOS_API_URL: `http://127.0.0.1:${server.port}`,
      HASNA_TODOS_API_KEY: "fixture-remote-key",
    };
    const before = recursiveInventory(cwd);
    try {
      const unsupported = await runCli(executable, [
        "--json", "done", TASK_ID, "--notes", "must not be dropped",
      ], env, cwd);
      expect(unsupported.exitCode).toBe(1);
      expect(unsupported.stderr).toContain("REMOTE_COMPLETION_EVIDENCE_UNSUPPORTED");
      expect(requests.map((request) => `${request.method} ${request.path}`)).toEqual([
        "GET /v1/openapi.json",
      ]);

      advertiseEvidence = true;
      requests.length = 0;
      const done = await runCli(executable, [
        "--agent", "fixture-agent", "--json", "done", TASK_ID,
        "--attach-ids", "attachment-one,attachment-two",
        "--files-changed", "src/a.ts,src/b.ts",
        "--test-results", "12 passed",
        "--commit-hash", "abc123",
        "--notes", "verified",
        "--confidence", "0.85",
      ], env, cwd);
      expect({ exitCode: done.exitCode, stderr: done.stderr }).toEqual({ exitCode: 0, stderr: "" });
      expect(requests).toHaveLength(2);
      expect(requests[0]).toMatchObject({ method: "GET", path: "/v1/openapi.json" });
      expect(requests[1]).toEqual({
        method: "POST",
        path: `/v1/tasks/${TASK_ID}/complete`,
        body: {
          agent_id: "fixture-agent",
          attachment_ids: ["attachment-one", "attachment-two"],
          files_changed: ["src/a.ts", "src/b.ts"],
          test_results: "12 passed",
          commit_hash: "abc123",
          notes: "verified",
          confidence: 0.85,
        },
      });
      const invalid = await runCli(executable, ["--json", "done", TASK_ID, "--confidence", "1.5"], env, cwd);
      expect(invalid.exitCode).toBe(1);
      expect(invalid.stderr).toContain("--confidence must be a number between 0.0 and 1.0");
      expect(requests).toHaveLength(2);
      expect(recursiveInventory(cwd)).toEqual(before);
      expectNoLocalDatabase(home, localDbPath);
    } finally {
      server.stop(true);
    }
  });

  test("built project/list/plan/task lifecycle stays on HTTP with a read-only TODOS_DB_PATH", async () => {
    const PROJECT_ID = "11111111-1111-4111-8111-111111111111";
    const LIST_ID = "22222222-2222-4222-8222-222222222222";
    const PLAN_ID = "33333333-3333-4333-8333-333333333333";
    const TASK_IDS = [
      "44444444-4444-4444-8444-444444444444",
      "55555555-5555-4555-8555-555555555555",
      "66666666-6666-4666-8666-666666666666",
    ];
    const now = "2026-07-18T00:00:00.000Z";
    const projects: Array<Record<string, unknown>> = [];
    const taskLists: Array<Record<string, unknown>> = [];
    const plans: Array<Record<string, unknown>> = [];
    const tasks: Array<Record<string, unknown>> = [];
    const requests: string[] = [];
    let nextTaskId = 0;

    const server = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      async fetch(request) {
        const url = new URL(request.url);
        const route = `${request.method} ${url.pathname}${url.search}`;
        requests.push(route);
        if (request.headers.get("authorization") !== "Bearer fixture-remote-key") {
          return Response.json({ error: "fixture auth required" }, { status: 401 });
        }
        const body = request.method === "GET" || request.method === "HEAD"
          ? {}
          : await request.json().catch(() => ({})) as Record<string, unknown>;
        // Mirror the fixed /v1 server: resolve an exact id, then a unique id
        // prefix, then an exact short_id — all case-insensitive. The CLI no longer
        // pages the whole task set client-side to expand a short reference.
        const find = (items: Array<Record<string, unknown>>, ref: string) => {
          const raw = String(ref).toLowerCase();
          const byId = items.find((item) => String(item.id).toLowerCase() === raw);
          if (byId) return byId;
          const byPrefix = items.filter((item) => String(item.id).toLowerCase().startsWith(raw));
          if (byPrefix.length === 1) return byPrefix[0];
          if (byPrefix.length > 1) return undefined;
          return items.find((item) => String(item.short_id ?? "").toLowerCase() === raw);
        };
        const remove = (items: Array<Record<string, unknown>>, id: string) => {
          const index = items.findIndex((item) => item.id === id);
          if (index < 0) return false;
          items.splice(index, 1);
          return true;
        };

        if (url.pathname === "/v1/stats" && request.method === "GET") {
          return Response.json({ tasks: tasks.length, tasks_all: tasks.length, projects: projects.length });
        }
        if (url.pathname === "/v1/projects") {
          if (request.method === "GET") return Response.json({ projects, count: projects.length });
          if (request.method === "POST") {
            const project = { id: PROJECT_ID, name: body.name, path: body.path, description: body.description ?? null, task_list_id: null, created_at: now, updated_at: now };
            projects.push(project);
            return Response.json({ project }, { status: 201 });
          }
        }
        const projectMatch = url.pathname.match(/^\/v1\/projects\/([^/]+)$/);
        if (projectMatch) {
          const project = find(projects, projectMatch[1]!);
          if (!project) return Response.json({ error: "project not found" }, { status: 404 });
          if (request.method === "GET") return Response.json({ project });
          if (request.method === "PATCH") {
            Object.assign(project, body, { updated_at: now });
            return Response.json({ project });
          }
        }

        if (url.pathname === "/v1/task-lists") {
          if (request.method === "GET") {
            const projectId = url.searchParams.get("project_id");
            const items = projectId ? taskLists.filter((item) => item.project_id === projectId) : taskLists;
            return Response.json({ task_lists: items, count: items.length });
          }
          if (request.method === "POST") {
            const task_list = { id: LIST_ID, name: body.name, slug: body.slug ?? "work", description: body.description ?? null, project_id: body.project_id ?? null, metadata: {}, created_at: now, updated_at: now };
            taskLists.push(task_list);
            return Response.json({ task_list }, { status: 201 });
          }
        }
        const listMatch = url.pathname.match(/^\/v1\/task-lists\/([^/]+)$/);
        if (listMatch) {
          const task_list = find(taskLists, listMatch[1]!);
          if (!task_list) return Response.json({ error: "task list not found" }, { status: 404 });
          if (request.method === "GET") return Response.json({ task_list });
          if (request.method === "PATCH") {
            Object.assign(task_list, body, { updated_at: now });
            return Response.json({ task_list });
          }
          if (request.method === "DELETE") {
            remove(taskLists, listMatch[1]!);
            return Response.json({ deleted: true });
          }
        }

        if (url.pathname === "/v1/plans") {
          if (request.method === "GET") {
            const projectId = url.searchParams.get("project_id");
            const items = projectId ? plans.filter((item) => item.project_id === projectId) : plans;
            return Response.json({ plans: items, count: items.length });
          }
          if (request.method === "POST") {
            const plan = { id: PLAN_ID, name: body.name, slug: body.slug ?? "delivery", description: body.description ?? null, status: "active", project_id: body.project_id ?? null, task_list_id: null, created_at: now, updated_at: now };
            plans.push(plan);
            return Response.json({ plan }, { status: 201 });
          }
        }
        const planMatch = url.pathname.match(/^\/v1\/plans\/([^/]+)$/);
        if (planMatch) {
          const plan = find(plans, planMatch[1]!);
          if (!plan) return Response.json({ error: "plan not found" }, { status: 404 });
          if (request.method === "GET") return Response.json({ plan });
          if (request.method === "PATCH") {
            Object.assign(plan, body, { updated_at: now });
            return Response.json({ plan });
          }
          if (request.method === "DELETE") {
            remove(plans, planMatch[1]!);
            return Response.json({ deleted: true });
          }
        }

        if (url.pathname === "/v1/tasks/next/claim" && request.method === "POST") {
          const task = tasks.find((item) => item.status === "pending") ?? null;
          if (task) Object.assign(task, { status: "in_progress", assigned_to: body.agent_id, updated_at: now });
          return Response.json({ task });
        }
        if (url.pathname === "/v1/next" && request.method === "GET") {
          const task = tasks.find((item) => item.status === "pending") ?? null;
          return Response.json({ task });
        }
        if (url.pathname === "/v1/tasks/upsert" && request.method === "POST") {
          let task = tasks.find((item) => (item.metadata as Record<string, unknown> | undefined)?.fingerprint === body.fingerprint);
          const created = !task;
          if (!task) {
            const id = TASK_IDS[nextTaskId++]!;
            task = { id, short_id: `REMOTE-${nextTaskId}`, title: body.title, description: body.description ?? null, status: body.status ?? "pending", priority: body.priority ?? "medium", project_id: body.project_id ?? null, task_list_id: body.task_list_id ?? null, plan_id: null, parent_id: null, assigned_to: body.assigned_to ?? null, tags: body.tags ?? [], metadata: { ...(body.metadata as object ?? {}), fingerprint: body.fingerprint }, version: 1, created_at: now, updated_at: now };
            tasks.push(task);
          } else {
            Object.assign(task, body, { updated_at: now, version: Number(task.version) + 1 });
          }
          return Response.json({ task, created }, { status: created ? 201 : 200 });
        }
        if (url.pathname === "/v1/tasks") {
          if (request.method === "GET") {
            let items = [...tasks];
            for (const key of ["status", "project_id", "task_list_id", "plan_id"] as const) {
              const value = url.searchParams.get(key);
              if (value) items = items.filter((item) => value.split(",").includes(String(item[key])));
            }
            const total = items.length;
            const limit = Number(url.searchParams.get("limit") ?? items.length);
            items = items.slice(0, Number.isFinite(limit) ? limit : items.length);
            return Response.json({ tasks: items, count: items.length, total });
          }
          if (request.method === "POST") {
            const id = TASK_IDS[nextTaskId++]!;
            const task = { id, short_id: `REMOTE-${nextTaskId}`, title: body.title, description: body.description ?? null, status: body.status ?? "pending", priority: body.priority ?? "medium", project_id: body.project_id ?? null, task_list_id: body.task_list_id ?? null, plan_id: body.plan_id ?? null, parent_id: body.parent_id ?? null, assigned_to: body.assigned_to ?? null, tags: body.tags ?? [], metadata: {}, version: 1, created_at: now, updated_at: now };
            tasks.push(task);
            return Response.json({ task }, { status: 201 });
          }
        }
        const commentMatch = url.pathname.match(/^\/v1\/tasks\/([^/]+)\/comments$/);
        if (commentMatch && request.method === "POST") {
          if (!find(tasks, commentMatch[1]!)) return Response.json({ error: "task not found" }, { status: 404 });
          return Response.json({
            comment: {
              id: "comment-1",
              task_id: commentMatch[1],
              content: body.content,
              agent_id: body.agent_id ?? null,
              session_id: body.session_id ?? null,
              type: body.type ?? "comment",
              progress_pct: body.progress_pct ?? null,
              created_at: now,
            },
          }, { status: 201 });
        }
        if (commentMatch && request.method === "GET") {
          return Response.json({ comments: [], count: 0, has_more: false, next_cursor: null });
        }
        const actionMatch = url.pathname.match(/^\/v1\/tasks\/([^/]+)\/(start|complete)$/);
        if (actionMatch && request.method === "POST") {
          const task = find(tasks, actionMatch[1]!);
          if (!task) return Response.json({ error: "task not found" }, { status: 404 });
          Object.assign(task, { status: actionMatch[2] === "start" ? "in_progress" : "completed", updated_at: now, version: Number(task.version) + 1 });
          return Response.json({ task });
        }
        const taskMatch = url.pathname.match(/^\/v1\/tasks\/([^/]+)$/);
        if (taskMatch) {
          const task = find(tasks, taskMatch[1]!);
          if (!task) return Response.json({ error: "task not found" }, { status: 404 });
          if (request.method === "GET") return Response.json({ task });
          if (request.method === "PATCH") {
            Object.assign(task, body, { updated_at: now, version: Number(task.version) + 1 });
            return Response.json({ task });
          }
          if (request.method === "DELETE") {
            remove(tasks, taskMatch[1]!);
            return Response.json({ deleted: true });
          }
        }

        return Response.json({ error: `fixture route not present: ${route}` }, { status: 404 });
      },
    });

    const root = mkdtempSync(join(tmpdir(), "todos-remote-lifecycle-"));
    tempRoots.push(root);
    const cwd = join(root, "cwd");
    mkdirSync(cwd);
    const readOnlyParent = join(root, "read-only-db-parent");
    mkdirSync(readOnlyParent);
    chmodSync(readOnlyParent, 0o555);
    const localDbPath = join(readOnlyParent, "todos.db");
    const env = {
      PATH: process.env.PATH ?? "",
      BUN_INSTALL: process.env.BUN_INSTALL ?? join(process.env.HOME ?? "/home/hasna", ".bun"),
      HOME: root,
      TMPDIR: root,
      LANG: "C.UTF-8",
      TODOS_AUTO_PROJECT: "false",
      TODOS_DB_PATH: localDbPath,
      HASNA_TODOS_STORAGE_MODE: "remote",
      HASNA_TODOS_API_URL: `http://127.0.0.1:${server.port}`,
      HASNA_TODOS_API_KEY: "fixture-remote-key",
    };
    const before = recursiveInventory(cwd);

    try {
      const invocations: string[][] = [
        ["--json", "projects", "--add", "/workspace/remote", "--name", "Remote"],
        ["--json", "projects"],
        ["--json", "projects", "--show", PROJECT_ID],
        ["--json", "projects", "--update", PROJECT_ID, "--description", "updated"],
        ["--project", PROJECT_ID, "--json", "lists", "--add", "Work", "--slug", "work"],
        ["--project", PROJECT_ID, "--json", "lists"],
        ["--project", PROJECT_ID, "--json", "lists", "--show", LIST_ID],
        ["--project", PROJECT_ID, "--json", "lists", "--update", LIST_ID, "--description", "updated"],
        ["--project", PROJECT_ID, "--json", "plans", "--add", "Delivery", "--slug", "delivery"],
        ["--project", PROJECT_ID, "--json", "plans"],
        ["--project", PROJECT_ID, "--json", "plans", "--show", PLAN_ID],
        ["--project", PROJECT_ID, "--json", "plans", "--complete", PLAN_ID],
        ["--project", PROJECT_ID, "--json", "status"],
        ["--json", "health"],
        ["--json", "doctor"],
        ["--json", "add", "Remote task", "--project", PROJECT_ID, "--list", LIST_ID, "--plan", PLAN_ID],
        ["--json", "task", "upsert", "--fingerprint", "incident-593127", "--title", "Upserted task", "--project", PROJECT_ID, "--list", LIST_ID],
        ["--project", PROJECT_ID, "--json", "list", "--list", LIST_ID],
        ["--json", "show", "REMOTE-1"],
        ["--json", "inspect", "REMOTE-1"],
        ["--json", "update", "REMOTE-1", "--title", "Moved task", "--list", LIST_ID, "--plan", PLAN_ID],
        ["--json", "assign", "REMOTE-1", "fixture-agent"],
        ["--json", "tag", "REMOTE-1", "urgent"],
        ["--json", "untag", "REMOTE-1", "urgent"],
        ["--json", "comment", "REMOTE-1", "remote comment"],
        ["--json", "start", "REMOTE-1"],
        ["--json", "done", "REMOTE-1"],
        ["--project", PROJECT_ID, "--json", "next"],
        ["--json", "claim", "fixture-worker"],
      ];
      const teardownInvocations: string[][] = [
        ["--json", "delete", "REMOTE-1"],
        ["--json", "remove", "REMOTE-2"],
        ["--project", PROJECT_ID, "--json", "plans", "--delete", PLAN_ID],
        ["--project", PROJECT_ID, "--json", "lists", "--delete", LIST_ID],
      ];

      const runRemoteOk = async (invocation: string[]): Promise<string> => {
        const result = await runCli(executable, invocation, env, cwd);
        expect({ invocation, exitCode: result.exitCode, stderr: result.stderr }).toEqual({
          invocation,
          exitCode: 0,
          stderr: "",
        });
        expect(() => JSON.parse(result.stdout)).not.toThrow();
        expect(recursiveInventory(cwd)).toEqual(before);
        expectNoLocalDatabase(root, localDbPath);
        return result.stdout;
      };

      for (const invocation of invocations) {
        await runRemoteOk(invocation);
      }

      // `bulk plan|move-plan` must reassign plans through the shared dataset:
      // the plan ref is resolved remotely (no local sqlite) and each task is
      // PATCHed, so a bulk move round-trips and an unknown plan fails closed.
      const bulkTaskId = JSON.parse(
        await runRemoteOk(["--json", "add", "Bulk plan task", "--project", PROJECT_ID, "--list", LIST_ID]),
      ).id as string;
      expect(JSON.parse(await runRemoteOk(["--json", "bulk", "plan", bulkTaskId, "--plan", PLAN_ID])))
        .toMatchObject({ succeeded: 1, failed: 0 });
      expect(JSON.parse(await runRemoteOk(["--json", "show", bulkTaskId])).plan_id).toBe(PLAN_ID);
      expect(JSON.parse(await runRemoteOk(["--json", "bulk", "move-plan", bulkTaskId, "--clear-plan"])))
        .toMatchObject({ succeeded: 1, failed: 0 });
      expect(JSON.parse(await runRemoteOk(["--json", "show", bulkTaskId])).plan_id).toBeNull();
      // A non-UUID plan ref resolves remotely too, scoped by `--project` the
      // same way `add --plan` scopes it.
      expect(JSON.parse(await runRemoteOk(
        ["--project", PROJECT_ID, "--json", "bulk", "plan", bulkTaskId, "--plan", "delivery"],
      ))).toMatchObject({ succeeded: 1, failed: 0 });
      expect(JSON.parse(await runRemoteOk(["--json", "show", bulkTaskId])).plan_id).toBe(PLAN_ID);

      const unknownPlan = await runCli(
        executable,
        ["--json", "bulk", "plan", bulkTaskId, "--plan", "plan-that-does-not-exist"],
        env,
        cwd,
      );
      expect(unknownPlan.exitCode).toBe(1);
      expect(unknownPlan.stderr).not.toContain("REMOTE_COMMAND_UNSUPPORTED");
      expect(unknownPlan.stderr).toContain("plan-that-does-not-exist");
      // Fail closed: an unresolvable plan must not have moved (or detached) the task.
      expect(JSON.parse(await runRemoteOk(["--json", "show", bulkTaskId])).plan_id).toBe(PLAN_ID);
      expectNoLocalDatabase(root, localDbPath);
      await runRemoteOk(["--json", "delete", bulkTaskId]);

      for (const invocation of teardownInvocations) {
        await runRemoteOk(invocation);
      }

      expect(requests.some((request) => request.startsWith("GET /v1/projects"))).toBe(true);
      expect(requests.some((request) => request.startsWith("GET /v1/task-lists?project_id="))).toBe(true);
      expect(requests.some((request) => request.startsWith("GET /v1/plans?project_id="))).toBe(true);
      expect(requests.some((request) => request.startsWith("POST /v1/tasks/upsert"))).toBe(true);
      expect(requests.some((request) => request.startsWith("POST /v1/tasks/next/claim"))).toBe(true);
      expectNoLocalDatabase(root, localDbPath);

      const invalidMode = await runCli(executable, ["--json", "projects"], {
        ...env,
        HASNA_TODOS_STORAGE_MODE: "remtoe",
      }, cwd);
      expect(invalidMode.exitCode).toBe(1);
      expect(invalidMode.stderr).toContain("REMOTE_STORAGE_MODE_INVALID");
      expectNoLocalDatabase(root, localDbPath);

      const blankCanonical = await runCli(executable, ["--json", "projects"], {
        ...env,
        HASNA_TODOS_STORAGE_MODE: "",
        TODOS_STORAGE_MODE: "remote",
      }, cwd);
      expect(blankCanonical.exitCode).toBe(1);
      expect(blankCanonical.stderr).toContain("REMOTE_STORAGE_MODE_INVALID");
      expectNoLocalDatabase(root, localDbPath);

      const conflictingModes = await runCli(executable, ["--json", "projects"], {
        ...env,
        HASNA_TODOS_STORAGE_MODE: "local",
        TODOS_STORAGE_MODE: "remote",
      }, cwd);
      expect(conflictingModes.exitCode).toBe(1);
      expect(conflictingModes.stderr).toContain("REMOTE_STORAGE_MODE_CONFLICT");
      expectNoLocalDatabase(root, localDbPath);

      for (const unsupported of [
        ["--json", "projects", "--deregister", PROJECT_ID],
        ["--json", "projects", `--deregister=${PROJECT_ID}`],
        ["--json", "doctor", "--apply"],
        ["--project", PROJECT_ID, "--json", "plans", "--artifact", PLAN_ID],
        [`--project=${PROJECT_ID}`, "--json", "plans", `--artifact=${PLAN_ID}`],
        ["--project", PROJECT_ID, "--json", "claim", "fixture-worker"],
        [`--project=${PROJECT_ID}`, "--json", "claim", "fixture-worker"],
      ]) {
        const requestCount = requests.length;
        const result = await runCli(executable, unsupported, env, cwd);
        expect(result.exitCode).toBe(1);
        expect(result.stderr).toContain("REMOTE_COMMAND_UNSUPPORTED");
        expect(requests).toHaveLength(requestCount);
        expect(recursiveInventory(cwd)).toEqual(before);
        expectNoLocalDatabase(root, localDbPath);
      }
    } finally {
      chmodSync(readOnlyParent, 0o755);
      server.stop(true);
    }
  }, 30_000);
});
