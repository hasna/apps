// Which parts of a project workspace belong in a durable archive.
//
// A census of the project store on station01 measured 84.39 GiB across 628,376
// files, of which roughly 96% of bytes and 94% of files are regenerable build
// output, dependency trees, provider caches and database dumps. Total textual
// state was 2.82 GiB, median workspace 32 KB. Deciding what to carry is
// therefore the difference between archiving a workspace and archiving a
// machine's scratch space.
//
// This module is a PURE CLASSIFIER. It does not walk the filesystem, read
// files, or talk to a network, so it can be exercised exhaustively in tests and
// adopted independently of any transfer mechanism. Callers supply names and, for
// marker detection, a probe over a directory's own children.
//
// ---------------------------------------------------------------------------
// DEFAULT IS INCLUDE, and that is a deliberate asymmetry rather than laziness.
//
// A wrong EXCLUDE silently drops a file from the archive; nobody notices until
// a restore needs it and it is not there. A wrong INCLUDE costs bytes, which is
// visible and cheap. So a path is carried unless it matches an explicit,
// evidence-backed rule, and every exclusion returns a reason a caller can
// report rather than a bare boolean.
// ---------------------------------------------------------------------------
//
// NOT A NAME DENYLIST. Name matching alone was measured to fail on this corpus:
// a 155 MB virtualenv lives at `.venv-media`, which no `{.venv,venv}` list
// matches. Directory rules therefore consult a MARKER FILE first — the same
// venv carries `pyvenv.cfg` at its root — so an arbitrarily named dependency
// tree is still recognised. Name rules apply only to directories whose name is
// itself the convention (`node_modules`, `.terraform`).
//
// MEDIA IS NOT EXCLUDED. The surviving corpus is 20% PDF and 11% JPEG by bytes,
// and the largest of those are the company's incorporation records and signed
// tax declarations. A blanket "skip binaries" rule would discard exactly the
// documents least reproducible from anywhere else.

/** Why a path is not carried. Stable codes — callers may group on these. */
export type SyncExclusionReason =
  | "dependency-tree"
  | "provider-cache"
  | "build-output"
  | "tool-cache"
  | "vcs-internal"
  | "nested-worktrees"
  | "regenerable-database"
  | "oversize";

export interface SyncScopeDecision {
  /** Carry this path into the archive. */
  readonly include: boolean;
  /** Set only when `include` is false. */
  readonly reason?: SyncExclusionReason;
  /** The rule that decided, for auditing a plan without re-running it. */
  readonly rule?: string;
}

const INCLUDED: SyncScopeDecision = { include: true };

function excluded(reason: SyncExclusionReason, rule: string): SyncScopeDecision {
  return { include: false, reason, rule };
}

/**
 * Files whose presence at a directory's root identifies that directory as a
 * generated dependency tree, whatever it is called. Marker detection is what
 * catches a virtualenv named `.venv-media`.
 */
export const DEPENDENCY_TREE_MARKERS: readonly string[] = [
  "pyvenv.cfg",
];

/** Directories whose NAME is the convention rather than an arbitrary choice. */
export const DEPENDENCY_TREE_DIRS: readonly string[] = [
  "node_modules",
  "bower_components",
  "site-packages",
];

export const PROVIDER_CACHE_DIRS: readonly string[] = [
  ".terraform",
];

export const BUILD_OUTPUT_DIRS: readonly string[] = [
  "dist",
  "build",
  ".next",
  ".nuxt",
  ".svelte-kit",
  ".output",
];

export const TOOL_CACHE_DIRS: readonly string[] = [
  "__pycache__",
  ".pytest_cache",
  ".mypy_cache",
  ".ruff_cache",
  ".turbo",
  ".parcel-cache",
  ".cache",
  "coverage",
];

/**
 * Database files. The census found 17.89 GiB in 51 files, 20.6% of the whole
 * store in two 8.7 GB session backups. A live sqlite file is also the one thing
 * that cannot be copied safely while it is open, so it is excluded on
 * correctness grounds and not only on size.
 */
