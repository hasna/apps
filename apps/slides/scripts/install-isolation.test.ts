import { describe, expect, test } from "bun:test";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const packageRoot = join(import.meta.dir, "..");
const manifest = JSON.parse(readFileSync(join(packageRoot, "package.json"), "utf8"));

function sandbox(check: (root: string, env: Record<string, string>) => void): void {
  const root = mkdtempSync(join(tmpdir(), "slides-install-isolation-"));
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

function installLifecycle(root: string, env: Record<string, string>, scripts: Record<string, string>, configure?: (fixture: string) => void): void {
  const fixture = join(root, "package");
  mkdirSync(fixture);
  // Exercise the real npm install lifecycle without downloading dependencies,
  // running release/build hooks, or reading the user's npm configuration.
  writeFileSync(join(fixture, "package.json"), JSON.stringify({
    name: manifest.name, version: manifest.version, private: true, scripts,
  }));
  configure?.(fixture);
  run(["npm", "install", "--offline", "--ignore-scripts=false", "--no-package-lock",
    "--no-audit", "--no-fund", "--workspaces=false"], fixture, env);
}

describe("slides library filesystem boundary", () => {
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

  test("the guarded source-dashboard bootstrap remains unchanged and actually runs", () => sandbox((root, env) => {
    expect(manifest.scripts.postinstall).toBe("if test -f dashboard/package.json; then cd dashboard && bun install --frozen-lockfile; fi");
    const bin = join(root, "bin");
    mkdirSync(bin);
    const stub = join(bin, "bun");
    writeFileSync(stub, '#!/bin/sh\nprintf \'%s\\n\' "$PWD" "$*" > "$BOOTSTRAP_MARKER"\n');
    chmodSync(stub, 0o755);
    env.PATH = bin + ":" + env.PATH;
    env.BOOTSTRAP_MARKER = join(root, "bootstrap-ran");
    installLifecycle(root, env, { postinstall: manifest.scripts.postinstall }, (fixture) => {
      mkdirSync(join(fixture, "dashboard"));
      writeFileSync(join(fixture, "dashboard/package.json"), '{"private":true}');
    });
    expect(readFileSync(env.BOOTSTRAP_MARKER, "utf8")).toBe(realpathSync(join(root, "package/dashboard")) + "\ninstall --frozen-lockfile\n");
    expectNoImplicitState(env);
  }), 15_000);

  test("SDK and SSR-safe React retain deck, Markdown, CDN and inline-export capabilities", () => sandbox((_root, env) => {
    const output = run([process.execPath, "-e", `
      import { createDeck, loadDeck, serializeDeck, parseMarkdownDeck, exportDeckHtml } from "./src/index.ts";
      import { Presentation, Deck, DeckViewer } from "./src/react/index.tsx";
      const deck = createDeck({ title: "Boundary", theme: "moon" });
      const first = deck.addSlide({ body: "# First", notes: "Speaker", fragments: ["Fragment"] });
      deck.addChild(first.id, { body: "## Child" });
      const loaded = loadDeck(serializeDeck(deck.toJSON()));
      const cdn = loaded.toHtml();
      const inline = exportDeckHtml(loaded.toJSON(), { assets: {
        revealCss: ".reveal{}", themeCss: ".moon{}", revealJs: "var Reveal={};",
        markdownJs: "var RevealMarkdown={};", notesJs: "var RevealNotes={};"
      } });
      console.log(JSON.stringify({ react: typeof Presentation,
        aliases: Presentation === Deck && Deck === DeckViewer,
        childCount: loaded.toJSON().slides[0].children.length,
        markdownSlides: parseMarkdownDeck("# One\\n\\n---\\n\\n# Two").length,
        cdn: cdn.includes("https://cdn.jsdelivr.net/npm/reveal.js@6.0.1"),
        notes: cdn.includes("Speaker"), fragments: cdn.includes("Fragment"),
        inline: inline.includes(".reveal{}") && !inline.includes("cdn.jsdelivr.net") }));
    `], packageRoot, env);
    expect(JSON.parse(output)).toEqual({ react: "function", aliases: true, childCount: 1,
      markdownSlides: 2, cdn: true, notes: true, fragments: true, inline: true });
    expectNoImplicitState(env);
  }));
});
