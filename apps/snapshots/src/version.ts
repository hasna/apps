import { readFileSync } from "node:fs";

/**
 * Package version for --version control surfaces.
 *
 * Read from package.json at call time (relative to this module, which
 * resolves identically from src/ and dist/) so changesets version bumps can
 * never drift from what --version reports.
 */
export function getPackageVersion(): string {
  try {
    const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as { version?: string };
    return pkg.version ?? "0.0.0";
  } catch {
    return "0.0.0";
  }
}
