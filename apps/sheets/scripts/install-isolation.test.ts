import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const packageRoot = join(import.meta.dir, "..");
const manifest = JSON.parse(readFileSync(join(packageRoot, "package.json"), "utf8"));

function sandbox(check: (root: string, env: Record<string, string>) => void): void {
  const root = mkdtempSync(join(tmpdir(), "sheets-install-isolation-"));
  const env: Record<string, string> = {
    PATH: process.env.PATH ?? "",
    HOME: join(root, "home"),
    XDG_CONFIG_HOME: join(root, "config"),
    XDG_DATA_HOME: join(root, "data"),
    XDG_STATE_HOME: join(root, "state"),
    XDG_CACHE_HOME: join(root, "cache"),
    BUN_RUNTIME_TRANSPILER_CACHE_PATH: join(root, "bun-cache"),
    npm_config_cache: join(root, "npm-cache"),
    npm_config_userconfig: join(root, "user.npmrc"),
    npm_config_globalconfig: join(root, "global.npmrc"),
    NO_COLOR: "1",
    FORCE_COLOR: "0",
  };
  for (const key of ["HOME", "XDG_CONFIG_HOME", "XDG_DATA_HOME", "XDG_STATE_HOME", "XDG_CACHE_HOME"]) {
    mkdirSync(env[key]!);
  }
  try { check(root, env); }
  finally { rmSync(root, { recursive: true, force: true }); }
}

function run(command: string[], cwd: string, env: Record<string, string>): string {
  const result = Bun.spawnSync(command, { cwd, env, stdout: "pipe", stderr: "pipe" });
  if (result.exitCode !== 0) {
    throw new Error(`${command[0]} failed (${result.exitCode}): ${result.stderr.toString()}`);
  }
  return result.stdout.toString();
}

function expectNoImplicitState(env: Record<string, string>): void {
  for (const key of ["HOME", "XDG_CONFIG_HOME", "XDG_DATA_HOME", "XDG_STATE_HOME", "XDG_CACHE_HOME"]) {
    expect(readdirSync(env[key]!)).toEqual([]);
  }
}

function installLifecycle(root: string, env: Record<string, string>, scripts: Record<string, string>): void {
  const fixture = join(root, "package");
  mkdirSync(fixture);
  // Exercise the real npm install lifecycle without downloading dependencies,
  // running release/build hooks, or reading the user's npm configuration.
  writeFileSync(join(fixture, "package.json"), JSON.stringify({
    name: manifest.name, version: manifest.version, private: true, scripts,
  }));
  run(["npm", "install", "--offline", "--ignore-scripts=false", "--no-package-lock",
    "--no-audit", "--no-fund", "--workspaces=false"], fixture, env);
}

describe("sheets library filesystem boundary", () => {
  test("npm install hooks do not create implicit home or XDG state", () => sandbox((root, env) => {
    const scripts = Object.fromEntries(
      ["preinstall", "install", "postinstall"]
        .filter((hook) => manifest.scripts[hook] !== undefined)
        .map((hook) => [hook, manifest.scripts[hook]]),
    );
    installLifecycle(root, env, scripts);
    expectNoImplicitState(env);
  }), 15_000);

  test("the install regression actually runs lifecycle hooks", () => sandbox((root, env) => {
    installLifecycle(root, env, {
      postinstall: 'node -e "require(\'node:fs\').writeFileSync(require(\'node:path\').join(process.env.HOME, \'lifecycle-ran\'), \'yes\')"',
    });
    expect(readFileSync(join(env.HOME!, "lifecycle-ran"), "utf8")).toBe("yes");
  }), 15_000);

  test("CLI retains explicit JSON/CSV/XLSX file writes and stdout-only output", () => sandbox((root, env) => {
    const files = join(root, "files");
    mkdirSync(files);
    const cli = (...args: string[]) => run([process.execPath, join(packageRoot, "src/cli/index.ts"), ...args], files, env);
    expect(JSON.parse(cli("new"))).toBeObject();
    expect(readdirSync(files)).toEqual([]);
    const input = join(files, "book.json");
    cli("new", "--out", input, "--name", "Boundary");
    cli("set", input, "A1", "2");
    cli("set", input, "A2", "=A1*6");
    expect(JSON.parse(cli("--json", "get", input, "A2")).value).toBe(12);
    const saved = readFileSync(input, "utf8");
    expect(cli("export-csv", input)).toContain("12");
    expect(readFileSync(input, "utf8")).toBe(saved);
    cli("recalc", input, "--out", join(files, "copy.json"));
    writeFileSync(join(files, "input.csv"), "2,3\n");
    cli("import-csv", join(files, "input.csv"), "--out", join(files, "csv.json"));
    cli("export-xlsx", input);
    expect(readFileSync(join(files, "book.xlsx")).byteLength).toBeGreaterThan(0);
    expect(readdirSync(files).sort()).toEqual(["book.json", "book.xlsx", "copy.json", "csv.json", "input.csv"]);
    expectNoImplicitState(env);
  }), 15_000);

  test("SDK, optional XLSX and React imports retain capabilities without implicit state", () => sandbox((_root, env) => {
    const output = run([process.execPath, "-e", `
      import { createWorkbook, setCells, getCellValue, loadWorkbook, serializeWorkbook,
        workbookToXlsx, xlsxToWorkbook } from "./src/index.ts";
      import { Spreadsheet } from "./src/react.tsx";
      const workbook = createWorkbook();
      setCells(workbook, { A1: "2", A2: "3", A3: "=SUM(A1:A2)" });
      const loaded = loadWorkbook(serializeWorkbook(workbook));
      const xlsx = await xlsxToWorkbook(await workbookToXlsx(workbook));
      console.log(JSON.stringify({ react: typeof Spreadsheet, value: getCellValue(loaded, "A3"),
        xlsxValue: getCellValue(xlsx, "A3") }));
    `], packageRoot, env);
    expect(JSON.parse(output)).toEqual({ react: "function", value: 5, xlsxValue: 5 });
    expectNoImplicitState(env);
  }), 15_000);
});
