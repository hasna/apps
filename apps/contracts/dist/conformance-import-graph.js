// @bun
var __defProp = Object.defineProperty;
var __returnValue = (v) => v;
function __exportSetter(name, newValue) {
  this[name] = __returnValue.bind(null, newValue);
}
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, {
      get: all[name],
      enumerable: true,
      configurable: true,
      set: __exportSetter.bind(all, name)
    });
};

// src/conformance-import-graph.ts
import { existsSync, readFileSync, readdirSync, statSync } from "fs";
import { basename, dirname, join, relative, resolve } from "path";
var SQLITE_MODULE_SPECIFIERS = Object.freeze([
  ["bun", "sqlite"].join(":"),
  ["better", "sqlite3"].join("-"),
  ["node", "sqlite"].join(":"),
  "sqlite3",
  "sqlite",
  ["@libsql", "client"].join("/"),
  "libsql"
]);
var SQLITE_SPECIFIER_SET = new Set(SQLITE_MODULE_SPECIFIERS);
var NEW_DATABASE = new RegExp(`\\bnew\\s+${["Data", "base"].join("")}\\s*\\(`);
var NEW_DATABASE_EVIDENCE = ["new ", "Data", "base("].join("");
var SOURCE_FILE = /\.(?:[cm]?ts|[cm]?js|tsx|jsx)$/;
var TEST_FILE = /\.(?:test|spec)\.[cm]?[jt]sx?$/;
var DECLARATION_FILE = /\.d\.[cm]?ts$/;
var MAX_FILE_BYTES = 2000000;
var IMPORT_GRAPH_SKIP_DIRS = new Set([
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
  "__tests__"
]);
var IMPORT_SPECIFIER = /(?:import|export)\s+(?:[^'";]*?\s+from\s+)?["']([^"']+)["']|\brequire\(\s*["']([^"']+)["']\s*\)|\bimport\(\s*["']([^"']+)["']\s*\)/g;
function maskSourceComments(text) {
  return text.replace(/\/\*[\s\S]*?\*\//g, (match) => match.replace(/[^\n]/g, " ")).replace(/(^|[^:"'`\\])\/\/[^\n]*/g, (match, lead) => lead + " ".repeat(match.length - lead.length));
}
function resolveRelativeImport(fromFile, specifier) {
  if (!specifier.startsWith("."))
    return null;
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
    join(base, "index.mjs")
  ];
  for (const candidate of candidates) {
    try {
      if (existsSync(candidate) && statSync(candidate).isFile())
        return candidate;
    } catch {}
  }
  return null;
}
function walkSourceFiles(dir, out) {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (!IMPORT_GRAPH_SKIP_DIRS.has(entry.name))
        walkSourceFiles(full, out);
      continue;
    }
    if (!entry.isFile())
      continue;
    if (!SOURCE_FILE.test(entry.name) || TEST_FILE.test(entry.name) || DECLARATION_FILE.test(entry.name))
      continue;
    try {
      if (statSync(full).size > MAX_FILE_BYTES)
        continue;
    } catch {
      continue;
    }
    out.push(full);
  }
}
function analyzeSourceFile(path) {
  let text;
  try {
    text = readFileSync(path, "utf8");
  } catch {
    return null;
  }
  const masked = maskSourceComments(text);
  const imports = [];
  const externalImports = [];
  let sqliteEvidence = null;
  for (const match of masked.matchAll(IMPORT_SPECIFIER)) {
    const specifier = match[1] ?? match[2] ?? match[3];
    if (!specifier)
      continue;
    if (specifier.startsWith(".")) {
      const resolved = resolveRelativeImport(path, specifier);
      if (resolved && !imports.includes(resolved))
        imports.push(resolved);
    } else {
      if (!externalImports.includes(specifier))
        externalImports.push(specifier);
      if (SQLITE_SPECIFIER_SET.has(specifier) && !sqliteEvidence)
        sqliteEvidence = specifier;
    }
  }
  if (!sqliteEvidence && NEW_DATABASE.test(masked))
    sqliteEvidence = NEW_DATABASE_EVIDENCE;
  return { path, imports, externalImports, sqlite: sqliteEvidence !== null, sqliteEvidence };
}
function buildImportGraph(repoRoot) {
  const root = resolve(repoRoot);
  const files = [];
  const sourceRoot = join(root, "src");
  if (existsSync(sourceRoot))
    walkSourceFiles(sourceRoot, files);
  else
    walkSourceFiles(root, files);
  const binRoot = join(root, "bin");
  if (existsSync(binRoot))
    walkSourceFiles(binRoot, files);
  const infos = new Map;
  for (const file of files) {
    const info = analyzeSourceFile(file);
    if (info)
      infos.set(file, info);
  }
  return { root, files: infos };
}
function resolveBinEntry(repoRoot, binTarget) {
  const root = resolve(repoRoot);
  const direct = resolve(root, binTarget);
  const guesses = [];
  const asSource = (path) => path.replace(/\/dist\//, "/src/").replace(/\.[cm]?js$/, ".ts");
  guesses.push(asSource(direct), asSource(direct).replace(/\.ts$/, "/index.ts"));
  if (existsSync(direct) && statSync(direct).isFile()) {
    try {
      const shim = maskSourceComments(readFileSync(direct, "utf8"));
      const match = /(?:from|import\(|require\()\s*["']([^"']+)["']/.exec(shim);
      if (match?.[1]?.startsWith(".")) {
        const resolved = resolveRelativeImport(direct, match[1]);
        if (resolved)
          guesses.unshift(resolved);
        const shimTarget = asSource(resolve(dirname(direct), match[1]));
        guesses.push(shimTarget, shimTarget.replace(/\.ts$/, "/index.ts"));
      }
    } catch {}
    if (SOURCE_FILE.test(direct) && !direct.includes("/dist/"))
      guesses.push(direct);
  }
  const stem = basename(binTarget).replace(/\.[cm]?js$/, "");
  guesses.push(join(root, "src", `${stem}.ts`), join(root, "src", stem, "index.ts"), join(root, "src", "cli", `${stem}.ts`));
  if (/mcp/.test(stem))
    guesses.push(join(root, "src", "mcp", "index.ts"), join(root, "src", "mcp.ts"));
  if (/serve|server/.test(stem))
    guesses.push(join(root, "src", "server", "index.ts"), join(root, "src", "server.ts"));
  if (/^(?:index|cli)$/.test(stem) || stem === basename(root)) {
    guesses.push(join(root, "src", "cli", "index.ts"), join(root, "src", "cli.ts"), join(root, "src", "index.ts"));
  }
  for (const guess of guesses) {
    try {
      if (existsSync(guess) && statSync(guess).isFile())
        return guess;
    } catch {}
  }
  return null;
}
function reachableFrom(graph, entry) {
  const seen = new Set;
  const queue = [resolve(entry)];
  while (queue.length > 0) {
    const current = queue.shift();
    if (seen.has(current))
      continue;
    seen.add(current);
    const info = graph.files.get(current) ?? analyzeSourceFile(current);
    if (!info)
      continue;
    for (const next of info.imports)
      if (!seen.has(next))
        queue.push(next);
  }
  return seen;
}
function importPath(graph, from, to) {
  const start = resolve(from);
  const goal = resolve(to);
  const previous = new Map([[start, null]]);
  const queue = [start];
  while (queue.length > 0) {
    const current = queue.shift();
    if (current === goal) {
      const chain = [];
      for (let node = current;node; node = previous.get(node) ?? null)
        chain.unshift(node);
      return chain;
    }
    const info = graph.files.get(current) ?? analyzeSourceFile(current);
    if (!info)
      continue;
    for (const next of info.imports) {
      if (!previous.has(next)) {
        previous.set(next, current);
        queue.push(next);
      }
    }
  }
  return null;
}
function sqliteReachability(graph, entry) {
  const reachable = reachableFrom(graph, entry);
  const modules = [...reachable].filter((path) => (graph.files.get(path) ?? analyzeSourceFile(path))?.sqlite).sort();
  const chains = {};
  for (const module of modules) {
    const chain = importPath(graph, entry, module) ?? [module];
    chains[relative(graph.root, module)] = chain.map((step) => relative(graph.root, step));
  }
  return { modules, chains };
}
function importsLocalOptInGate(path) {
  let text;
  try {
    text = maskSourceComments(readFileSync(path, "utf8"));
  } catch {
    return false;
  }
  const gate = /import\s*(?:type\s+)?\{[^}]*\bselectsLocalStore\b[^}]*\}\s*from\s*["']@hasna\/contracts(?:\/client(?:\/local-opt-in)?)?(?:\.js)?["']/;
  return gate.test(text);
}
export {
  sqliteReachability,
  resolveRelativeImport,
  resolveBinEntry,
  reachableFrom,
  maskSourceComments,
  importsLocalOptInGate,
  importPath,
  buildImportGraph,
  analyzeSourceFile,
  SQLITE_MODULE_SPECIFIERS,
  IMPORT_GRAPH_SKIP_DIRS
};
