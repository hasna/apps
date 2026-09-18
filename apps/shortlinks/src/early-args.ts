// Early-argument handling shared by the `shortlinks-mcp` and `shortlinks-serve`
// bins (hasna/apps#1720 validation, the binds-before-version class):
// `shortlinks-mcp --version` used to fall through to the stdio JSON-RPC loop
// and announce "stdio ready", and `shortlinks-serve --help` to the PostgreSQL
// pool factory, dying on the missing database URL. Both must answer BEFORE any
// backend resolution, transport start, or port bind.

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export type EarlyArg = "help" | "version" | "start";

/** Classify `--help`/`-h` and `--version`/`-V` ahead of every other flag. */
export function handleEarlyArgs(argv: string[]): EarlyArg {
  if (argv.includes("--help") || argv.includes("-h")) return "help";
  if (argv.includes("--version") || argv.includes("-V")) return "version";
  return "start";
}

/**
 * The package version for a bin entry two directories below the package root
 * — `src/<bin>/index.ts` and its bundled `dist/<bin>/index.js` alike. Pass the
 * entry's own `import.meta.url` so the lookup survives bundling.
 */
export function readPackageVersion(entryUrl: string): string {
  try {
    const pkgPath = join(dirname(fileURLToPath(entryUrl)), "..", "..", "package.json");
    return (JSON.parse(readFileSync(pkgPath, "utf-8")) as { version?: string }).version || "0.0.0";
  } catch {
    return "0.0.0";
  }
}
