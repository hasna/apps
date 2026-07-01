import { readFileSync } from "node:fs";
import { dirname, join, parse } from "node:path";
import { fileURLToPath } from "node:url";

function readPackageVersion(): string {
  let currentDir = dirname(fileURLToPath(import.meta.url));
  const root = parse(currentDir).root;
  while (true) {
    try {
      const packagePath = join(currentDir, "package.json");
      return JSON.parse(readFileSync(packagePath, "utf8")).version ?? "0.0.0";
    } catch {
      if (currentDir === root) return "0.0.0";
      currentDir = dirname(currentDir);
    }
  }
}

export const VERSION = readPackageVersion();
