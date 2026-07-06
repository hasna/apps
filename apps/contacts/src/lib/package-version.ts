import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

let cached: string | null = null;

/**
 * Resolve the installed @hasna/contacts version from the nearest package.json.
 * Falls back to "0.0.0" only if the manifest cannot be located (never throws).
 */
export function getPackageVersion(): string {
  if (cached) return cached;
  try {
    let dir = dirname(fileURLToPath(import.meta.url));
    for (let i = 0; i < 8; i++) {
      const pkgPath = join(dir, "package.json");
      if (existsSync(pkgPath)) {
        const pkg = JSON.parse(readFileSync(pkgPath, "utf8")) as { name?: string; version?: string };
        if (pkg.name === "@hasna/contacts" && pkg.version) {
          cached = pkg.version;
          return cached;
        }
      }
      const parent = dirname(dir);
      if (parent === dir) break;
      dir = parent;
    }
  } catch {
    // ignore and fall through
  }
  cached = process.env.npm_package_version || "0.0.0";
  return cached;
}
