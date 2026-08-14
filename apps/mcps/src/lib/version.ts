import { existsSync, readFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

const FALLBACK_VERSION = "0.0.1";

export function readPackageVersion(moduleUrl: string, fallback = FALLBACK_VERSION): string {
  const baseDir = dirname(fileURLToPath(moduleUrl));
  const candidates = [
    join(baseDir, "..", "..", "package.json"),
    join(baseDir, "..", "package.json"),
    join(baseDir, "package.json"),
  ];

  for (const candidate of candidates) {
    if (!existsSync(candidate)) continue;
    try {
      const pkg = JSON.parse(readFileSync(candidate, "utf-8")) as { version?: string };
      if (pkg.version) return pkg.version;
    } catch {
      // Ignore malformed files and continue to the next candidate.
    }
  }

  return fallback;
}