export const DATABASE_EXTENSIONS: readonly string[] = [
  ".sqlite",
  ".sqlite3",
  ".db",
  ".db-wal",
  ".db-shm",
  ".sqlite-wal",
  ".sqlite-shm",
];

/** Sidecars that only exist beside an open database. */
const DATABASE_SIDECAR_SUFFIXES: readonly string[] = ["-wal", "-shm", "-journal"];

export interface DirectoryProbe {
  /** True when the directory being classified contains this child entry. */
  hasChild(name: string): boolean;
}

export interface ClassifyDirectoryOptions {
  /**
   * Lets a marker rule see the directory's own children. Omit it and marker
   * detection is skipped — name rules still apply, so an unprobed walk is
   * weaker but never wrong in the include direction.
   */
  readonly probe?: DirectoryProbe;
  /**
   * Depth of this directory below the workspace root, 0 for a direct child.
   * `worktrees` is only meaningful at the root.
   */
  readonly depth?: number;
}

/**
 * Decide whether to descend into a directory.
 *
 * Marker rules run before name rules: a directory is judged by what it contains
 * before it is judged by what it is called.
 */
export function classifyDirectory(
  name: string,
  options: ClassifyDirectoryOptions = {},
): SyncScopeDecision {
  const { probe, depth } = options;

  if (probe) {
    for (const marker of DEPENDENCY_TREE_MARKERS) {
      if (probe.hasChild(marker)) {
        return excluded("dependency-tree", `marker:${marker}`);
      }
    }
  }

  if (name === ".git") return excluded("vcs-internal", "name:.git");

  // Git worktrees checked out inside the store: 444,512 files, 70.7% of every
  // file in the census. They are reconstructible from their remote and belong
  // to the repo, not to the workspace.
  if (name === "worktrees" && (depth === undefined || depth === 0)) {
    return excluded("nested-worktrees", "name:worktrees@root");
  }

  if (DEPENDENCY_TREE_DIRS.includes(name)) return excluded("dependency-tree", `name:${name}`);
  if (PROVIDER_CACHE_DIRS.includes(name)) return excluded("provider-cache", `name:${name}`);
  if (BUILD_OUTPUT_DIRS.includes(name)) return excluded("build-output", `name:${name}`);
  if (TOOL_CACHE_DIRS.includes(name)) return excluded("tool-cache", `name:${name}`);

  return INCLUDED;
}

export interface ClassifyFileOptions {
  /** Size in bytes, when the caller has already stat'd the entry. */
  readonly size?: number;
  /**
   * Opt-in ceiling. UNSET BY DEFAULT so that no file is ever dropped on size
   * alone unless a caller asks for it; a caller that sets this is accepting
   * that some real content may need handling out of band.
   */
  readonly maxFileBytes?: number;
}

/**
 * Decide whether to carry a file.
 *
 * Everything not matched here is carried, including every document, image and
 * unknown extension.
 */
export function classifyFile(
  name: string,
  options: ClassifyFileOptions = {},
): SyncScopeDecision {
  const lower = name.toLowerCase();

  for (const extension of DATABASE_EXTENSIONS) {
    if (lower.endsWith(extension)) {
      return excluded("regenerable-database", `extension:${extension}`);
    }
  }
  // `foo.sqlite-wal` is covered above; `foo.db.wal` and `foo.sqlite3-journal`
  // style sidecars are caught by stripping the suffix and re-testing.
  for (const suffix of DATABASE_SIDECAR_SUFFIXES) {
    if (!lower.endsWith(suffix)) continue;
    const base = lower.slice(0, -suffix.length);
    if (DATABASE_EXTENSIONS.some((extension) => base.endsWith(extension))) {
      return excluded("regenerable-database", `sidecar:${suffix}`);
    }
  }

  const { size, maxFileBytes } = options;
  if (
    typeof maxFileBytes === "number" &&
    typeof size === "number" &&
    size > maxFileBytes
  ) {
    return excluded("oversize", `size>${maxFileBytes}`);
  }

  return INCLUDED;
}
