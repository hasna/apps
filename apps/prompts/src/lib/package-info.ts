import { readFileSync } from "node:fs";

export const FALLBACK_PACKAGE_VERSION = "0.0.0";

export function getPackageVersion(packageJsonUrl = new URL("../../package.json", import.meta.url)): string {
  try {
    const parsed = JSON.parse(readFileSync(packageJsonUrl, "utf-8")) as { version?: unknown };
    return typeof parsed.version === "string" && parsed.version.length > 0
      ? parsed.version
      : FALLBACK_PACKAGE_VERSION;
  } catch {
    return FALLBACK_PACKAGE_VERSION;
  }
}
