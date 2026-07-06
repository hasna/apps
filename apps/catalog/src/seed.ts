import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { AppIdSchema, AppSchema, type App, type AppSurfaces } from "./contracts.js";
import type { CatalogStoreLike, ProjectJoinRecord, SeedCandidate, SeedReport, SeedSkip } from "./types.js";

/**
 * Duplicate checkouts of repos that live canonically under another folder.
 * Kept explicit because the duplicate does not always share the folder-name
 * pattern of a worktree.
 */
export const DUPLICATE_CHECKOUTS: Record<string, string> = {
  "open-mailery": "open-emails",
  "open-shield": "open-security",
  "open-codewith-qa": "open-codewith",
};

const WORKTREE_PATTERNS: Array<{ pattern: RegExp; reason: string }> = [
  { pattern: /-wt-/, reason: "worktree checkout (-wt-)" },
  { pattern: /-pr\d+(?:-|$)/, reason: "pull-request checkout (-prN)" },
  { pattern: /-release-/, reason: "release checkout (-release-)" },
  { pattern: /-fix(?:$|-)/, reason: "fix checkout (-fix)" },
  { pattern: /-legacy(?:$|-)/, reason: "legacy checkout (-legacy)" },
  { pattern: /-[0-9a-f]{8,}$/, reason: "hash-suffixed checkout" },
];

/** Returns a skip reason when the folder is not a canonical repo checkout, else null. */
export function excludedFolderReason(folder: string): string | null {
  if (!folder.startsWith("open-")) return "not an open- prefixed repo";
  for (const { pattern, reason } of WORKTREE_PATTERNS) {
    if (pattern.test(folder)) return reason;
  }
  const canonical = DUPLICATE_CHECKOUTS[folder];
  if (canonical) return `duplicate checkout of ${canonical}`;
  return null;
}

