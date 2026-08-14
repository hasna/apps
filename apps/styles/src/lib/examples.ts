import { existsSync, readFileSync, readdirSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

export const PATTERNS = ["card", "button", "input", "nav", "hero"] as const;
export type Pattern = (typeof PATTERNS)[number];

function findStylesDir(): string {
  // Walk up from __dirname to find the styles/ directory
  let dir = dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 10; i++) {
    const candidate = join(dir, "styles");
    if (existsSync(candidate)) {
      return candidate;
    }
    const parent = join(dir, "..");
    if (parent === dir) break;
    dir = parent;
  }
  // Fallback: relative to this file's parent (src/lib → project root)
  return join(dirname(fileURLToPath(import.meta.url)), "..", "..", "styles");
}

export function getExample(styleName: string, pattern: Pattern): string | null {
  const stylesDir = findStylesDir();
  const examplePath = join(stylesDir, `style-${styleName}`, "examples", `${pattern}.tsx`);
  if (!existsSync(examplePath)) return null;
  try {
    return readFileSync(examplePath, "utf-8");
  } catch {
    return null;
  }
}

export function listExamples(styleName: string): Pattern[] {
  const stylesDir = findStylesDir();
  const examplesDir = join(stylesDir, `style-${styleName}`, "examples");
  if (!existsSync(examplesDir)) return [];
  try {
    const entries = readdirSync(examplesDir);
    return PATTERNS.filter((p) => entries.includes(`${p}.tsx`));
  } catch {
    return [];
  }
}
