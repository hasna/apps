import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const packageRoot = join(import.meta.dir, "..");
const manifest = JSON.parse(readFileSync(join(packageRoot, "package.json"), "utf8"));

function sandbox(check: (root: string, env: Record<string, string>) => void): void {
  const root = mkdtempSync(join(tmpdir(), "docs-install-isolation-"));
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

describe("docs library filesystem boundary", () => {
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

  test("CLI reads only the caller's file and prints conversions, outline, and stats", () => sandbox((root, env) => {
    const files = join(root, "files");
    mkdirSync(files);
    const input = join(files, "input.md");
    const markdown = "# Install boundary\n\nHello world.\n";
    writeFileSync(input, markdown);
    const cli = (...args: string[]) => run([process.execPath, join(packageRoot, "src/cli/index.ts"), ...args], files, env);
    expect(cli("convert", input, "--to", "html")).toContain("<h1>Install boundary</h1>");
    expect(JSON.parse(cli("convert", input, "--to", "json")).type).toBe("doc");
    expect(cli("convert", input, "--to", "text")).toContain("Hello world.");
    expect(cli("outline", input)).toContain("h1 Install boundary");
    expect(cli("stats", input)).toMatch(/Words\s+4/);
    expect(readFileSync(input, "utf8")).toBe(markdown);
    expect(readdirSync(files)).toEqual(["input.md"]);
    expectNoImplicitState(env);
  }));

  test("SDK and React entry points retain their public capabilities without implicit state", () => sandbox((_root, env) => {
    const output = run([process.execPath, "-e", `
      import { Document } from "./src/index.ts";
      import { Editor, Toolbar } from "./src/react/index.ts";
      const doc = Document.fromMarkdown("# Title\\n\\nHello world.");
      if (typeof Editor !== "function" || typeof Toolbar !== "function") throw new Error("React exports missing");
      console.log(JSON.stringify({ text: doc.toText(), outline: doc.outline(), words: doc.stats().words,
        roundtrip: Document.fromJSON(doc.toJSON()).toMarkdown() === doc.toMarkdown() }));
    `], packageRoot, env);
    expect(JSON.parse(output)).toMatchObject({ text: "Title\nHello world.", words: 3, roundtrip: true });
    expect(JSON.parse(output).outline[0].text).toBe("Title");
    expectNoImplicitState(env);
  }));
});
