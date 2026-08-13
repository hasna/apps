#!/usr/bin/env bun
import { execFileSync, spawn } from "node:child_process";
import { accessSync, constants, existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import os from "node:os";
import { join } from "node:path";

export interface AppInfo {
  name: string;
  bins: string[];
}

type Stdio = "inherit" | "pipe" | "ignore";

const KNOWN_APPS = [
  "todos",
  "conversations",
  "mementos",
  "knowledge",
  "projects",
  "repos",
  "secrets",
  "accounts",
  "instructions",
  "emails",
];

const DISCOVERY_TABLE: Record<string, string[]> = {
  shield: ["shield.sh"],
  signatures: ["open-signatures"],
  instructions: ["instructions", "configs"],
  events: ["hasna-events", "events"],
  identities: ["identities"],
};

const SKIP_DIR = /\.(bak|old)([.-]|$)|\.pre-/;

function isExecutable(p: string): boolean {
  if (!existsSync(p)) return false;
  try {
    const st = statSync(p);
    if (!st.isFile()) return false;
    accessSync(p, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

export function findInPath(bin: string): string | null {
  const path = process.env.PATH ?? "";
  for (const dir of path.split(":")) {
    if (!dir) continue;
    const candidate = join(dir, bin);
    if (isExecutable(candidate)) return candidate;
  }
  return null;
}

export function resolveApp(name: string): string | null {
  const candidates = [name, ...(DISCOVERY_TABLE[name] ?? [])].filter(
    (b, i, a) => a.indexOf(b) === i,
  );
  for (const bin of candidates) {
    const found = findInPath(bin);
    if (found) return found;
  }
  return null;
}

export function globalDirs(): string[] {
  const override = process.env.HASNA_CLI_GLOBAL_DIRS;
  if (override) return override.split(":").filter(Boolean);
  const dirs: string[] = [];
  const home = process.env.HOME ?? "";
  const bunDir = join(home, ".bun", "install", "global", "node_modules", "@hasna");
  if (existsSync(bunDir)) {
    dirs.push(bunDir);
  } else {
    try {
      const root = execFileSync("npm", ["root", "-g"], { encoding: "utf8" }).trim();
      if (root) {
        const npmDir = join(root, "@hasna");
        if (existsSync(npmDir)) dirs.push(npmDir);
      }
    } catch {
      /* npm unavailable; PATH-first resolution still covers dispatch */
    }
  }
  return dirs;
}

export function discoverApps(dir: string): AppInfo[] {
  if (!existsSync(dir)) return [];
  const apps: AppInfo[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    if (SKIP_DIR.test(entry.name)) continue;
    let pkg: Record<string, unknown> | undefined;
    try {
      pkg = JSON.parse(
        readFileSync(join(dir, entry.name, "package.json"), "utf8"),
      ) as Record<string, unknown>;
    } catch {
      continue;
    }
    if (!pkg) continue;
    const fullName = typeof pkg.name === "string" ? pkg.name : entry.name;
    const rawBins = pkg.bin;
    let bins: string[] = [];
    if (typeof rawBins === "string") {
      bins = [fullName];
    } else if (typeof rawBins === "object" && rawBins !== null) {
      bins = Object.keys(rawBins);
    }
    if (bins.length === 0) {
      continue;
    }
    const name = fullName.startsWith("@hasna/") ? fullName.slice("@hasna/".length) : fullName;
    apps.push({ name, bins });
  }
  return apps.sort((a, b) => a.name.localeCompare(b.name));
}

export function readAppVersion(name: string, dirs: string[]): string | null {
  for (const dir of dirs) {
    try {
      const pkg = JSON.parse(
        readFileSync(join(dir, name, "package.json"), "utf8"),
      ) as { version?: string };
      if (typeof pkg.version === "string") return pkg.version;
    } catch {
      /* not installed here */
    }
  }
  return null;
}

export function cliVersion(): string {
  try {
    const url = new URL("../../package.json", import.meta.url);
    const pkg = JSON.parse(readFileSync(url, "utf8")) as { version?: string };
    return typeof pkg.version === "string" ? pkg.version : "0.0.0";
  } catch {
    return "0.0.0";
  }
}

export function helpText(): string {
  return `hasna — unified dispatcher for @hasna apps

Usage:
  hasna app <name> [args...]   run an installed @hasna app (args pass through unchanged)
  hasna app                    list installed @hasna apps
  hasna apps list              list installed @hasna apps
  hasna apps status <name>     show the installed version of an app
  hasna apps install <name>    install an app (bun install -g @hasna/<name>)
  hasna apps update <name>     update an app (bun add -g @hasna/<name>@latest)
  hasna doctor                 check the global install dir and PATH for known apps
  hasna version                print the hasna CLI version
  hasna --help                 this help

Notes:
  - Apps resolve by binary name in PATH, then through a small discovery table
    for packages whose bin name differs from the package name.
  - The dispatcher never parses args, rewrites flags, or touches env or
    credentials; every app resolves its own configuration.

Exit codes:
  0    success
  1    usage or check failure
  127  app not found
`;
}

export function missingMessage(name: string): string {
  return [
    `hasna: app "@hasna/${name}" is not installed (no bin found in PATH)`,
    `Install it with:`,
    `  bun install -g @hasna/${name}`,
    `Known apps: ${KNOWN_APPS.join(", ")} (run "hasna app" for the full list)`,
    "",
  ].join("\n");
}

export function appsListText(): string {
  const dirs = globalDirs();
  const seen = new Set<string>();
  const apps: AppInfo[] = [];
  for (const dir of dirs) {
    for (const app of discoverApps(dir)) {
      if (seen.has(app.name)) continue;
      seen.add(app.name);
      apps.push(app);
    }
  }
  const lines = apps
    .map((a) => `  ${a.name.padEnd(28)} ${a.bins[0]}`)
    .join("\n");
  return [
    `Installed @hasna apps (${apps.length})${apps.length ? ":" : ""}`,
    lines,
    "",
    `Run "hasna app <name> [args...]" to dispatch to an app.`,
  ].join("\n");
}

export function runProcess(bin: string, args: string[], stdio: Stdio): Promise<number> {
  return new Promise((resolve) => {
    const child = spawn(bin, args, { stdio, env: process.env });
    child.on("error", (err) => {
      process.stderr.write(`hasna: failed to spawn "${bin}": ${err.message}\n`);
      resolve(127);
    });
    child.on("exit", (code, signal) => {
      if (signal) {
        try {
          process.kill(process.pid, signal);
        } catch {
          /* fall through to a conventional exit code */
        }
        const sigNum = (os.constants.signals as Record<string, number>)[signal] ?? 1;
        resolve(128 + sigNum);
      } else {
        resolve(code ?? 1);
      }
    });
  });
}

async function runApp(name: string, args: string[], stdio: Stdio): Promise<number> {
  if (name === "--help" || name === "-h") {
    process.stdout.write(helpText());
    return 0;
  }
  const bin = resolveApp(name);
  if (bin === null) {
    process.stderr.write(missingMessage(name));
    return 127;
  }
  return await runProcess(bin, args, stdio);
}

export async function runDoctor(): Promise<number> {
  const dirs = globalDirs();
  process.stdout.write(
    `hasna doctor — global @hasna install dirs: ${dirs.length ? dirs.join(", ") : "(none found)"}\n`,
  );
  process.stdout.write(`PATH: ${process.env.PATH ?? ""}\n\n`);
  let missing = 0;
  for (const name of KNOWN_APPS) {
    const version = readAppVersion(name, dirs);
    const bin = resolveApp(name);
    const ok = version !== null || bin !== null;
    if (!ok) missing += 1;
    process.stdout.write(
      `  ${ok ? "ok  " : "MISS"}  ${name.padEnd(15)} pkg:${version ?? "(none)"}  bin:${bin ?? "not in PATH"}\n`,
    );
  }
  process.stdout.write(
    `\n${missing === 0 ? "all known apps available" : `${missing} of ${KNOWN_APPS.length} known apps missing`}\n`,
  );
  return missing === 0 ? 0 : 1;
}

export interface MainOptions {
  stdio?: Stdio;
}

export async function main(argv: string[], opts: MainOptions = {}): Promise<number> {
  const stdio = opts.stdio ?? "inherit";
  const [cmd, ...rest] = argv;

  switch (cmd) {
    case undefined:
    case "help":
    case "--help":
    case "-h": {
      process.stdout.write(helpText());
      return 0;
    }
    case "version":
    case "--version":
    case "-v": {
      process.stdout.write(`hasna ${cliVersion()}\n`);
      return 0;
    }
    case "app": {
      const [name, ...args] = rest;
      if (name === undefined) {
        process.stdout.write(appsListText());
        return 0;
      }
      return await runApp(name, args, stdio);
    }
    case "apps": {
      const [sub, arg] = rest;
      if (sub === undefined || sub === "list") {
        process.stdout.write(appsListText());
        return 0;
      }
      if (sub === "status") {
        if (arg === undefined) {
          process.stderr.write("hasna: usage: hasna apps status <name>\n");
          return 1;
        }
        const version = readAppVersion(arg, globalDirs());
        if (version === null) {
          process.stderr.write(missingMessage(arg));
          return 1;
        }
        process.stdout.write(`@hasna/${arg} ${version}\n`);
        return 0;
      }
      if (sub === "install" || sub === "update") {
        if (arg === undefined) {
          process.stderr.write(`hasna: usage: hasna apps ${sub} <name>\n`);
          return 1;
        }
        const args =
          sub === "install"
            ? ["install", "-g", `@hasna/${arg}`]
            : ["add", "-g", `@hasna/${arg}@latest`];
        return await runProcess("bun", args, stdio);
      }
      process.stderr.write(`hasna: unknown apps subcommand "${sub}"\n`);
      return 1;
    }
    case "doctor":
      return await runDoctor();
    default:
      process.stderr.write(`hasna: unknown command "${cmd}"\n\n${helpText()}`);
      return 1;
  }
}

if (import.meta.main) {
  process.exitCode = await main(process.argv.slice(2));
}
