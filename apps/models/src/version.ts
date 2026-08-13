import { existsSync, readFileSync } from "node:fs";
import { dirname, join, parse } from "node:path";
import { fileURLToPath } from "node:url";

let cachedVersion: string | null = null;

export function getPackageVersion(): string {
  if (cachedVersion) return cachedVersion;

  let currentDir = dirname(fileURLToPath(import.meta.url));
  const root = parse(currentDir).root;
  while (true) {
    const packageJsonPath = join(currentDir, "package.json");
    if (existsSync(packageJsonPath)) {
      const packageJson = JSON.parse(readFileSync(packageJsonPath, "utf8")) as { version?: unknown };
      if (typeof packageJson.version === "string" && packageJson.version.trim()) {
        cachedVersion = packageJson.version;
        return cachedVersion;
      }
      throw new Error(`Package metadata at ${packageJsonPath} does not declare a version`);
    }

    if (currentDir === root) break;
    currentDir = dirname(currentDir);
  }

  throw new Error("Unable to locate package.json for @hasna/models");
}
