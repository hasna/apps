#!/usr/bin/env bun
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

export const REQUIRED_BIN_NAMES = [
  "consolidations",
  "consolidations-mcp",
  "consolidations-serve",
] as const;

interface SmokeOptions {
  build: boolean;
  keepTemp: boolean;
  packageSpec?: string;
  tarball?: string;
}

interface CommandResult {
  stdout: string;
  stderr: string;
}

/** Parse top-level command names from CLI --help output. */
export function parseCliCommandNames(helpOutput: string): string[] {
  const commands = new Set<string>();
  for (const line of helpOutput.split(/\r?\n/)) {
    const match = line.match(/^\s{2}([a-z][a-z0-9-]*)(?:\s|$)/);
    if (match?.[1] && match[1] !== "help") commands.add(match[1]);
  }
  return [...commands].sort();
}

function parseArgs(args: string[]): SmokeOptions {
  const options: SmokeOptions = { build: true, keepTemp: false };
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === "--help") {
      console.log("Usage: bun run src/release/package-smoke.ts [--tarball <path> | --package-spec <name@version>] [--no-build] [--keep-temp]");
      process.exit(0);
    } else if (arg === "--no-build") {
      options.build = false;
    } else if (arg === "--keep-temp") {
      options.keepTemp = true;
    } else if (arg === "--tarball") {
      options.tarball = args[++i];
    } else if (arg === "--package-spec") {
      options.packageSpec = args[++i];
      options.build = false;
    } else {
      throw new Error(`Unknown package smoke option: ${arg}`);
    }
  }
  return options;
}

function run(label: string, command: string, args: string[], options: { cwd: string; env?: Record<string, string>; input?: string; timeout?: number }): CommandResult {
  const result = spawnSync(command, args, {
    cwd: options.cwd,
    env: { ...process.env, ...options.env },
    input: options.input,
    encoding: "utf-8",
    timeout: options.timeout ?? 120000,
  });
  const stdout = result.stdout ?? "";
  const stderr = result.stderr ?? "";
  if (result.error || result.status !== 0) {
    throw new Error([`${label} failed`, `command: ${command} ${args.join(" ")}`, `status: ${result.status}`, stdout, stderr].filter(Boolean).join("\n"));
  }
  return { stdout, stderr };
}

function bin(name: string, installDir: string): string {
  return join(installDir, "node_modules", ".bin", name);
}

function packPackage(repoRoot: string, tempRoots: string[]): string {
  const packDir = mkdtempSync(join(tmpdir(), "consolidations-pack-"));
  tempRoots.push(packDir);
  const result = run("pack package", "npm", ["pack", "--pack-destination", packDir, "--silent"], { cwd: repoRoot });
  const filename = result.stdout.trim().split(/\r?\n/).at(-1);
  if (!filename) throw new Error("npm pack did not report a tarball filename");
  return join(packDir, filename);
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
  const tempRoots: string[] = [];
  try {
    if (options.build) run("build package", "bun", ["run", "build"], { cwd: repoRoot });
    const packageSource = options.packageSpec ?? (options.tarball ? resolve(options.tarball) : packPackage(repoRoot, tempRoots));
    const installDir = mkdtempSync(join(tmpdir(), "consolidations-install-"));
    tempRoots.push(installDir);
    run("initialize temp project", "npm", ["init", "-y"], { cwd: installDir });
    run("install package", "npm", ["install", packageSource], { cwd: installDir });
    for (const binName of REQUIRED_BIN_NAMES) {
      if (!existsSync(bin(binName, installDir))) throw new Error(`Missing installed bin: ${binName}`);
    }
    const cliHelp = run("CLI help", bin("consolidations", installDir), ["--help"], { cwd: installDir }).stdout;
    console.log(JSON.stringify({ ok: true, package_source: packageSource, cli_commands: parseCliCommandNames(cliHelp) }, null, 2));
  } finally {
    if (!options.keepTemp) for (const root of tempRoots.reverse()) rmSync(root, { recursive: true, force: true });
  }
}

if (import.meta.main) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
