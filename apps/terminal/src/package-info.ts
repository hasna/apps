import { readFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

let cachedVersion: string | null = null;

export function getPackageVersion(): string {
  if (cachedVersion) return cachedVersion;
  const here = dirname(fileURLToPath(import.meta.url));
  const candidates = [
    join(here, "..", "package.json"),
    join(here, "..", "..", "package.json"),
  ];
  for (const file of candidates) {
    try {
      const pkg = JSON.parse(readFileSync(file, "utf8")) as { version?: string };
      if (pkg.version) {
        cachedVersion = pkg.version;
        return cachedVersion;
      }
    } catch {
      /* keep looking */
    }
  }
  return "0.0.0";
}
