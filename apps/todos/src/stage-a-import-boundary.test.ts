import { describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const REPO_ROOT = join(import.meta.dir, "..");
const PRELOAD = join(REPO_ROOT, "src/test/stage-a-import-tripwire-preload.ts");

function source(relative: string): string {
  return readFileSync(new URL(relative, import.meta.url), "utf8");
}

describe("Stage-A authority-before-runtime import boundaries", () => {
  test("MCP public bootstraps do not statically import transports, tools, or SQLite graphs", () => {
    const index = source("./mcp/index.ts");
    const http = source("./mcp/http.ts");

    expect(index).not.toMatch(/^import .*@modelcontextprotocol\/sdk/m);
    expect(index).not.toMatch(/^import .*\.\/tools\//m);
    expect(index).not.toMatch(/^import .*\.\.\/db\//m);
    expect(index).toContain("assertTodosLocalStorageRole(process.env)");
    expect(index).toContain('const runtimeUrl = import.meta.url.endsWith(".ts")');
    expect(index).toContain('new URL("../mcp/runtime.js", import.meta.url)');
    expect(index).toContain("require(runtimeUrl.href)");

    expect(http).not.toMatch(/^import .*@modelcontextprotocol\/sdk/m);
    expect(http).not.toMatch(/^import .*\.\/index\.js/m);
    expect(http).toContain("containHostedDatastoreSurface");
    expect(http).toMatch(/await import\(["']@modelcontextprotocol\/sdk\/server\/webStandardStreamableHttp\.js["']\)/);
  });

  test("storage factory and snapshot public graphs defer local runtime modules until after authority", () => {
    const factory = source("./storage/factory.ts");
    const snapshot = source("./storage/sqlite-snapshot.ts");
    const publicStorage = source("./storage.ts");

    expect(factory).not.toMatch(/^import .*\.\/local-sqlite\.js/m);
    expect(factory).toMatch(/assertTodosLocalStorageRole\(process\.env\)[\s\S]*require\(ownerPath\)/);

    expect(snapshot).not.toMatch(/^import .*\.\.\/db\//m);
    expect(snapshot).not.toMatch(/^import(?! type).*bun:sqlite/m);
    expect(snapshot).toMatch(/assertTodosLocalStorageRole\(process\.env\)[\s\S]*require\(ownerPath\)/);

    expect(publicStorage).not.toMatch(/^export \{ createLocalSqliteTodosStorageAdapter \} from ["']\.\/storage\/local-sqlite\.js["']/m);
  });

  test.each([
    ["root export", "src/index.ts", "import"],
    ["SDK export", "src/sdk/index.ts", "import"],
    ["MCP manifest export", "src/mcp.ts", "import"],
    ["registry export", "src/registry.ts", "import"],
    ["contracts export", "src/contracts.ts", "import"],
    ["storage export", "src/storage.ts", "import"],
    ["storage provider helper", "src/storage.ts", "storage-s3-key"],
    ["storage direct index export", "src/storage/index.ts", "import"],
    ["storage direct provider helper", "src/storage/index.ts", "storage-s3-key"],
    ["MCP constructor", "src/mcp/index.ts", "mcp-build"],
    ["MCP HTTP direct", "src/mcp/http.ts", "mcp-http"],
    ["MCP HTTP startup", "src/mcp/http.ts", "mcp-start"],
    ["storage factory direct", "src/storage/factory.ts", "storage-factory"],
    ["snapshot export direct", "src/storage/sqlite-snapshot.ts", "snapshot-export"],
    ["snapshot import direct", "src/storage/sqlite-snapshot.ts", "snapshot-import"],
    ["local adapter through public storage", "src/storage.ts", "storage-local"],
    ["factory through public storage", "src/storage.ts", "storage-factory"],
    ["snapshot through public storage", "src/storage.ts", "snapshot-export"],
  ] as const)("%s rejects or imports without forbidden transitive modules or side effects", (_label, relative, action) => {
    const root = mkdtempSync(join(tmpdir(), "todos-stage-a-import-tripwire-"));
    const target = pathToFileURL(join(REPO_ROOT, relative)).href;
    const code = `
      process.argv[1] = "stage-a-import-smoke";
      const module = await import(process.env.STAGE_A_TARGET);
      const warmModule = await import(process.env.STAGE_A_TARGET);
      if (module !== warmModule) throw new Error("expected warm import cache identity");
      const expectFloor = (callback) => {
        try { callback(); } catch (error) {
          if (error && error.code === "HOSTED_AUTHORITY_UNAVAILABLE") return;
          throw error;
        }
        throw new Error("expected Stage-A authority floor");
      };
      if (process.env.STAGE_A_ACTION === "mcp-build") expectFloor(() => module.buildServer());
      if (process.env.STAGE_A_ACTION === "mcp-http") {
        const response = await module.handleMcpHttpRequest(
          new Request("https://todos.example.invalid/mcp", { method: "POST" }),
        );
        if (response.status !== 503) throw new Error("expected hosted MCP containment");
      }
      if (process.env.STAGE_A_ACTION === "mcp-start") expectFloor(() => module.resolveStartHttpServerOptions());
      if (process.env.STAGE_A_ACTION === "storage-factory") expectFloor(() => module.createTodosStorageAdapter());
      if (process.env.STAGE_A_ACTION === "storage-local") expectFloor(() => module.createLocalSqliteTodosStorageAdapter());
      if (process.env.STAGE_A_ACTION === "storage-s3-key") expectFloor(() => module.buildS3ObjectKey(new Proxy({}, { get() { throw new Error("CALLER_READ"); } }), "fixture"));
      if (process.env.STAGE_A_ACTION === "snapshot-export") expectFloor(() => module.exportSqliteTodosStorageSnapshot());
      if (process.env.STAGE_A_ACTION === "snapshot-import") expectFloor(() => module.importSqliteTodosStorageSnapshot({}));
      console.log("STAGE_A_IMPORT_SMOKE_OK");
    `;
    try {
      const result = Bun.spawnSync(["bun", "--preload", PRELOAD, "-e", code], {
        cwd: root,
        env: {
          PATH: process.env.PATH ?? "",
          HOME: root,
          TMPDIR: root,
          LANG: "C.UTF-8",
          HASNA_TODOS_STORAGE_MODE: "remote",
          TODOS_STORAGE_MODE: "remote",
          TODOS_DB_PATH: join(root, "tripwire.db"),
          TODOS_AUTO_PROJECT: "false",
          STAGE_A_TARGET: target,
          STAGE_A_ACTION: action,
          STAGE_A_TRIPWIRE_IMPORTS: "1",
        },
        stdout: "pipe",
        stderr: "pipe",
      });
      const output = `${result.stdout.toString()}\n${result.stderr.toString()}`;
      expect(result.exitCode, output).toBe(0);
      expect(output).toContain("STAGE_A_IMPORT_SMOKE_OK");
      expect(output).not.toContain("STAGE_A_IMPORT_TRIPWIRE");
      expect(existsSync(join(root, "tripwire.db"))).toBe(false);
      expect(readdirSync(root).filter((name) => /(?:\.db|\.sqlite)(?:-(?:wal|shm))?$|-(?:wal|shm)$/.test(name))).toEqual([]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test.each([
    ["todos", ["src/cli/index.tsx", "--json", "list"]],
    ["todos-mcp", ["src/mcp/index.ts"]],
    ["todos-serve operator", ["src/server/index.ts", "migrate", "--json"]],
  ] as const)("source public bin %s rejects before runtime side effects", (_label, relativeArgs) => {
    const root = mkdtempSync(join(tmpdir(), "todos-stage-a-bin-tripwire-"));
    const [entry, ...args] = relativeArgs;
    try {
      const result = Bun.spawnSync([
        "bun", "--preload", PRELOAD, join(REPO_ROOT, entry), ...args,
      ], {
        cwd: root,
        env: {
          PATH: process.env.PATH ?? "",
          HOME: root,
          TMPDIR: root,
          LANG: "C.UTF-8",
          HASNA_TODOS_STORAGE_MODE: "remote",
          TODOS_STORAGE_MODE: "remote",
          TODOS_DB_PATH: join(root, "tripwire.db"),
          TODOS_AUTO_PROJECT: "false",
          STAGE_A_TRIPWIRE_IMPORTS: "1",
        },
        stdout: "pipe",
        stderr: "pipe",
      });
      const output = `${result.stdout.toString()}\n${result.stderr.toString()}`;
      expect(result.exitCode).not.toBe(0);
      expect(output).toContain("HOSTED_AUTHORITY_UNAVAILABLE");
      expect(output).not.toContain("STAGE_A_IMPORT_TRIPWIRE");
      expect(existsSync(join(root, "tripwire.db"))).toBe(false);
      expect(readdirSync(root).filter((name) => /(?:\.db|\.sqlite)(?:-(?:wal|shm))?$|-(?:wal|shm)$/.test(name))).toEqual([]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("install-free built bins and exports preserve the same hosted preload boundary", () => {
    const root = mkdtempSync(join(tmpdir(), "todos-stage-a-built-tripwire-"));
    const outputRoot = join(root, "build");
    const buildCommands = [
      ["bun", "build", join(REPO_ROOT, "src/cli/index.tsx"), "--outdir", join(outputRoot, "cli"), "--target", "bun", "--splitting", "--external", "ink", "--external", "react", "--external", "chalk", "--external", "@modelcontextprotocol/sdk"],
      ["bun", "build", join(REPO_ROOT, "src/mcp/index.ts"), "--outdir", join(outputRoot, "mcp-bin"), "--target", "bun", "--external", "@modelcontextprotocol/sdk"],
      ["bun", "build", join(REPO_ROOT, "src/mcp/runtime.ts"), "--outfile", join(outputRoot, "mcp-bin/runtime.js"), "--target", "bun", "--external", "@modelcontextprotocol/sdk"],
      ["bun", "build", join(REPO_ROOT, "src/storage/local-sqlite.ts"), "--outfile", join(outputRoot, "public/storage/local-sqlite.js"), "--target", "bun"],
      ["bun", "build", join(REPO_ROOT, "src/storage/sqlite-snapshot-runtime.ts"), "--outfile", join(outputRoot, "public/storage/sqlite-snapshot-runtime.js"), "--target", "bun"],
      ["bun", "build", join(REPO_ROOT, "src/storage/stage-a-public-helper-runtime.ts"), "--outfile", join(outputRoot, "public/storage/stage-a-public-helper-runtime.js"), "--target", "bun"],
      ["bun", "build", join(REPO_ROOT, "src/server/index.ts"), "--outdir", join(outputRoot, "server"), "--target", "bun"],
      ["bun", "build", join(REPO_ROOT, "src/sdk/index.ts"), "--outdir", join(outputRoot, "sdk"), "--target", "bun"],
      ["bun", "build", join(REPO_ROOT, "src/index.ts"), join(REPO_ROOT, "src/mcp.ts"), join(REPO_ROOT, "src/registry.ts"), join(REPO_ROOT, "src/contracts.ts"), join(REPO_ROOT, "src/storage.ts"), "--outdir", join(outputRoot, "public"), "--target", "bun"],
      ["bun", "build", join(REPO_ROOT, "src/storage/index.ts"), "--outfile", join(outputRoot, "direct-storage/index.js"), "--target", "bun"],
    ];
    const baseEnvironment = {
      PATH: process.env.PATH ?? "",
      HOME: root,
      TMPDIR: root,
      LANG: "C.UTF-8",
      HASNA_TODOS_STORAGE_MODE: "remote",
      TODOS_STORAGE_MODE: "remote",
      TODOS_DB_PATH: join(root, "tripwire.db"),
      TODOS_AUTO_PROJECT: "false",
    };
    const run = (args: string[], extraEnvironment: Record<string, string> = {}) => Bun.spawnSync(args, {
      cwd: root,
      env: { ...baseEnvironment, ...extraEnvironment },
      stdout: "pipe",
      stderr: "pipe",
    });
    try {
      for (const command of buildCommands) {
        const result = run(command);
        expect(result.exitCode, result.stderr.toString()).toBe(0);
      }

      for (const target of [
        join(outputRoot, "public/index.js"),
        join(outputRoot, "public/mcp.js"),
        join(outputRoot, "public/registry.js"),
        join(outputRoot, "public/contracts.js"),
        join(outputRoot, "public/storage.js"),
        join(outputRoot, "direct-storage/index.js"),
        join(outputRoot, "sdk/index.js"),
      ]) {
        const result = run([
          "bun", "--preload", PRELOAD, "-e",
          'process.argv[1]="stage-a-built-import"; const first=await import(process.env.STAGE_A_TARGET); const second=await import(process.env.STAGE_A_TARGET); if(first!==second) throw new Error("expected warm import cache identity"); console.log("STAGE_A_BUILT_IMPORT_OK")',
        ], { STAGE_A_TARGET: pathToFileURL(target).href, STAGE_A_TRIPWIRE_IMPORTS: "1" });
        const output = `${result.stdout.toString()}\n${result.stderr.toString()}`;
        expect(result.exitCode, output).toBe(0);
        expect(output).toContain("STAGE_A_BUILT_IMPORT_OK");
        expect(output).not.toContain("STAGE_A_IMPORT_TRIPWIRE");
      }

      const builtStorageSource = readFileSync(join(outputRoot, "public/storage.js"), "utf8");
      expect(builtStorageSource).not.toMatch(/^import .*bun:sqlite/m);
      expect(builtStorageSource).not.toContain("src/db/database.ts");

      for (const [target, expression] of [
        [join(outputRoot, "mcp-bin/index.js"), "module.buildServer()"],
        [join(outputRoot, "public/storage.js"), "module.createLocalSqliteTodosStorageAdapter()"],
        [join(outputRoot, "public/storage.js"), "module.createTodosStorageAdapter()"],
        [join(outputRoot, "public/storage.js"), "module.exportSqliteTodosStorageSnapshot()"],
      ] as const) {
        const result = run([
          "bun", "--preload", PRELOAD, "-e",
          `process.argv[1]="stage-a-built-call"; const module=await import(process.env.STAGE_A_TARGET); try { ${expression}; } catch (error) { if (error?.code === "HOSTED_AUTHORITY_UNAVAILABLE") { console.log("STAGE_A_BUILT_FLOOR_OK"); } else { throw error; } }`,
        ], { STAGE_A_TARGET: pathToFileURL(target).href, STAGE_A_TRIPWIRE_IMPORTS: "1" });
        const output = `${result.stdout.toString()}\n${result.stderr.toString()}`;
        expect(result.exitCode, output).toBe(0);
        expect(output).toContain("STAGE_A_BUILT_FLOOR_OK");
        expect(output).not.toContain("STAGE_A_IMPORT_TRIPWIRE");
      }

      for (const [entry, args] of [
        [join(outputRoot, "cli/index.js"), ["--json", "list"]],
        [join(outputRoot, "mcp-bin/index.js"), []],
        [join(outputRoot, "server/index.js"), ["migrate", "--json"]],
      ] as const) {
        const result = run(["bun", "--preload", PRELOAD, entry, ...args], {
          STAGE_A_TRIPWIRE_IMPORTS: "1",
        });
        const output = `${result.stdout.toString()}\n${result.stderr.toString()}`;
        expect(result.exitCode).not.toBe(0);
        expect(output).toContain("HOSTED_AUTHORITY_UNAVAILABLE");
        expect(output).not.toContain("STAGE_A_IMPORT_TRIPWIRE");
      }

      expect(existsSync(join(root, "tripwire.db"))).toBe(false);
      expect(existsSync(join(root, "tripwire.db-wal"))).toBe(false);
      expect(existsSync(join(root, "tripwire.db-shm"))).toBe(false);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }, 30_000);
});
