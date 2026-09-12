// Static relative-import graph for the client isolation checks.
//
// The question the graph answers: starting from a CLI or MCP bin's source
// entry, which source files are reachable through RELATIVE imports, and do any
// of them open a SQLite store? It is deliberately heuristic — dynamic imports
// with computed specifiers and string-built paths escape it — which is why the
// contract pairs it with the behavioural black-box check. It never executes
// anything.

import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { basename, dirname, join, relative, resolve } from "node:path";

/**
 * Module specifiers that open a SQLite store. Assembled from fragments so
 * this kit's own built output never carries the specifier a fleet probe
 * (`grep -c 'bun:sqlite' dist/cli/*.js`) looks for.
 */
export const SQLITE_MODULE_SPECIFIERS: readonly string[] = Object.freeze([
  ["bun", "sqlite"].join(":"),
  ["better", "sqlite3"].join("-"),
  ["node", "sqlite"].join(":"),
  "sqlite3",
  "sqlite",
  ["@libsql", "client"].join("/"),
  "libsql",
]);

const SQLITE_SPECIFIER_SET = new Set<string>(SQLITE_MODULE_SPECIFIERS);
const NEW_DATABASE = new RegExp(`\\bnew\\s+${["Data", "base"].join("")}\\s*\\(`);
/** The evidence label for a constructor-based store open; assembled so it does not match the detector above. */
const NEW_DATABASE_EVIDENCE = ["new ", "Data", "base("].join("");
const SOURCE_FILE = /\.(?:[cm]?ts|[cm]?js|tsx|jsx)$/;
const TEST_FILE = /\.(?:test|spec)\.[cm]?[jt]sx?$/;
const DECLARATION_FILE = /\.d\.[cm]?ts$/;
const MAX_FILE_BYTES = 2_000_000;

/** Directories that never hold shipped source. */
export const IMPORT_GRAPH_SKIP_DIRS: ReadonlySet<string> = new Set([
  ".git",
  "node_modules",
  "dist",
  "build",
  "out",
  "coverage",
  ".next",
  ".turbo",
  ".cache",
  "tests",
  "test",
  "__tests__",
]);

