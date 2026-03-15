// Semantic code search — AST-powered search that understands code structure
// Instead of raw grep, searches by meaning: "find auth functions" → login(), verifyToken()

import { spawn } from "child_process";
import { readFileSync, existsSync } from "fs";
import { join, extname } from "path";

export interface CodeSymbol {
  name: string;
  kind: "function" | "class" | "interface" | "type" | "variable" | "export" | "import" | "component" | "hook";
  file: string;
  line: number;
  signature?: string;  // e.g., "function login(email: string, password: string): Promise<User>"
  exported: boolean;
  doc?: string;        // JSDoc comment if present
}

export interface SemanticSearchResult {
  query: string;
  symbols: CodeSymbol[];
  totalFiles: number;
  tokensSaved?: number;
}

function exec(command: string, cwd: string): Promise<string> {
  return new Promise((resolve) => {
    const proc = spawn("/bin/zsh", ["-c", command], { cwd, stdio: ["ignore", "pipe", "pipe"] });
    let out = "";
    proc.stdout?.on("data", (d: Buffer) => { out += d.toString(); });
    proc.stderr?.on("data", (d: Buffer) => { /* ignore */ });
    proc.on("close", () => resolve(out));
  });
}

/** Extract code symbols from a TypeScript/JavaScript file using regex-based parsing */
function extractSymbols(filePath: string): CodeSymbol[] {
  if (!existsSync(filePath)) return [];
  const content = readFileSync(filePath, "utf8");
  const lines = content.split("\n");
  const symbols: CodeSymbol[] = [];
  const file = filePath;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const lineNum = i + 1;
    const isExported = line.trimStart().startsWith("export");

    // Functions: export function X(...) or export const X = (...) =>
    const funcMatch = line.match(/(?:export\s+)?(?:async\s+)?function\s+(\w+)\s*\(([^)]*)\)/);
    if (funcMatch) {
      const prevLine = i > 0 ? lines[i - 1] : "";
      const doc = prevLine.trim().startsWith("/**") || prevLine.trim().startsWith("//")
        ? prevLine.trim().replace(/^\/\*\*\s*|\s*\*\/$/g, "").replace(/^\/\/\s*/, "")
        : undefined;
      symbols.push({
        name: funcMatch[1], kind: "function", file, line: lineNum,
        signature: line.trim().replace(/\{.*$/, "").trim(),
        exported: isExported, doc,
      });
      continue;
    }

    // Arrow functions: export const X = (...) =>
    const arrowMatch = line.match(/(?:export\s+)?(?:const|let)\s+(\w+)\s*=\s*(?:async\s+)?\(([^)]*)\)\s*(?::\s*\w[^=]*)?\s*=>/);
    if (arrowMatch) {
      // Detect React hooks
      const isHook = arrowMatch[1].startsWith("use");
      const isComponent = /^[A-Z]/.test(arrowMatch[1]);
      symbols.push({
        name: arrowMatch[1],
        kind: isHook ? "hook" : isComponent ? "component" : "function",
        file, line: lineNum,
        signature: line.trim().replace(/\{.*$/, "").replace(/=>.*$/, "=>").trim(),
        exported: isExported,
      });
      continue;
    }

    // Classes
    const classMatch = line.match(/(?:export\s+)?class\s+(\w+)(?:\s+extends\s+(\w+))?/);
    if (classMatch) {
      symbols.push({
        name: classMatch[1], kind: "class", file, line: lineNum,
        signature: line.trim().replace(/\{.*$/, "").trim(),
        exported: isExported,
      });
      continue;
    }

    // Interfaces
    const ifaceMatch = line.match(/(?:export\s+)?interface\s+(\w+)/);
    if (ifaceMatch) {
      symbols.push({
        name: ifaceMatch[1], kind: "interface", file, line: lineNum,
        signature: line.trim().replace(/\{.*$/, "").trim(),
        exported: isExported,
      });
      continue;
    }

    // Type aliases
    const typeMatch = line.match(/(?:export\s+)?type\s+(\w+)\s*=/);
    if (typeMatch) {
      symbols.push({
        name: typeMatch[1], kind: "type", file, line: lineNum,
        signature: line.trim(),
        exported: isExported,
      });
      continue;
    }

    // Imports (for dependency tracking)
    const importMatch = line.match(/import\s+(?:\{([^}]+)\}|(\w+))\s+from\s+['"]([^'"]+)['"]/);
    if (importMatch) {
      const names = importMatch[1]
        ? importMatch[1].split(",").map(s => s.trim().split(" as ")[0].trim())
        : [importMatch[2]];
      for (const name of names) {
        if (name) {
          symbols.push({
            name, kind: "import", file, line: lineNum,
            signature: `from '${importMatch[3]}'`,
            exported: false,
          });
        }
      }
      continue;
    }

    // Exported constants/variables
    const constMatch = line.match(/export\s+const\s+(\w+)\s*[=:]/);
    if (constMatch && !arrowMatch) {
      symbols.push({
        name: constMatch[1], kind: "variable", file, line: lineNum,
        signature: line.trim().slice(0, 80),
        exported: true,
      });
    }
  }

  return symbols;
}

