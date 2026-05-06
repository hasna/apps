import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export function getPackageVersion(fromUrl = import.meta.url): string {
  try {
    let dir = dirname(fileURLToPath(fromUrl));
    for (let i = 0; i < 5; i++) {
      const pkgPath = join(dir, "package.json");
      if (existsSync(pkgPath)) {
        return JSON.parse(readFileSync(pkgPath, "utf-8")).version || "0.0.0";
      }
      const parent = dirname(dir);
      if (parent === dir) break;
      dir = parent;
    }
  } catch {
    return "0.0.0";
  }
  return "0.0.0";
}
