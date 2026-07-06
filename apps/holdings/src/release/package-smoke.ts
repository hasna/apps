#!/usr/bin/env bun
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn, spawnSync } from "node:child_process";

// Package smoke: pack the tarball, install it into a throwaway project, and prove
// all three bins launch and the SDK import works (§3.2). Referenced by
// `smoke:package` and test/package-smoke-script.test.ts.

export const REQUIRED_BIN_NAMES = ["holdings", "holdings-mcp", "holdings-serve"] as const;

interface SmokeOptions {
  build: boolean;
  keepTemp: boolean;
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

function bin(name: string, installDir: string): string {
  return join(installDir, "node_modules", ".bin", name);
}

function run(
  label: string,
  command: string,
  args: string[],
  options: { cwd: string; env?: Record<string, string>; input?: string; timeout?: number },
): CommandResult {
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
    throw new Error(
      [`${label} failed`, `command: ${command} ${args.join(" ")}`, `status: ${result.status ?? "unknown"}`, result.error ? `error: ${result.error.message}` : "", stdout ? `stdout:\n${stdout}` : "", stderr ? `stderr:\n${stderr}` : ""]
        .filter(Boolean)
        .join("\n"),
    );
  }
  return { stdout, stderr };
}

function packPackage(repoRoot: string, tempRoots: string[]): string {
  const packDir = mkdtempSync(join(tmpdir(), "holdings-pack-"));
  tempRoots.push(packDir);
  const result = run("pack package", "npm", ["pack", "--pack-destination", packDir, "--silent"], { cwd: repoRoot });
  const filename = result.stdout.trim().split(/\r?\n/).at(-1);
  if (!filename) throw new Error("npm pack did not report a tarball filename");
  const tarball = join(packDir, filename);
  if (!existsSync(tarball)) throw new Error(`Expected packed tarball was not created: ${tarball}`);
  return tarball;
}

async function smokeServer(installDir: string, dbPath: string): Promise<unknown> {
  const port = 41000 + Math.floor(Math.random() * 4000);
  const server = spawn(bin("holdings-serve", installDir), [], {
    cwd: installDir,
    env: { ...process.env, HASNA_HOLDINGS_DB_PATH: dbPath, HASNA_HOLDINGS_PORT: String(port) },
    stdio: ["ignore", "pipe", "pipe"],
  });
  const stderrChunks: Buffer[] = [];
  server.stderr?.on("data", (chunk: Buffer) => stderrChunks.push(chunk));
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
    throw new Error(`serve health check timed out: ${Buffer.concat(stderrChunks).toString("utf-8")}`);
  } finally {
    server.kill();
    await new Promise((r) => server.once("close", r));
  }
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
  const tempRoots: string[] = [];
  try {
    if (options.build) run("build package", "bun", ["run", "build"], { cwd: repoRoot });
    const packageSource = options.tarball ? resolve(options.tarball) : packPackage(repoRoot, tempRoots);
    const installDir = mkdtempSync(join(tmpdir(), "holdings-install-"));
    tempRoots.push(installDir);

    run("initialize temp project", "npm", ["init", "-y"], { cwd: installDir });
    run("install package", "npm", ["install", "--ignore-scripts", packageSource], { cwd: installDir });

    for (const binName of REQUIRED_BIN_NAMES) {
      if (!existsSync(bin(binName, installDir))) throw new Error(`Missing installed bin: ${binName}`);
    }

    const cliHelp = run("CLI help", bin("holdings", installDir), ["--help"], { cwd: installDir }).stdout;
    run("SDK import", process.execPath, ["-e", "const m = await import('@hasna/holdings'); if (Object.keys(m).length === 0) throw new Error('empty sdk export');"], { cwd: installDir });

    const dbPath = join(installDir, "smoke.sqlite");
    run("MCP version", bin("holdings-mcp", installDir), ["--version"], { cwd: installDir, env: { HASNA_HOLDINGS_DB_PATH: dbPath }, timeout: 8000 });
    const health = await smokeServer(installDir, dbPath);

    console.log(JSON.stringify({ ok: true, package_source: packageSource, cli_commands_checked: parseCliCommandNames(cliHelp).length, server_health: health }, null, 2));
  } finally {
    if (!options.keepTemp) for (const root of tempRoots.reverse()) rmSync(root, { recursive: true, force: true });
  }
}

function parseArgs(args: string[]): SmokeOptions {
  const options: SmokeOptions = { build: true, keepTemp: false };
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === "--help") {
      console.log("Usage: bun run src/release/package-smoke.ts [--tarball <path>] [--no-build] [--keep-temp]");
      process.exit(0);
    } else if (arg === "--no-build") options.build = false;
    else if (arg === "--keep-temp") options.keepTemp = true;
    else if (arg === "--tarball") {
      const t = args[i + 1];
      if (!t) throw new Error("--tarball requires a path");
      options.tarball = t;
      i += 1;
    } else throw new Error(`Unknown option: ${arg}`);
  }
  return options;
}

if (import.meta.main) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
