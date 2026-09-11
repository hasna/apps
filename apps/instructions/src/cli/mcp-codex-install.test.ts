import { describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { makeTempRoot } from "../lib/test-temp-root";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "../..");

const API_URL_ENV = "HASNA_INSTRUCTIONS_API_URL";
const API_KEY_ENV = "HASNA_INSTRUCTIONS_API_KEY";
const LOCAL_OPT_IN_ENV = "HASNA_INSTRUCTIONS_LOCAL";
const DB_PATH_ENV = "HASNA_INSTRUCTIONS_DB_PATH";

/** Every name that can select a hosted transport, for a scrubbed probe. */
const AUTHORITY_SCRUB = [
  API_URL_ENV,
  API_KEY_ENV,
  "INSTRUCTIONS_API_URL",
  "INSTRUCTIONS_API_KEY",
  "HASNA_INSTRUCTIONS_API_KEY_OVERRIDE",
  "HASNA_INSTRUCTIONS_API_KEY_REF",
  "HASNA_PROFILE",
  "HASNA_CONFIGS_HOME",
  "HASNA_CONFIG_HOME",
  "HASNA_DATA_HOME",
  "HASNA_STATE_HOME",
  "HASNA_CACHE_HOME",
];

function runCli(args: string[], home: string, dbPath: string) {
  const childEnv: Record<string, string> = { ...(process.env as Record<string, string>) };
  for (const key of AUTHORITY_SCRUB) {
    delete childEnv[key];
  }
  return spawnSync("bun", ["src/cli/index.tsx", ...args], {
    cwd: repoRoot,
    encoding: "utf8",
    env: {
      ...childEnv,
      HOME: home,
      USER: "tester",
      [LOCAL_OPT_IN_ENV]: "1",
      [DB_PATH_ENV]: dbPath,
      NO_COLOR: "1",
      FORCE_COLOR: "0",
    },
  });
}

/**
 * mcp install/uninstall must be fully reversible for EVERY agent it can write
 * to (regression for the ENOENT crash on a machine with no ~/.codex yet and the
 * missing --codex/--antigravity uninstall paths). All agent config files live
 * under the redirected HOME, and the store is the local opt-in with a throwaway
 * DB, so the probes never touch the machine's real setup.
 */
