#!/usr/bin/env bun
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn, spawnSync } from "node:child_process";

/** End-to-end package smoke: pack, install, and exercise the three published bins. */

export const REQUIRED_BIN_NAMES = ["access", "access-mcp", "access-serve"] as const;

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

export function parseCliCommandNames(helpOutput: string): string[] {
  const commands = new Set<string>();
  for (const line of helpOutput.split(/\r?\n/)) {
    const match = line.match(/^\s{2}([a-z][a-z0-9-]*)(?:\s|$)/);
    if (match?.[1] && match[1] !== "help") commands.add(match[1]);
  }
  return [...commands].sort();
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
  const tempRoots: string[] = [];
  try {
    if (options.build) run("build package", "bun", ["run", "build"], { cwd: repoRoot });
    const packageSource = options.packageSpec ?? (options.tarball ? resolve(options.tarball) : packPackage(repoRoot, tempRoots));
    const installDir = mkdtempSync(join(tmpdir(), "access-install-"));
    tempRoots.push(installDir);
    run("initialize temp project", "bun", ["init", "-y"], { cwd: installDir });
    run("install package", "bun", ["add", packageSource], { cwd: installDir });
    for (const binName of REQUIRED_BIN_NAMES) {
      if (!existsSync(join(installDir, "node_modules", ".bin", binName))) throw new Error(`Missing installed bin: ${binName}`);
    }
    const cliHelp = run("CLI help", bin("access", installDir), ["--help"], { cwd: installDir }).stdout;
    const health = await smokeServer(installDir);
    console.log(JSON.stringify({ ok: true, package_source: packageSource, cli_commands_checked: parseCliCommandNames(cliHelp).length, server_health: health }, null, 2));
  } finally {
    if (!options.keepTemp) for (const t of tempRoots.reverse()) rmSync(t, { recursive: true, force: true });
  }
}

function parseArgs(args: string[]): SmokeOptions {
  const options: SmokeOptions = { build: true, keepTemp: false };
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === "--no-build") options.build = false;
    else if (arg === "--keep-temp") options.keepTemp = true;
    else if (arg === "--tarball") {
      options.tarball = args[i + 1];
      i += 1;
    } else if (arg === "--package-spec") {
      options.packageSpec = args[i + 1];
      options.build = false;
      i += 1;
    }
  }
  return options;
}

function packPackage(repoRoot: string, tempRoots: string[]): string {
  const packDir = mkdtempSync(join(tmpdir(), "access-pack-"));
  tempRoots.push(packDir);
  const result = run("pack package", "bun", ["pm", "pack", "--destination", packDir], { cwd: repoRoot });
  const line = result.stdout.trim().split(/\r?\n/).map((l) => l.trim()).filter((l) => l.endsWith(".tgz")).at(-1);
  const tarball = line ? join(packDir, line.split("/").at(-1)!) : "";
  if (!tarball || !existsSync(tarball)) throw new Error("bun pm pack did not produce a tarball");
  return tarball;
}

function bin(name: string, installDir: string): string {
  return join(installDir, "node_modules", ".bin", name);
}

function run(label: string, command: string, args: string[], options: { cwd: string; env?: Record<string, string>; input?: string; timeout?: number }): CommandResult {
  const result = spawnSync(command, args, { cwd: options.cwd, env: { ...process.env, ...options.env }, input: options.input, encoding: "utf-8", timeout: options.timeout ?? 120000 });
  const stdout = result.stdout ?? "";
  const stderr = result.stderr ?? "";
  if (result.error || result.status !== 0) {
    throw new Error([`${label} failed`, `command: ${command} ${args.join(" ")}`, `status: ${result.status ?? "unknown"}`, stderr].filter(Boolean).join("\n"));
  }
  return { stdout, stderr };
}

async function smokeServer(installDir: string): Promise<unknown> {
  const port = 45000 + Math.floor(Math.random() * 10000);
  const server = spawn(bin("access-serve", installDir), [], { cwd: installDir, env: { ...process.env, ACCESS_PORT: String(port) }, stdio: ["ignore", "pipe", "pipe"] });
  try {
    const deadline = Date.now() + 10000;
    while (Date.now() < deadline) {
      try {
        const response = await fetch(`http://127.0.0.1:${port}/health`);
        if (response.ok) return await response.json();
      } catch {
        await new Promise((r) => setTimeout(r, 100));
      }
    }
    throw new Error("serve health check timed out");
  } finally {
    server.kill();
  }
}

if (import.meta.main) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
