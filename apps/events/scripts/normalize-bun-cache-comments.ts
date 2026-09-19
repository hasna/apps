import { readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

const BUN_CACHE_SOURCE_COMMENT = /^\/\/ .*?node_modules\/\.bun\/([^/\r\n]+?)(?:\+[0-9a-f]{16})?\/node_modules\/(.*)$/gm;
const WORKSPACE_CONTRACTS_COMMENT = /^\/\/ .*?\/apps\/contracts\/(.*)$/gm;

/** Canonicalize generated source comments across workspace/full/filtered Bun install layouts. */
export function normalizeBunCacheComments(source: string, contractsVersion = "1.1.0"): string {
  const installed = source.replace(BUN_CACHE_SOURCE_COMMENT, "// node_modules/.bun/$1/node_modules/$2");
  return installed.replace(
    WORKSPACE_CONTRACTS_COMMENT,
    `// node_modules/.bun/@hasna+contracts@${contractsVersion}/node_modules/@hasna/contracts/$1`,
  );
}

export function normalizeGeneratedJavaScript(root: string, contractsVersion: string): string[] {
  const changed: string[] = [];
  const walk = (directory: string) => {
    for (const entry of readdirSync(directory)) {
      const file = join(directory, entry);
      if (statSync(file).isDirectory()) walk(file);
      else if (file.endsWith(".js")) {
        const before = readFileSync(file, "utf8");
        const after = normalizeBunCacheComments(before, contractsVersion);
        if (after !== before) {
          writeFileSync(file, after);
          changed.push(file);
        }
      }
    }
  };
  walk(root);
  return changed;
}

if (import.meta.main) {
  const pkg = JSON.parse(readFileSync(resolve(import.meta.dir, "../package.json"), "utf8")) as { dependencies?: Record<string, string> };
  const contractsVersion = pkg.dependencies?.["@hasna/contracts"];
  if (!contractsVersion || !/^\d+\.\d+\.\d+$/.test(contractsVersion)) {
    throw new Error("Events requires one exact @hasna/contracts version for generated-comment normalization");
  }
  normalizeGeneratedJavaScript(resolve(import.meta.dir, "../dist"), contractsVersion);
}
