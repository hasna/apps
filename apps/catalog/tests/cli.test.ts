import { describe, expect, it } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { program } from "../src/cli/index.js";
import { CatalogStore } from "../src/store.js";
import { VERSION } from "../src/version.js";
import type { App } from "../src/contracts.js";

const repoRoot = join(import.meta.dir, "..");
const cliEntry = join(repoRoot, "src", "cli", "index.ts");

/** Run the CLI as a real process so import.meta.main and exit codes are real. */
function runCli(args: string[], options: { cwd?: string } = {}): { status: number; stdout: string; stderr: string } {
  const result = spawnSync("bun", [cliEntry, ...args], {
    cwd: options.cwd ?? repoRoot,
    encoding: "utf8",
  });
  return { status: result.status ?? -1, stdout: result.stdout ?? "", stderr: result.stderr ?? "" };
}

// The CLI is a thin layer over the store/seed/site functions, but its own
// behavior — flag validation, error exits, and output shaping — is not covered
// by the command-list assertions in contract.manifest.test.ts. These tests
// drive `program.parse` with an exitOverride so failures surface as throws
// instead of process exits.

function makeApp(appId: string, overrides: Partial<App> = {}): App {
  return {
    schema: "hasna.app.v1",
    id: `app_${appId.replaceAll("-", "_")}`,
    createdAt: "2026-07-06T08:00:00.000Z",
    appId,
    npmName: `@example/${appId.replace(/^open-/, "")}`,
    repoFolder: appId,
    githubUrl: `https://github.com/example/${appId}`,
    projectSlug: appId,
    surfaces: { bins: [] },
    lifecycle: "active",
    releaseChannel: "stable",
    tags: ["oss"],
    ...overrides,
  } as App;
}

function parseWith(args: string[]): { error: string | null; output: string[] } {
  const output: string[] = [];
  const originalLog = console.log;
  const originalError = console.error;
  const originalStderrWrite = process.stderr.write;
  console.log = (...values: unknown[]) => {
    output.push(values.map(String).join(" "));
  };
  console.error = () => {};
  // commander's program.error writes directly to process.stderr; keep the test
  // output clean without changing what the CLI prints in real use.
  process.stderr.write = (() => true) as typeof process.stderr.write;
  let error: string | null = null;
  try {
    program.exitOverride((err) => {
      throw new Error(String(err.message));
    });
    program.parse(["node", "catalog", ...args]);
  } catch (caught) {
    error = (caught as Error).message;
  } finally {
    console.log = originalLog;
    console.error = originalError;
    process.stderr.write = originalStderrWrite;
  }
  return { error, output };
}

function makeDbFixture(dir: string): string {
  const dbPath = join(dir, "catalog.db");
  const store = new CatalogStore({ dbPath });
  store.upsertApps([makeApp("open-alpha", { summary: "Task tracking" })]);
  store.close();
  return dbPath;
}

describe("catalog CLI", () => {
  it("rejects an invalid --lifecycle value instead of querying with it", () => {
    const dir = mkdtempSync(join(tmpdir(), "catalog-cli-"));
    try {
      const db = makeDbFixture(dir);
      const { error } = parseWith(["list", "--db", db, "--lifecycle", "nope"]);
      expect(error).toContain("invalid --lifecycle: nope");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("errors on get of a missing app", () => {
    const dir = mkdtempSync(join(tmpdir(), "catalog-cli-"));
    try {
      const db = makeDbFixture(dir);
      const { error } = parseWith(["get", "--db", db, "missing-app"]);
      expect(error).toContain("app not found: missing-app");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("prints the human list format with version and lifecycle columns", () => {
    const dir = mkdtempSync(join(tmpdir(), "catalog-cli-"));
    try {
      const db = makeDbFixture(dir);
      const { error, output } = parseWith(["list", "--db", db]);
      expect(error).toBeNull();
      expect(output.join("\n")).toContain("open-alpha");
      expect(output.join("\n")).toContain("@example/alpha");
      expect(output.join("\n")).toContain("active");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("prints JSON for list --json", () => {
    const dir = mkdtempSync(join(tmpdir(), "catalog-cli-"));
    try {
      const db = makeDbFixture(dir);
      const { error, output } = parseWith(["list", "--db", db, "--json"]);
      expect(error).toBeNull();
      const parsed = JSON.parse(output.join("\n")) as Array<{ appId: string }>;
      expect(parsed.map((app) => app.appId)).toEqual(["open-alpha"]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("prints a friendly empty message when no apps match", () => {
    const dir = mkdtempSync(join(tmpdir(), "catalog-cli-"));
    try {
      const db = makeDbFixture(dir);
      const { error, output } = parseWith(["list", "--db", db, "--lifecycle", "archived"]);
      expect(error).toBeNull();
      expect(output.join("\n")).toContain("No apps found.");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("imports a JSONL fixture through the CLI", () => {
    const dir = mkdtempSync(join(tmpdir(), "catalog-cli-"));
    try {
      const db = join(dir, "import.db");
      const fixture = join(dir, "apps.jsonl");
      writeFileSync(fixture, `${JSON.stringify(makeApp("open-imported"))}\n`);
      const { error, output } = parseWith(["import", fixture, "--db", db]);
      expect(error).toBeNull();
      expect(output.join("\n")).toContain("Imported 1 apps.");
      const store = new CatalogStore({ dbPath: db });
      expect(store.getApp("open-imported")?.appId).toBe("open-imported");
      store.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("catalog CLI as a real process", () => {
  it("exits nonzero on get of a missing app and prints nothing to stdout", () => {
    const dir = mkdtempSync(join(tmpdir(), "catalog-cli-proc-"));
    try {
      const db = join(dir, "catalog.db");
      const result = runCli(["get", "--db", db, "missing-app"]);
      expect(result.status).not.toBe(0);
      expect(result.stdout).toBe("");
      expect(result.stderr).toContain("app not found: missing-app");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("exits nonzero on a malformed JSONL import and changes nothing", () => {
    const dir = mkdtempSync(join(tmpdir(), "catalog-cli-proc-"));
    try {
      const db = join(dir, "catalog.db");
      const fixture = join(dir, "bad.jsonl");
      writeFileSync(fixture, "not-json\n");
      const result = runCli(["import", fixture, "--db", db]);
      expect(result.status).not.toBe(0);
      expect(result.stdout).not.toContain("Imported");
      const store = new CatalogStore({ dbPath: db });
      expect(store.countApps()).toBe(0);
      store.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("exits zero with exact stdout for --version and no stderr", () => {
    const result = runCli(["--version"]);
    expect(result.status).toBe(0);
    expect(result.stdout.trim()).toBe(VERSION);
    expect(result.stderr).toBe("");
  });
});