describe("mcp install/uninstall parity", () => {
  test("codex install creates ~/.codex and uninstall strips only its block", () => {
    const home = makeTempRoot("mcp-codex-");
    const dbPath = join(home, "instructions.db");

    const installed = runCli(["mcp", "install", "--codex"], home, dbPath);
    expect(installed.status).toBe(0);
    expect(installed.stdout).toContain("Installed into Codex");

    const configPath = join(home, ".codex", "config.toml");
    expect(existsSync(configPath)).toBe(true);
    expect(readFileSync(configPath, "utf-8")).toContain("[mcp_servers.configs]");

    // Idempotent second install.
    const again = runCli(["mcp", "install", "--codex"], home, dbPath);
    expect(again.status).toBe(0);
    expect(again.stdout).toContain("Already installed in Codex");

    // Other sections must survive uninstall; only the configs block goes.
    writeFileSync(
      configPath,
      `[model]\nprovider = "anthropic"\n\n[mcp_servers.configs]\ncommand = "/configs-mcp"\nargs = []\n\n[mcp_servers.echo]\ncommand = "echo"\n`,
      "utf-8",
    );
    const removed = runCli(["mcp", "uninstall", "--codex"], home, dbPath);
    expect(removed.status).toBe(0);
    expect(removed.stdout).toContain("Removed from Codex");
    const remaining = readFileSync(configPath, "utf-8");
    expect(remaining).not.toContain("mcp_servers.configs");
    expect(remaining).toContain('[model]\nprovider = "anthropic"');
    expect(remaining).toContain("[mcp_servers.echo]");

    // Uninstall is idempotent too.
    const gone = runCli(["mcp", "uninstall", "--codex"], home, dbPath);
    expect(gone.status).toBe(0);
    expect(gone.stdout).toContain("Not installed in Codex");
  });

  /**
   * The marker text also occurs where it is not an install: commented out, or
   * inside a quoted value. Splicing on the first textual occurrence ends the
   * prefix mid-comment/mid-string, which comments out the NEXT table and leaves
   * an unterminated TOML string. Uninstall must leave such a file byte-identical.
   */
  test("codex uninstall never splices a commented-out or quoted marker", () => {
    const home = makeTempRoot("mcp-codex-marker-");
    const dbPath = join(home, "instructions.db");
    mkdirSync(join(home, ".codex"), { recursive: true });
    const configPath = join(home, ".codex", "config.toml");

    // The natural way a user parks an install instead of uninstalling.
    const commented = `[model]\nprovider = "anthropic"\n\n# [mcp_servers.configs] disabled for now\n# command = "/configs-mcp"\n\n[mcp_servers.echo]\ncommand = "echo"\n`;
    writeFileSync(configPath, commented, "utf-8");
    const removed = runCli(["mcp", "uninstall", "--codex"], home, dbPath);
    expect(removed.status).toBe(0);
    expect(removed.stdout).toContain("Not installed in Codex");
    expect(readFileSync(configPath, "utf-8")).toBe(commented);

    const quoted = `[model]\nprovider = "anthropic"\nnote = "see [mcp_servers.configs] docs"\n\n[mcp_servers.echo]\ncommand = "echo"\n`;
    writeFileSync(configPath, quoted, "utf-8");
    const removedQuoted = runCli(["mcp", "uninstall", "--codex"], home, dbPath);
    expect(removedQuoted.status).toBe(0);
    expect(removedQuoted.stdout).toContain("Not installed in Codex");
    expect(readFileSync(configPath, "utf-8")).toBe(quoted);
  });

  test("codex uninstall strips the real table with a comment nearby, and install re-enables it", () => {
    const home = makeTempRoot("mcp-codex-nearby-");
    const dbPath = join(home, "instructions.db");
    mkdirSync(join(home, ".codex"), { recursive: true });
    const configPath = join(home, ".codex", "config.toml");

    // A comment MENTIONS the marker before the real table: the real table is
    // the target, the comment is not, and the next server survives.
    writeFileSync(
      configPath,
      `# [mcp_servers.configs] was here\n[model]\nprovider = "anthropic"\n\n[mcp_servers.configs]\ncommand = "/configs-mcp"\nargs = []\n\n[mcp_servers.echo]\ncommand = "echo"\n`,
      "utf-8",
    );
    const removed = runCli(["mcp", "uninstall", "--codex"], home, dbPath);
    expect(removed.status).toBe(0);
    expect(removed.stdout).toContain("Removed from Codex");
    const remaining = readFileSync(configPath, "utf-8");
    expect(remaining).not.toContain("\n[mcp_servers.configs]");
    expect(remaining).toContain("# [mcp_servers.configs] was here");
    expect(remaining).toContain("[mcp_servers.echo]");

    // Install after a commented-out block must re-add the real table rather
    // than reporting "already installed" off the comment text.
    writeFileSync(
      configPath,
      `[model]\nprovider = "anthropic"\n\n# [mcp_servers.configs] disabled\n\n[mcp_servers.echo]\ncommand = "echo"\n`,
      "utf-8",
    );
    const reinstalled = runCli(["mcp", "install", "--codex"], home, dbPath);
    expect(reinstalled.status).toBe(0);
    expect(reinstalled.stdout).toContain("Installed into Codex");
    expect(readFileSync(configPath, "utf-8")).toContain("\n[mcp_servers.configs]\n");
  });

  /**
   * TOML allows a trailing comment on a table header (`[a.b] # note`). Reading
   * the header by exact text misses that, so install appended a SECOND
   * `[mcp_servers.configs]` table — invalid TOML (duplicate declaration), Codex
   * can no longer parse its config — while uninstall reported "not installed"
   * and left the server registered. Every equivalent spelling of the header
   * names the same table.
   */
  test("codex install/uninstall recognize a header carrying trailing text", () => {
    const home = makeTempRoot("mcp-codex-header-comment-");
    const dbPath = join(home, "instructions.db");
    mkdirSync(join(home, ".codex"), { recursive: true });
    const configPath = join(home, ".codex", "config.toml");

    const withComment = `[mcp_servers.configs] # hasna managed\ncommand = "/configs-mcp"\nargs = []\n\n[mcp_servers.echo]\ncommand = "echo"\n`;
    writeFileSync(configPath, withComment, "utf-8");

    // Install must see the existing table and write nothing (no duplicate).
    const installed = runCli(["mcp", "install", "--codex"], home, dbPath);
    expect(installed.status).toBe(0);
    expect(installed.stdout).toContain("Already installed in Codex");
    expect(readFileSync(configPath, "utf-8")).toBe(withComment);

    // Uninstall must strip that table and leave the other server intact.
    const removed = runCli(["mcp", "uninstall", "--codex"], home, dbPath);
    expect(removed.status).toBe(0);
    expect(removed.stdout).toContain("Removed from Codex");
    const remaining = readFileSync(configPath, "utf-8");
    expect(remaining).not.toContain("mcp_servers.configs");
    expect(remaining).toContain("[mcp_servers.echo]");

    // Whitespace and quoted key PARTS are the same table in TOML.
    for (const header of ["[ mcp_servers.configs ]", `[mcp_servers."configs"]`, "[mcp_servers . configs]"]) {
      writeFileSync(configPath, `${header}\ncommand = "/configs-mcp"\n\n[mcp_servers.echo]\ncommand = "echo"\n`, "utf-8");
      const report = runCli(["mcp", "install", "--codex"], home, dbPath);
      expect(report.stdout).toContain("Already installed in Codex");
      const stripped = runCli(["mcp", "uninstall", "--codex"], home, dbPath);
      expect(stripped.stdout).toContain("Removed from Codex");
      expect(readFileSync(configPath, "utf-8")).toContain("[mcp_servers.echo]");
    }

    // A quoted SINGLE key is one key literally named "mcp_servers.configs" —
    // not our nested table. It must never be read as an install, and must
    // survive uninstall byte-identical.
    const singleKey = `["mcp_servers.configs"]\ncommand = "/other"\n`;
    writeFileSync(configPath, singleKey, "utf-8");
    const notOurs = runCli(["mcp", "uninstall", "--codex"], home, dbPath);
    expect(notOurs.status).toBe(0);
    expect(notOurs.stdout).toContain("Not installed in Codex");
    expect(readFileSync(configPath, "utf-8")).toBe(singleKey);
  });

  /**
   * A TOML multi-line string (`"""` / `'''`) may contain a line that LOOKS like
   * a table header. Reading the table's end as "the next line starting with
   * `[`" ends the range inside that string, so the splice cuts the file
   * mid-string: the remaining server is glued onto an unterminated literal and
   * Codex can no longer parse its config — while the CLI still reports success.
   * The header itself must be read the same way, or a header-looking line
   * inside a string is mistaken for a real install.
   */
  test("codex uninstall never splices inside a TOML multi-line string", () => {
    const home = makeTempRoot("mcp-codex-multiline-");
    const dbPath = join(home, "instructions.db");
    mkdirSync(join(home, ".codex"), { recursive: true });
    const configPath = join(home, ".codex", "config.toml");

    // The configs table's own description spans lines and contains a header.
    for (const quote of ['"""', "'''"]) {
      writeFileSync(
        configPath,
        `[mcp_servers.configs]\ncommand = "/configs-mcp"\nargs = []\ndescription = ${quote}\n[mcp_servers.other]\n${quote}\n\n[mcp_servers.other]\ncommand = "echo"\n`,
        "utf-8",
      );
      const removed = runCli(["mcp", "uninstall", "--codex"], home, dbPath);
      expect(removed.status).toBe(0);
      expect(removed.stdout).toContain("Removed from Codex");
      // Exactly the other server: the whole configs table went, and the
      // description it carried went with it instead of being cut open.
      expect(readFileSync(configPath, "utf-8")).toBe(`[mcp_servers.other]\ncommand = "echo"\n`);
    }

    // The marker occurs only INSIDE a multi-line string: that is string
    // content, not an install — never splice it, and never report it removed.
    const inString = `[model]\nprovider = "anthropic"\nnote = """\n[mcp_servers.configs]\n"""\n\n[mcp_servers.echo]\ncommand = "echo"\n`;
    writeFileSync(configPath, inString, "utf-8");
    const untouched = runCli(["mcp", "uninstall", "--codex"], home, dbPath);
    expect(untouched.status).toBe(0);
    expect(untouched.stdout).toContain("Not installed in Codex");
    expect(readFileSync(configPath, "utf-8")).toBe(inString);

    // ...so install must ADD a real table rather than claim it is present.
    const installed = runCli(["mcp", "install", "--codex"], home, dbPath);
    expect(installed.status).toBe(0);
    expect(installed.stdout).toContain("Installed into Codex");

    // Uninstalling now strips that real table and restores the file byte-for-byte.
    const cleaned = runCli(["mcp", "uninstall", "--codex"], home, dbPath);
    expect(cleaned.status).toBe(0);
    expect(cleaned.stdout).toContain("Removed from Codex");
    expect(readFileSync(configPath, "utf-8")).toBe(inString);
  });

  /**
   * A TOML value may span lines as an ARRAY. A nested element line such as
   * `[1, 2],` — and the closing element `[3, 4]` of an array written without a
   * trailing comma — starts with `[` after trimming, so a table-end scan that
   * reads "the next line whose first non-space character is `[`" ends the range
   * mid-array and splices the file at a VALUE. The array tail is left at top
   * level and Codex can no longer parse its config (`Expected ']' at the end of
   * a table declaration`) while the CLI prints "Removed from Codex" and exits 0.
   * The scan must track array depth exactly as it already tracks strings.
   */
  test("codex uninstall never splices inside a TOML multi-line array", () => {
    const home = makeTempRoot("mcp-codex-array-");
    const dbPath = join(home, "instructions.db");
    mkdirSync(join(home, ".codex"), { recursive: true });
    const configPath = join(home, ".codex", "config.toml");

    for (const matrix of ["[\n  [1, 2],\n  [3, 4],\n]", "[\n  [1, 2],\n  [3, 4]\n]"]) {
      writeFileSync(
        configPath,
        `[mcp_servers.configs]\ncommand = "/configs-mcp"\nmatrix = ${matrix}\n\n[mcp_servers.echo]\ncommand = "echo"\n`,
        "utf-8",
      );
      const removed = runCli(["mcp", "uninstall", "--codex"], home, dbPath);
      expect(removed.status).toBe(0);
      expect(removed.stdout).toContain("Removed from Codex");
      // Exactly the other server: the whole configs table (array included) went,
      // and no array fragment was left behind at top level.
      expect(readFileSync(configPath, "utf-8")).toBe(`[mcp_servers.echo]\ncommand = "echo"\n`);
    }

    // A `]` inside a string or a comment is not array structure.
    writeFileSync(
      configPath,
      `[mcp_servers.configs]\ncommand = "/configs-mcp"\nargs = ["]", "[", "x"] # ]\n\n[mcp_servers.echo]\ncommand = "echo"\n`,
      "utf-8",
    );
    const bracketed = runCli(["mcp", "uninstall", "--codex"], home, dbPath);
    expect(bracketed.status).toBe(0);
    expect(readFileSync(configPath, "utf-8")).toBe(`[mcp_servers.echo]\ncommand = "echo"\n`);

    // An array element that only LOOKS like the next header must not hide a real
    // one: the table runs to the next genuine header, whichever comes first.
    writeFileSync(
      configPath,
      `[mcp_servers.configs]\ncommand = "/configs-mcp"\nnotes = [\n  "[mcp_servers.other]",\n]\n\n[mcp_servers.echo]\ncommand = "echo"\n`,
      "utf-8",
    );
    const quoted = runCli(["mcp", "uninstall", "--codex"], home, dbPath);
    expect(quoted.status).toBe(0);
    expect(readFileSync(configPath, "utf-8")).toBe(`[mcp_servers.echo]\ncommand = "echo"\n`);
  });

  /**
   * A target that fails must make the command exit non-zero. `--all` is the
   * documented removal path, so a failed removal — an unwritable or unreadable
   * ~/.codex, a missing `claude` binary, an unparseable ~/.gemini config — that
   * still exits 0 reads as success to any script or CI step that checks the exit
   * code. Every target is still attempted, so all failures are reported first.
   */
  test("codex uninstall exits non-zero when a target fails", () => {
    const home = makeTempRoot("mcp-uninstall-fail-");
    const dbPath = join(home, "instructions.db");
    mkdirSync(join(home, ".codex"), { recursive: true });
    // A config.toml that exists but cannot be read as a file: the codex target
    // throws instead of removing anything.
    mkdirSync(join(home, ".codex", "config.toml"), { recursive: true });

    const failed = runCli(["mcp", "uninstall", "--codex"], home, dbPath);
    expect(failed.status).not.toBe(0);
    expect(failed.stderr).toContain("Failed to remove from codex");

    // The failure does not stop the loop: antigravity is still visited, and the
    // exit code still reports the failure.
    const both = runCli(["mcp", "uninstall", "--codex", "--antigravity"], home, dbPath);
    expect(both.status).not.toBe(0);
    expect(both.stdout).toContain("Not installed in Antigravity");
  });

  test("antigravity install registers and uninstall removes only the configs entry", () => {
    const home = makeTempRoot("mcp-antigravity-");
    const dbPath = join(home, "instructions.db");

    const installed = runCli(["mcp", "install", "--antigravity"], home, dbPath);
    expect(installed.status).toBe(0);
    expect(installed.stdout).toContain("Installed into Antigravity");

    const configPath = join(home, ".gemini", "config", "mcp_config.json");
    expect(existsSync(configPath)).toBe(true);
    const initial = JSON.parse(readFileSync(configPath, "utf-8"));
    expect(initial.mcpServers.configs).toBeDefined();

    // A second server must survive uninstall.
    writeFileSync(
      configPath,
      JSON.stringify({ mcpServers: { configs: initial.mcpServers.configs, echo: { command: "echo" } } }, null, 2) + "\n",
      "utf-8",
    );
    const removed = runCli(["mcp", "uninstall", "--antigravity"], home, dbPath);
    expect(removed.status).toBe(0);
    expect(removed.stdout).toContain("Removed from Antigravity");
    const remaining = JSON.parse(readFileSync(configPath, "utf-8"));
    expect(remaining.mcpServers.configs).toBeUndefined();
    expect(remaining.mcpServers.echo).toBeDefined();
  });
});