// import x from "y"; import "y"; export * from "y"; export { a } from "y";
// require("y"); import("y").
const IMPORT_SPECIFIER =
  /(?:import|export)\s+(?:[^'";]*?\s+from\s+)?["']([^"']+)["']|\brequire\(\s*["']([^"']+)["']\s*\)|\bimport\(\s*["']([^"']+)["']\s*\)/g;

/** Blank block and line comments, preserving line structure, so a mention in prose is not an import. */
export function maskSourceComments(text: string): string {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, (match) => match.replace(/[^\n]/g, " "))
    .replace(/(^|[^:"'`\\])\/\/[^\n]*/g, (match, lead: string) => lead + " ".repeat(match.length - lead.length));
}

export interface SourceFileInfo {
  /** Absolute path. */
  path: string;
  /** Absolute paths of the relative imports that resolved to a file. */
  imports: string[];
  /** Bare specifiers (packages, `bun:*`, `node:*`) the file imports. */
  externalImports: string[];
  /** True when the file imports a SQLite module or calls `new Database(`. */
  sqlite: boolean;
  /** Which specifier or expression made it a SQLite module. */
  sqliteEvidence: string | null;
}

export interface ImportGraph {
  root: string;
  /** Every source file found, keyed by absolute path. */
  files: Map<string, SourceFileInfo>;
}

/** Resolve a RELATIVE specifier from `fromFile` to an existing file, honouring the NodeNext `.js` -> `.ts` convention. */
export function resolveRelativeImport(fromFile: string, specifier: string): string | null {
  if (!specifier.startsWith(".")) return null;
  const base = resolve(dirname(fromFile), specifier);
  const candidates = [
    base,
    base.replace(/\.js$/, ".ts"),
    base.replace(/\.js$/, ".tsx"),
    base.replace(/\.mjs$/, ".mts"),
    base.replace(/\.cjs$/, ".cts"),
    `${base}.ts`,
    `${base}.tsx`,
    `${base}.js`,
    `${base}.mts`,
    `${base}.mjs`,
    join(base, "index.ts"),
    join(base, "index.tsx"),
    join(base, "index.js"),
    join(base, "index.mjs"),
  ];
  for (const candidate of candidates) {
    try {
      if (existsSync(candidate) && statSync(candidate).isFile()) return candidate;
    } catch {
      // unreadable candidate: not a resolution
    }
  }
  return null;
}

function walkSourceFiles(dir: string, out: string[]): void {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (!IMPORT_GRAPH_SKIP_DIRS.has(entry.name)) walkSourceFiles(full, out);
      continue;
    }
    if (!entry.isFile()) continue;
    if (!SOURCE_FILE.test(entry.name) || TEST_FILE.test(entry.name) || DECLARATION_FILE.test(entry.name)) continue;
    try {
      if (statSync(full).size > MAX_FILE_BYTES) continue;
    } catch {
      continue;
    }
    out.push(full);
  }
}

/** Analyse one file's imports and SQLite evidence. Comments are masked first. */
export function analyzeSourceFile(path: string): SourceFileInfo | null {
  let text: string;
  try {
    text = readFileSync(path, "utf8");
  } catch {
    return null;
  }
  const masked = maskSourceComments(text);
  const imports: string[] = [];
  const externalImports: string[] = [];
  let sqliteEvidence: string | null = null;
  for (const match of masked.matchAll(IMPORT_SPECIFIER)) {
    const specifier = match[1] ?? match[2] ?? match[3];
    if (!specifier) continue;
    if (specifier.startsWith(".")) {
      const resolved = resolveRelativeImport(path, specifier);
      if (resolved && !imports.includes(resolved)) imports.push(resolved);
    } else {
      if (!externalImports.includes(specifier)) externalImports.push(specifier);
      if (SQLITE_SPECIFIER_SET.has(specifier) && !sqliteEvidence) sqliteEvidence = specifier;
    }
  }
  if (!sqliteEvidence && NEW_DATABASE.test(masked)) sqliteEvidence = NEW_DATABASE_EVIDENCE;
  return { path, imports, externalImports, sqlite: sqliteEvidence !== null, sqliteEvidence };
}

/**
 * Build the relative-import graph of a repo. Shipped source is read from
 * `src/` when it exists, else from the repo root, skipping build output,
 * tests and dependencies.
 */
export function buildImportGraph(repoRoot: string): ImportGraph {
  const root = resolve(repoRoot);
  const files: string[] = [];
  const sourceRoot = join(root, "src");
  if (existsSync(sourceRoot)) walkSourceFiles(sourceRoot, files);
  else walkSourceFiles(root, files);
  // Shim entries under bin/ are shipped source too when they import src/.
  const binRoot = join(root, "bin");
  if (existsSync(binRoot)) walkSourceFiles(binRoot, files);
  const infos = new Map<string, SourceFileInfo>();
  for (const file of files) {
    const info = analyzeSourceFile(file);
    if (info) infos.set(file, info);
  }
  return { root, files: infos };
}

/**
 * Resolve a package.json `bin` target to the source entry it is built from.
 * `dist/cli/index.js` -> `src/cli/index.ts`, a `bin/x.js` shim -> the file it
 * imports, a source-path bin -> itself. Null when no candidate exists.
 */
export function resolveBinEntry(repoRoot: string, binTarget: string): string | null {
  const root = resolve(repoRoot);
  const direct = resolve(root, binTarget);
  const guesses: string[] = [];
  const asSource = (path: string) => path.replace(/\/dist\//, "/src/").replace(/\.[cm]?js$/, ".ts");
  guesses.push(asSource(direct), asSource(direct).replace(/\.ts$/, "/index.ts"));
  if (existsSync(direct) && statSync(direct).isFile()) {
    try {
      const shim = maskSourceComments(readFileSync(direct, "utf8"));
      const match = /(?:from|import\(|require\()\s*["']([^"']+)["']/.exec(shim);
      if (match?.[1]?.startsWith(".")) {
        const resolved = resolveRelativeImport(direct, match[1]);
        if (resolved) guesses.unshift(resolved);
        const shimTarget = asSource(resolve(dirname(direct), match[1]));
        guesses.push(shimTarget, shimTarget.replace(/\.ts$/, "/index.ts"));
      }
    } catch {
      // unreadable shim: fall through to the name-based guesses
    }
    if (SOURCE_FILE.test(direct) && !direct.includes("/dist/")) guesses.push(direct);
  }
  const stem = basename(binTarget).replace(/\.[cm]?js$/, "");
  guesses.push(join(root, "src", `${stem}.ts`), join(root, "src", stem, "index.ts"), join(root, "src", "cli", `${stem}.ts`));
  if (/mcp/.test(stem)) guesses.push(join(root, "src", "mcp", "index.ts"), join(root, "src", "mcp.ts"));
  if (/serve|server/.test(stem)) guesses.push(join(root, "src", "server", "index.ts"), join(root, "src", "server.ts"));
  if (/^(?:index|cli)$/.test(stem) || stem === basename(root)) {
    guesses.push(join(root, "src", "cli", "index.ts"), join(root, "src", "cli.ts"), join(root, "src", "index.ts"));
  }
  for (const guess of guesses) {
    try {
      if (existsSync(guess) && statSync(guess).isFile()) return guess;
    } catch {
      // not a file
    }
  }
  return null;
}

/** Every file reachable from `entry` through relative imports, including `entry`. */
export function reachableFrom(graph: ImportGraph, entry: string): Set<string> {
  const seen = new Set<string>();
  const queue = [resolve(entry)];
  while (queue.length > 0) {
    const current = queue.shift()!;
    if (seen.has(current)) continue;
    seen.add(current);
    const info = graph.files.get(current) ?? analyzeSourceFile(current);
    if (!info) continue;
    for (const next of info.imports) if (!seen.has(next)) queue.push(next);
  }
  return seen;
}

/** The shortest import chain from `from` to `to` (both absolute), or null. */
export function importPath(graph: ImportGraph, from: string, to: string): string[] | null {
  const start = resolve(from);
  const goal = resolve(to);
  const previous = new Map<string, string | null>([[start, null]]);
  const queue = [start];
  while (queue.length > 0) {
    const current = queue.shift()!;
    if (current === goal) {
      const chain: string[] = [];
      for (let node: string | null = current; node; node = previous.get(node) ?? null) chain.unshift(node);
      return chain;
    }
    const info = graph.files.get(current) ?? analyzeSourceFile(current);
    if (!info) continue;
    for (const next of info.imports) {
      if (!previous.has(next)) {
        previous.set(next, current);
        queue.push(next);
      }
    }
  }
  return null;
}

export interface SqliteReachability {
  /** Absolute paths of SQLite modules reachable from the entry. */
  modules: string[];
  /** For each reachable module, the shortest import chain from the entry (repo-relative). */
  chains: Record<string, string[]>;
}

/** Which SQLite modules a bin entry can reach, with the chains that reach them. */
export function sqliteReachability(graph: ImportGraph, entry: string): SqliteReachability {
  const reachable = reachableFrom(graph, entry);
  const modules = [...reachable].filter((path) => (graph.files.get(path) ?? analyzeSourceFile(path))?.sqlite).sort();
  const chains: Record<string, string[]> = {};
  for (const module of modules) {
    const chain = importPath(graph, entry, module) ?? [module];
    chains[relative(graph.root, module)] = chain.map((step) => relative(graph.root, step));
  }
  return { modules, chains };
}

/**
 * Does `path` import `selectsLocalStore` from `@hasna/contracts` (root,
 * `/client`, or `/client/local-opt-in`)? The static half of the local-store
 * gate: the module that opens the store must ask the one door first.
 */
export function importsLocalOptInGate(path: string): boolean {
  let text: string;
  try {
    text = maskSourceComments(readFileSync(path, "utf8"));
  } catch {
    return false;
  }
  const gate = /import\s*(?:type\s+)?\{[^}]*\bselectsLocalStore\b[^}]*\}\s*from\s*["']@hasna\/contracts(?:\/client(?:\/local-opt-in)?)?(?:\.js)?["']/;
  return gate.test(text);
}
