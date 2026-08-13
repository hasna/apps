import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

let cached: string | null = null;

/** Resolve the package version from package.json (walks up from this module). */
export function getPackageVersion(): string {
  if (cached) return cached;
  let dir = dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 6; i++) {
    try {
      const pkg = JSON.parse(readFileSync(join(dir, "package.json"), "utf8")) as { name?: string; version?: string };
      if (pkg.name === "@hasna/calendar" && pkg.version) {
        cached = pkg.version;
        return cached;
      }
    } catch { /* keep walking */ }
    dir = dirname(dir);
  }
  cached = process.env.npm_package_version || "0.0.0";
  return cached;
}
