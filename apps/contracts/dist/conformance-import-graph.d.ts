/**
 * Module specifiers that open a SQLite store. Assembled from fragments so
 * this kit's own built output never carries the specifier a fleet probe
 * (`grep -c 'bun:sqlite' dist/cli/*.js`) looks for.
 */
export declare const SQLITE_MODULE_SPECIFIERS: readonly string[];
/** Directories that never hold shipped source. */
export declare const IMPORT_GRAPH_SKIP_DIRS: ReadonlySet<string>;
/** Blank block and line comments, preserving line structure, so a mention in prose is not an import. */
export declare function maskSourceComments(text: string): string;
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
export declare function resolveRelativeImport(fromFile: string, specifier: string): string | null;
/** Analyse one file's imports and SQLite evidence. Comments are masked first. */
export declare function analyzeSourceFile(path: string): SourceFileInfo | null;
/**
 * Build the relative-import graph of a repo. Shipped source is read from
 * `src/` when it exists, else from the repo root, skipping build output,
 * tests and dependencies.
 */
export declare function buildImportGraph(repoRoot: string): ImportGraph;
/**
 * Resolve a package.json `bin` target to the source entry it is built from.
 * `dist/cli/index.js` -> `src/cli/index.ts`, a `bin/x.js` shim -> the file it
 * imports, a source-path bin -> itself. Null when no candidate exists.
 */
export declare function resolveBinEntry(repoRoot: string, binTarget: string): string | null;
/** Every file reachable from `entry` through relative imports, including `entry`. */
export declare function reachableFrom(graph: ImportGraph, entry: string): Set<string>;
/** The shortest import chain from `from` to `to` (both absolute), or null. */
export declare function importPath(graph: ImportGraph, from: string, to: string): string[] | null;
export interface SqliteReachability {
    /** Absolute paths of SQLite modules reachable from the entry. */
    modules: string[];
    /** For each reachable module, the shortest import chain from the entry (repo-relative). */
    chains: Record<string, string[]>;
}
/** Which SQLite modules a bin entry can reach, with the chains that reach them. */
export declare function sqliteReachability(graph: ImportGraph, entry: string): SqliteReachability;
/**
 * Does `path` import `selectsLocalStore` from `@hasna/contracts` (root,
 * `/client`, or `/client/local-opt-in`)? The static half of the local-store
 * gate: the module that opens the store must ask the one door first.
 */
export declare function importsLocalOptInGate(path: string): boolean;
