// Package version lookup for @hasna/search, tolerant of source and dist
// layouts (same approach as @hasna/tenants/src/version.ts).

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export const FALLBACK_PACKAGE_VERSION = "0.0.0";

export function getPackageVersion(): string {
  const currentDir = dirname(fileURLToPath(import.meta.url));
  for (const relativePath of ["../package.json", "../../package.json", "../../../package.json"]) {
    try {
      const pkg = JSON.parse(readFileSync(join(currentDir, relativePath), "utf8")) as { version?: unknown };
      if (typeof pkg.version === "string" && pkg.version.length > 0) return pkg.version;
    } catch {
      // Try the next candidate layout.
    }
  }
  return FALLBACK_PACKAGE_VERSION;
}
