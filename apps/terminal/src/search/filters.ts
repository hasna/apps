// Smart filters for search results — auto-hide noise, prioritize source files

export const DEFAULT_EXCLUDE_DIRS = [
  "node_modules", ".git", "dist", "build", ".next", "__pycache__",
  "coverage", ".turbo", ".cache", ".output", "vendor", "target",
];

export const SOURCE_EXTENSIONS = new Set([
  ".ts", ".tsx", ".js", ".jsx", ".py", ".go", ".rs", ".java", ".rb",
  ".sh", ".c", ".cpp", ".h", ".css", ".scss", ".html", ".vue", ".svelte",
  ".md", ".json", ".yaml", ".yml", ".toml", ".sql", ".graphql",
]);

export const CONFIG_EXTENSIONS = new Set([
  ".json", ".yaml", ".yml", ".toml", ".ini", ".env", ".config.js",
  ".config.ts", ".config.mjs",
]);

export function isSourceFile(path: string): boolean {
  const ext = path.match(/\.\w+$/)?.[0] ?? "";
  return SOURCE_EXTENSIONS.has(ext);
}

export function isExcludedDir(path: string): boolean {
  return DEFAULT_EXCLUDE_DIRS.some(d => path.includes(`/${d}/`) || path.includes(`/${d}`));
}

/** Relevance score: higher = more relevant */
export function relevanceScore(path: string): number {
  if (isExcludedDir(path)) return 0;
  const ext = path.match(/\.\w+$/)?.[0] ?? "";
  if (SOURCE_EXTENSIONS.has(ext)) return 10;
  if (CONFIG_EXTENSIONS.has(ext)) return 5;
  if (path.includes("/test") || path.includes(".test.") || path.includes(".spec.")) return 7;
  return 3;
}