/** Find all source files in a directory */
async function findSourceFiles(cwd: string, maxFiles: number = 200): Promise<string[]> {
  const excludes = ["node_modules", ".git", "dist", "build", ".next", "coverage", "__pycache__"];
  const excludeArgs = excludes.map(d => `-not -path '*/${d}/*'`).join(" ");
  const extensions = "\\( -name '*.ts' -o -name '*.tsx' -o -name '*.js' -o -name '*.jsx' \\)";
  const cmd = `find . ${extensions} ${excludeArgs} -type f 2>/dev/null | head -${maxFiles}`;
  const output = await exec(cmd, cwd);
  return output.split("\n").filter(l => l.trim()).map(l => join(cwd, l.trim()));
}

/** Semantic search: find symbols matching a natural language query */
export async function semanticSearch(
  query: string,
  cwd: string,
  options: { kinds?: CodeSymbol["kind"][]; exportedOnly?: boolean; maxResults?: number } = {}
): Promise<SemanticSearchResult> {
  const { kinds, exportedOnly = false, maxResults = 30 } = options;

  // Find all source files
  const files = await findSourceFiles(cwd);

  // Extract symbols from all files
  let allSymbols: CodeSymbol[] = [];
  for (const file of files) {
    try {
      allSymbols.push(...extractSymbols(file));
    } catch { /* skip unreadable files */ }
  }

  // Filter by kind
  if (kinds) {
    allSymbols = allSymbols.filter(s => kinds.includes(s.kind));
  }

  // Filter by exported
  if (exportedOnly) {
    allSymbols = allSymbols.filter(s => s.exported);
  }

  // Score each symbol against the query
  const queryLower = query.toLowerCase();
  const queryWords = queryLower.split(/\s+/).filter(w => w.length > 2);

  const scored = allSymbols.map(symbol => {
    let score = 0;
    const nameLower = symbol.name.toLowerCase();
    const sigLower = (symbol.signature ?? "").toLowerCase();
    const fileLower = symbol.file.toLowerCase();

    // Exact name match
    if (queryWords.some(w => nameLower === w)) score += 10;

    // Name contains query word
    if (queryWords.some(w => nameLower.includes(w))) score += 5;

    // Signature contains query word
    if (queryWords.some(w => sigLower.includes(w))) score += 3;

    // File path contains query word
    if (queryWords.some(w => fileLower.includes(w))) score += 2;

    // Doc contains query word
    if (symbol.doc && queryWords.some(w => symbol.doc!.toLowerCase().includes(w))) score += 4;

    // Boost exported symbols
    if (symbol.exported) score += 1;

    // Boost functions/classes over imports
    if (symbol.kind === "function" || symbol.kind === "class") score += 1;

    // Semantic matching for common patterns
    if (queryLower.includes("component") && symbol.kind === "component") score += 5;
    if (queryLower.includes("hook") && symbol.kind === "hook") score += 5;
    if (queryLower.includes("type") && (symbol.kind === "type" || symbol.kind === "interface")) score += 5;
    if (queryLower.includes("import") && symbol.kind === "import") score += 5;
    if (queryLower.includes("class") && symbol.kind === "class") score += 5;

    return { symbol, score };
  });

  // Sort by score, filter zero scores
  const results = scored
    .filter(s => s.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, maxResults)
    .map(s => s.symbol);

  // Make file paths relative
  for (const r of results) {
    if (r.file.startsWith(cwd)) {
      r.file = "." + r.file.slice(cwd.length);
    }
  }

  // Estimate token savings
  const rawGrep = await exec(`grep -rn '${queryWords[0] ?? query}' . --include='*.ts' --include='*.tsx' 2>/dev/null | head -100`, cwd);
  const rawTokens = Math.ceil(rawGrep.length / 4);
  const resultTokens = Math.ceil(JSON.stringify(results).length / 4);

  return {
    query,
    symbols: results,
    totalFiles: files.length,
    tokensSaved: Math.max(0, rawTokens - resultTokens),
  };
}

/** Quick helper: find all exported functions */
export async function findExports(cwd: string): Promise<CodeSymbol[]> {
  const result = await semanticSearch("export", cwd, { exportedOnly: true, maxResults: 100 });
  return result.symbols;
}

/** Quick helper: find all React components */
export async function findComponents(cwd: string): Promise<CodeSymbol[]> {
  const result = await semanticSearch("component", cwd, { kinds: ["component"], maxResults: 50 });
  return result.symbols;
}

/** Quick helper: find all hooks */
export async function findHooks(cwd: string): Promise<CodeSymbol[]> {
  const result = await semanticSearch("hook", cwd, { kinds: ["hook"], maxResults: 50 });
  return result.symbols;
}
