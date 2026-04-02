import { readFileSync } from "node:fs";
import { join } from "node:path";

export const FALLBACK_CLI_VERSION = "0.0.0";

export function parseVersionFromPackageJson(raw: string, fallback = FALLBACK_CLI_VERSION): string {
  try {
    const parsed = JSON.parse(raw) as { version?: unknown };
    if (typeof parsed.version === "string" && parsed.version.length > 0) {
      return parsed.version;
    }
  } catch {
    // ignore parse errors and use fallback
  }

  return fallback;
}

export function getCliVersion(packageJsonPath = join(import.meta.dir, "../../package.json")): string {
  try {
    const raw = readFileSync(packageJsonPath, "utf-8");
    return parseVersionFromPackageJson(raw);
  } catch {
    return FALLBACK_CLI_VERSION;
  }
}
