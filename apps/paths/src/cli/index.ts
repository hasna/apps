#!/usr/bin/env bun
/**
 * `paths` — operator CLI for the @hasna/paths resolver.
 *
 * Prints the resolved home directories for an app so an operator or a
 * migration script can see exactly where a machine will read and write
 * without writing code:
 *
 *   paths --app todos                     print all four homes
 *   paths --app todos --kind data         print one home
 *   paths --base --kind config            print the hasna base root (no app)
 *   paths --app mailery --internal        internal app layout
 *   paths --app todos --json              machine-readable
 *
 * Env overrides (HASNA_CONFIG_HOME, HASNA_DATA_HOME, HASNA_STATE_HOME,
 * HASNA_CACHE_HOME) are honored exactly as the SDK honors them.
 */

import {
  baseDir,
  cacheDir,
  configDir,
  dataDir,
  dirs,
  resolvePath,
  stateDir,
  PATH_KINDS,
  type PathKind,
  type PathsOptions,
} from "../index";
import { readPackageVersion } from "../version";

const KIND_SET = new Set<string>(PATH_KINDS);

export interface ParsedArgs {
  kind: PathKind | null;
  app: string | null;
  internal: boolean;
  base: boolean;
  json: boolean;
  help: boolean;
}

const USAGE = `Usage: paths [options]

Options:
  --app <slug>        App slug (kebab-case). Required unless --base is used.
  --kind <kind>       One of config, data, state, cache. Default: all four.
  --internal          Resolve the internal-app layout (hasna/internal/<app>).
  --base              Print the hasna base root instead of an app path.
  --json              Emit JSON.
  -V, --version       Print the package version.
  --help              Show this help.`;

// Binds-before-version class (T-00101 pattern): --version/--help must answer
// BEFORE any argument validation. They previously exited 2 — --version fell
// into the unknown-argument branch and --help was defeated by the
// required-argument check running inside parseArgs.
const EARLY_ARGV = process.argv.slice(2);
if (EARLY_ARGV.includes("--version") || EARLY_ARGV.includes("-V")) {
  console.log(readPackageVersion());
  process.exit(0);
}
if (EARLY_ARGV.includes("--help") || EARLY_ARGV.includes("-h")) {
  console.log(USAGE);
  process.exit(0);
}

export function parseArgs(argv: string[]): ParsedArgs {
  const parsed: ParsedArgs = {
    kind: null,
    app: null,
    internal: false,
    base: false,
    json: false,
    help: false,
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    switch (arg) {
      case "--help":
      case "-h":
        parsed.help = true;
        break;
      case "--internal":
        parsed.internal = true;
        break;
      case "--base":
        parsed.base = true;
        break;
      case "--json":
      case "-j":
        parsed.json = true;
        break;
      case "--app": {
        const value = argv[++i];
        if (value === undefined) throw new Error("--app requires a value");
        parsed.app = value;
        break;
      }
      case "--kind": {
        const value = argv[++i];
        if (value === undefined) throw new Error("--kind requires a value");
        parsed.kind = value as PathKind;
        if (!KIND_SET.has(parsed.kind)) {
          throw new Error(`--kind must be one of ${PATH_KINDS.join(", ")}; got "${parsed.kind}"`);
        }
        break;
      }
      default:
        throw new Error(`unknown argument "${arg}"`);
    }
  }

  if (!parsed.base && !parsed.app) {
    throw new Error("--app <slug> is required (or use --base)");
  }
  return parsed;
}

function run(parsed: ParsedArgs): string {
  if (parsed.base) {
    const kind = parsed.kind ?? "data";
    const root = baseDir(kind, { app: "base", platform: process.platform, env: process.env });
    return parsed.json ? JSON.stringify({ kind, base: root }) : root;
  }

  const app = parsed.app as string;
  const options: PathsOptions = { app, internal: parsed.internal };

  if (parsed.kind) {
    return parsed.json
      ? JSON.stringify({ app, internal: parsed.internal, kind: parsed.kind, path: resolvePath(parsed.kind, options) })
      : resolvePath(parsed.kind, options);
  }

  const all = dirs(options);
  if (parsed.json) return JSON.stringify({ app, internal: parsed.internal, ...all });
  return `${configDir(options)}\n${dataDir(options)}\n${stateDir(options)}\n${cacheDir(options)}`;
}

function main(): void {
  let parsed: ParsedArgs;
  try {
    parsed = parseArgs(process.argv.slice(2));
  } catch (error) {
    console.error(`paths: ${error instanceof Error ? error.message : String(error)}`);
    console.error(USAGE);
    process.exit(2);
  }
  if (parsed.help) {
    console.log(USAGE);
    return;
  }
  try {
    process.stdout.write(run(parsed) + "\n");
  } catch (error) {
    console.error(`paths: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(2);
  }
}

if (import.meta.main) {
  main();
}
