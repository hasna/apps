#!/usr/bin/env bun
/** Generate the dependency-light CLI metadata snapshot from the local runtime. */

import { join } from "node:path";

const root = join(import.meta.dir, "..");

async function capture(args: readonly string[]): Promise<string> {
  const process = Bun.spawn(["bun", "run", "src/cli/runtime.tsx", ...args], {
    cwd: root,
    env: {
      ...globalThis.process.env,
      HASNA_TODOS_STORAGE_MODE: "local",
      TODOS_STORAGE_MODE: "local",
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
  if (exitCode !== 0 || stderr) {
    throw new Error(`CLI metadata capture failed (${exitCode}) for ${args.join(" ")}: ${stderr}`);
  }
  return stdout;
}

const manual = JSON.parse(await capture(["manual", "--json"]));
const rootHelp = await capture(["--help"]);
const completions = Object.fromEntries(await Promise.all(
  (["bash", "zsh", "fish"] as const).map(async (shell) => [
    shell,
    await capture(["completions", shell]),
  ]),
));
const helpInvocations = new Map<string, string[]>();
for (const entry of manual.commands as Array<{ path: string[]; aliases: string[] }>) {
  helpInvocations.set(entry.path.join(" "), entry.path);
  for (const alias of entry.aliases) {
    helpInvocations.set([...entry.path.slice(0, -1), alias].join(" "), [
      ...entry.path.slice(0, -1),
      alias,
    ]);
  }
}
const commandHelp: Record<string, string> = {};
const pendingHelp = [...helpInvocations.entries()];
for (let index = 0; index < pendingHelp.length; index += 8) {
  const chunk = pendingHelp.slice(index, index + 8);
  const captured = await Promise.all(chunk.map(async ([key, path]) => [
    key,
    await capture([...path, "--help"]),
  ] as const));
  for (const [key, help] of captured) commandHelp[key] = help;
}

const output = [
  "/** Generated dependency-light CLI metadata. Do not edit by hand. */",
  'import type { CliManual } from "../lib/cli-help.js";',
  "",
  `export const TODOS_CLI_MANUAL: CliManual = ${JSON.stringify(manual, null, 2)};`,
  `export const TODOS_CLI_ROOT_HELP = ${JSON.stringify(rootHelp)};`,
  `export const TODOS_CLI_COMPLETIONS: Readonly<Record<\"bash\" | \"zsh\" | \"fish\", string>> = ${JSON.stringify(completions, null, 2)};`,
  `export const TODOS_CLI_COMMAND_HELP: Readonly<Record<string, string>> = ${JSON.stringify(commandHelp, null, 2)};`,
  "",
].join("\n");

await Bun.write(join(root, "src", "cli", "metadata-static.ts"), output);
