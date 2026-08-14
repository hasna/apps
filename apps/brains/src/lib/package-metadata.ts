import { existsSync, readFileSync } from "fs";
import { dirname, resolve } from "path";
import { fileURLToPath } from "url";

const DEFAULT_VERSION = "0.0.0";

let cachedVersion: string | undefined;

function getPackageJsonPath(): string {
  return resolve(dirname(fileURLToPath(import.meta.url)), "../../package.json");
}

export function getPackageVersion(): string {
  if (cachedVersion) {
    return cachedVersion;
  }

  const packageJsonPath = getPackageJsonPath();
  if (!existsSync(packageJsonPath)) {
    cachedVersion = DEFAULT_VERSION;
    return cachedVersion;
  }

  try {
    const packageJson = JSON.parse(readFileSync(packageJsonPath, "utf-8")) as { version?: unknown };
    cachedVersion = typeof packageJson.version === "string" ? packageJson.version : DEFAULT_VERSION;
  } catch {
    cachedVersion = DEFAULT_VERSION;
  }

  return cachedVersion;
}