function firstReadmeLine(path: string): string | null {
  for (const name of ["README.md", "readme.md", "README"]) {
    const readmePath = join(path, name);
    if (!existsSync(readmePath)) continue;
    let content: string;
    try {
      content = readFileSync(readmePath, "utf8");
    } catch {
      return null;
    }
    for (const rawLine of content.split("\n")) {
      let line = rawLine.trim();
      if (!line) continue;
      // Skip badge/image-only and HTML lines.
      if (line.startsWith("![") || line.startsWith("[!") || line.startsWith("<")) continue;
      line = line.replace(/^#+\s*/, "").trim();
      if (line) return line;
    }
    return null;
  }
  return null;
}

/** Read one repo folder into a seed candidate (or null when it has no package.json). */
export function readSeedCandidate(root: string, folder: string): SeedCandidate | null {
  const path = join(root, folder);
  const pkgPath = join(path, "package.json");
  if (!existsSync(pkgPath)) return null;
  let pkg: Record<string, unknown>;
  try {
    pkg = JSON.parse(readFileSync(pkgPath, "utf8")) as Record<string, unknown>;
  } catch {
    return null;
  }
  const npmName = typeof pkg["name"] === "string" && pkg["name"].length > 0 ? (pkg["name"] as string) : null;
  const version = typeof pkg["version"] === "string" ? (pkg["version"] as string) : null;
  const description = typeof pkg["description"] === "string" && pkg["description"].trim().length > 0
    ? (pkg["description"] as string).trim()
    : null;
  const bins: string[] = [];
  const bin = pkg["bin"];
  if (typeof bin === "string" && npmName) {
    bins.push(npmName.includes("/") ? npmName.split("/")[1]! : npmName);
  } else if (bin && typeof bin === "object" && !Array.isArray(bin)) {
    for (const key of Object.keys(bin as Record<string, unknown>)) {
      if (key.trim().length > 0) bins.push(key);
    }
  }
  const repository = pkg["repository"];
  let repositoryUrl: string | null = null;
  if (typeof repository === "string") {
    repositoryUrl = repository;
  } else if (repository && typeof repository === "object" && typeof (repository as Record<string, unknown>)["url"] === "string") {
    repositoryUrl = (repository as Record<string, string>)["url"] ?? null;
  }
  return {
    folder,
    path,
    npmName,
    version,
    description,
    bins: [...new Set(bins)],
    readmeFirstLine: firstReadmeLine(path),
    repositoryUrl,
  };
}

/**
 * Deduplicate candidates that share an npm package name (extra checkouts the
 * name patterns did not catch). Winner: the folder matching `open-<unscoped>`
 * exactly, else the shortest folder name, alphabetical as tiebreak.
 */
export function dedupeByNpmName(candidates: SeedCandidate[]): { kept: SeedCandidate[]; dropped: SeedSkip[] } {
  const byName = new Map<string, SeedCandidate[]>();
  for (const candidate of candidates) {
    const key = candidate.npmName ?? `__folder__:${candidate.folder}`;
    const group = byName.get(key) ?? [];
    group.push(candidate);
    byName.set(key, group);
  }
  const kept: SeedCandidate[] = [];
  const dropped: SeedSkip[] = [];
  for (const [name, group] of byName) {
    if (group.length === 1) {
      kept.push(group[0]!);
      continue;
    }
    const unscoped = name.includes("/") ? name.split("/")[1]! : name;
    const expectedFolder = `open-${unscoped}`;
    const winner =
      group.find((candidate) => candidate.folder === expectedFolder) ??
      [...group].sort((a, b) => a.folder.length - b.folder.length || a.folder.localeCompare(b.folder))[0]!;
    kept.push(winner);
    for (const candidate of group) {
      if (candidate !== winner) {
        dropped.push({ folder: candidate.folder, reason: `duplicate checkout of ${winner.folder} (npm name ${name})` });
      }
    }
  }
  return { kept: kept.sort((a, b) => a.folder.localeCompare(b.folder)), dropped };
}

/** Best-effort join against the open-projects registry via the `projects` CLI. */
export function loadProjectsJoin(): ProjectJoinRecord[] {
  try {
    const proc = Bun.spawnSync(["projects", "list", "--json"], { stdout: "pipe", stderr: "ignore" });
    if (proc.exitCode !== 0) return [];
    const parsed = JSON.parse(proc.stdout.toString()) as Array<Record<string, unknown>>;
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((row) => typeof row["slug"] === "string")
      .map((row) => ({
        slug: row["slug"] as string,
        primaryPath: typeof row["primary_path"] === "string" ? (row["primary_path"] as string) : null,
        gitRemote: typeof row["git_remote"] === "string" ? (row["git_remote"] as string) : null,
        description: typeof row["description"] === "string" ? (row["description"] as string) : null,
      }));
  } catch {
    return [];
  }
}

function githubUrlFor(candidate: SeedCandidate, join_: ProjectJoinRecord | undefined): string {
  const fromJoin = join_?.gitRemote;
  if (fromJoin && (fromJoin.startsWith("https://github.com/") || fromJoin.startsWith("git+https://github.com/"))) {
    return fromJoin;
  }
  const fromPkg = candidate.repositoryUrl;
  if (fromPkg && (fromPkg.startsWith("https://github.com/") || fromPkg.startsWith("git+https://github.com/"))) {
    return fromPkg;
  }
  return `https://github.com/hasna/${candidate.folder}`;
}

/** Build one `hasna.app.v1` document from a seed candidate. */
export function buildAppRecord(
  candidate: SeedCandidate,
  join_?: ProjectJoinRecord,
  now: string = new Date().toISOString()
): App {
  if (!candidate.npmName) {
    throw new Error(`Cannot build app record for ${candidate.folder}: package.json has no name`);
  }
  const surfaces: AppSurfaces = { bins: candidate.bins };
  const mcpBin = candidate.bins.find((bin) => bin.endsWith("-mcp"));
  if (mcpBin) {
    surfaces.mcp = { transport: "http", bin: mcpBin };
  }
  const summary = candidate.description ?? join_?.description ?? candidate.readmeFirstLine ?? undefined;
  const projectSlug =
    join_ && AppIdSchema.safeParse(join_.slug).success ? join_.slug : candidate.folder;
  return AppSchema.parse({
    schema: "hasna.app.v1",
    id: `app_${candidate.folder.replaceAll("-", "_")}`,
    createdAt: now,
    appId: candidate.folder,
    npmName: candidate.npmName,
    repoFolder: candidate.folder,
    githubUrl: githubUrlFor(candidate, join_),
    projectSlug,
    surfaces,
    lifecycle: candidate.bins.length > 0 || candidate.version ? "active" : "stub",
    releaseChannel: "stable",
    ...(summary ? { summary } : {}),
    tags: ["oss"],
    metadata: {
      version: candidate.version,
      seededFrom: "opensource-scan",
      seededAt: now,
    },
  });
}

export interface SeedCatalogOptions {
  root: string;
  store?: CatalogStoreLike;
  fixturePath?: string;
  projectsJoin?: ProjectJoinRecord[];
  now?: string;
}

/**
 * Scan an opensource checkout directory, build `hasna.app.v1` records for
 * every canonical repo, optionally write them into a store and a JSONL
 * fixture, and report what was seeded/skipped.
 */
export function seedCatalog(options: SeedCatalogOptions): SeedReport {
  const now = options.now ?? new Date().toISOString();
  const joinRecords = options.projectsJoin ?? [];
  const joinByPath = new Map<string, ProjectJoinRecord>();
  for (const record of joinRecords) {
    if (record.primaryPath) joinByPath.set(record.primaryPath, record);
  }

  const skipped: SeedSkip[] = [];
  const candidates: SeedCandidate[] = [];
  const entries = readdirSync(options.root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();

  for (const folder of entries) {
    const excluded = excludedFolderReason(folder);
    if (excluded) {
      skipped.push({ folder, reason: excluded });
      continue;
    }
    if (!existsSync(join(options.root, folder, ".git"))) {
      skipped.push({ folder, reason: "not a git repo" });
      continue;
    }
    if (!AppIdSchema.safeParse(folder).success) {
      skipped.push({ folder, reason: "folder name is not a valid app id slug" });
      continue;
    }
    const candidate = readSeedCandidate(options.root, folder);
    if (!candidate) {
      skipped.push({ folder, reason: "no package.json" });
      continue;
    }
    if (!candidate.npmName) {
      skipped.push({ folder, reason: "package.json has no name" });
      continue;
    }
    candidates.push(candidate);
  }

  const { kept, dropped } = dedupeByNpmName(candidates);
  skipped.push(...dropped);

  let joinedProjects = 0;
  const seeded: App[] = kept.map((candidate) => {
    const join_ = joinByPath.get(candidate.path);
    if (join_) joinedProjects += 1;
    return buildAppRecord(candidate, join_, now);
  });

  if (options.fixturePath) {
    mkdirSync(dirname(options.fixturePath), { recursive: true });
    const jsonl = seeded.map((app) => JSON.stringify(app)).join("\n");
    writeFileSync(options.fixturePath, jsonl.length > 0 ? `${jsonl}\n` : "");
  }
  if (options.store) {
    options.store.upsertApps(seeded);
  }

  return {
    root: options.root,
    scanned: entries.length,
    seeded,
    skipped: skipped.sort((a, b) => a.folder.localeCompare(b.folder)),
    joinedProjects,
  };
}
