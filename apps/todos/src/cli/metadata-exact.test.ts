import { describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  TODOS_CLI_COMMAND_HELP,
  TODOS_CLI_MANUAL,
} from "./metadata-static.js";

const root = join(import.meta.dir, "../..");

async function runCli(
  entrypoint: string,
  args: readonly string[],
  mode: "local" | "remote",
  cwd = root,
) {
  const absoluteEntrypoint = entrypoint.startsWith("/") ? entrypoint : join(root, entrypoint);
  const process = Bun.spawn(["bun", "run", absoluteEntrypoint, ...args], {
    cwd,
    env: {
      ...globalThis.process.env,
      HASNA_TODOS_STORAGE_MODE: mode,
      TODOS_STORAGE_MODE: mode,
      TODOS_DB_PATH: ":memory:",
    },
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(process.stdout).text(),
    new Response(process.stderr).text(),
    process.exited,
  ]);
  return { stdout, stderr, exitCode };
}

describe("exact dependency-light CLI metadata", () => {
  test("the generated help catalog covers every command and alias", () => {
    for (const entry of TODOS_CLI_MANUAL.commands) {
      expect(TODOS_CLI_COMMAND_HELP[entry.command]).toBeString();
      for (const alias of entry.aliases) {
        const aliasPath = [...entry.path.slice(0, -1), alias].join(" ");
        expect(TODOS_CLI_COMMAND_HELP[aliasPath]).toBeString();
      }
    }
  });

  test("generated metadata contains no producer-worktree absolute path", () => {
    const generated = JSON.stringify({
      manual: TODOS_CLI_MANUAL,
      commandHelp: TODOS_CLI_COMMAND_HELP,
    });
    expect(generated).not.toMatch(/\/home\/[^/\s]+\/\.hasna\/repos\/worktrees\//);
    expect(generated).not.toMatch(/\/Users\/[^/\s]+\//);
  });

  test("every command and alias renders exact help from a relocated working directory", async () => {
    const relocated = mkdtempSync(join(tmpdir(), "todos-relocated-help-"));
    try {
      const invocations = new Map<string, string[]>();
      for (const entry of TODOS_CLI_MANUAL.commands) {
        invocations.set(entry.command, entry.path);
        for (const alias of entry.aliases) {
          const aliasPath = [...entry.path.slice(0, -1), alias];
          invocations.set(aliasPath.join(" "), aliasPath);
        }
      }
      const pending = [...invocations.entries()];
      for (let index = 0; index < pending.length; index += 12) {
        const chunk = pending.slice(index, index + 12);
        const results = await Promise.all(chunk.map(async ([key, path]) => ({
          key,
          result: await runCli("src/cli/index.tsx", [...path, "--help"], "remote", relocated),
        })));
        for (const { key, result } of results) {
          expect(result.exitCode, key).toBe(0);
          expect(result.stderr, key).toBe("");
          expect(result.stdout, key).toBe(TODOS_CLI_COMMAND_HELP[key]);
        }
      }
    } finally {
      rmSync(relocated, { recursive: true, force: true });
    }
  }, 120_000);

  test("built CLI chunks contain no producer path and every packed help route is relocatable", async () => {
    const outputRoot = mkdtempSync(join(tmpdir(), "todos-relocated-built-help-"));
    const relocated = mkdtempSync(join(tmpdir(), "todos-relocated-built-cwd-"));
    try {
      const build = Bun.spawnSync([
        process.execPath,
        "build",
        join(root, "src/cli/index.tsx"),
        "--outdir",
        outputRoot,
        "--target",
        "bun",
        "--splitting",
        "--external",
        "ink",
        "--external",
        "react",
        "--external",
        "chalk",
        "--external",
        "@modelcontextprotocol/sdk",
      ], { cwd: root, stdout: "pipe", stderr: "pipe" });
      expect(build.exitCode).toBe(0);
      for (const relativePath of readdirSync(outputRoot, { recursive: true, encoding: "utf8" })) {
        if (!relativePath.endsWith(".js")) continue;
        const source = readFileSync(join(outputRoot, relativePath), "utf8");
        expect(source, relativePath).not.toMatch(/\/home\/[^/\s"']+\/\.hasna\/repos\/worktrees\//);
        expect(source, relativePath).not.toMatch(/\/Users\/[^/\s"']+\//);
      }

      const entrypoint = join(outputRoot, "index.js");
      const invocations = new Map<string, string[]>();
      for (const entry of TODOS_CLI_MANUAL.commands) {
        invocations.set(entry.command, entry.path);
        for (const alias of entry.aliases) {
          const aliasPath = [...entry.path.slice(0, -1), alias];
          invocations.set(aliasPath.join(" "), aliasPath);
        }
      }
      const pending = [...invocations.entries()];
      for (let index = 0; index < pending.length; index += 12) {
        const chunk = pending.slice(index, index + 12);
        const results = await Promise.all(chunk.map(async ([key, path]) => ({
          key,
          result: await runCli(entrypoint, [...path, "--help"], "remote", relocated),
        })));
        for (const { key, result } of results) {
          expect(result.exitCode, key).toBe(0);
          expect(result.stderr, key).toBe("");
          expect(result.stdout, key).toBe(TODOS_CLI_COMMAND_HELP[key]);
        }
      }
    } finally {
      rmSync(outputRoot, { recursive: true, force: true });
      rmSync(relocated, { recursive: true, force: true });
    }
  }, 120_000);

  test("hosted bootstrap metadata is byte-identical to the authorized base renderer", async () => {
    const cases = [
      ["--help"],
      ["add", "--help"],
      ["machines", "sync", "--help"],
      ["storage", "shadow-drain", "--help"],
      ["storage", "artifacts", "upload", "--help"],
      ["manual", "--json"],
      ["completions", "bash"],
      ["completions", "zsh"],
      ["completions", "fish"],
    ] as const;
    const comparisons = await Promise.all(cases.map(async (args) => {
      const [light, base] = await Promise.all([
        runCli("src/cli/index.tsx", args, "remote"),
        runCli("src/cli/runtime.tsx", args, "local"),
      ]);
      return { args, light, base };
    }));
    for (const { args, light, base } of comparisons) {
      expect(light, args.join(" ")).toEqual(base);
    }
  }, 15_000);
});
