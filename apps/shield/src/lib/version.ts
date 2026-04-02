import { dirname, join } from "path";
import { existsSync, readFileSync } from "fs";
import { fileURLToPath } from "url";

export function getPackageVersion(): string {
  try {
    let dir = dirname(fileURLToPath(import.meta.url));
    for (let i = 0; i < 4; i++) {
      const candidate = join(dir, "package.json");
      if (existsSync(candidate)) {
        const parsed = JSON.parse(readFileSync(candidate, "utf-8")) as { version?: string };
        if (parsed.version) return parsed.version;
      }
      dir = dirname(dir);
    }
  } catch {}
  return "0.0.0";
}

export const PACKAGE_VERSION = getPackageVersion();
