import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export function getPackageVersion(): string {
  try {
    const here = dirname(fileURLToPath(import.meta.url));
    const candidates = [join(here, "..", "package.json"), join(here, "..", "..", "package.json")];
    const pkgPath = candidates.find((candidate) => existsSync(candidate));
    if (!pkgPath) {
      return "0.0.0";
    }
    return (JSON.parse(readFileSync(pkgPath, "utf8")) as { version?: string }).version || "0.0.0";
  } catch {
    return "0.0.0";
  }
}
