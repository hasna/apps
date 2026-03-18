import { join, dirname } from "path";
import { existsSync } from "fs";

/**
 * Walk up from cwd looking for project root indicators.
 * Order: .styles/ dir > .claude/ dir > package.json
 * Max 5 levels up.
 */
export function detectProjectPath(cwd?: string): string {
  const start = cwd ?? process.cwd();
  let dir = start;
  for (let i = 0; i < 5; i++) {
    if (existsSync(join(dir, ".styles")) || existsSync(join(dir, ".claude"))) {
      return dir;
    }
    const parent = dirname(dir);
    if (parent === dir) break; // filesystem root
    dir = parent;
  }
  // fallback: walk up for package.json
  dir = start;
  for (let i = 0; i < 5; i++) {
    if (existsSync(join(dir, "package.json"))) return dir;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return start;
}
