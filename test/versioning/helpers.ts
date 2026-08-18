import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

export const REPOSITORY_ROOT = resolve(import.meta.dir, "../..");
export const SEMVER = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;

const DEPENDENCY_SECTIONS = [
  "dependencies",
  "devDependencies",
  "optionalDependencies",
  "peerDependencies",
] as const;

export type PackageManifest = {
  name?: unknown;
  version?: unknown;
  private?: unknown;
  [key: string]: unknown;
};

export type Member = {
  directory: string;
  manifestPath: string;
  name: string;
  version: string;
  manifest: PackageManifest;
};

export type PendingChangeset = {
  file: string;
  packages: Map<string, "major" | "minor" | "patch" | "none">;
  body: string;
};

export type WorkspaceReference = {
  member: Member;
  section: string;
  dependency: string;
  range: string;
};

export function discoverMembers(root = REPOSITORY_ROOT): Member[] {
  const appsRoot = join(root, "apps");
  return readdirSync(appsRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => {
      const directory = join(appsRoot, entry.name);
      const manifestPath = join(directory, "package.json");
      if (!existsSync(manifestPath)) return null;
      const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as PackageManifest;
      if (manifest.private === true || typeof manifest.name !== "string" || typeof manifest.version !== "string") {
        return null;
      }
      return { directory, manifestPath, manifest, name: manifest.name, version: manifest.version };
    })
    .filter((member): member is Member => member !== null)
    .sort((left, right) => left.name.localeCompare(right.name));
}

export function parseChangesetFrontmatter(raw: string, file: string): PendingChangeset {
  const lines = raw.split(/\r?\n/);
  if (lines[0]?.trim() !== "---") throw new Error(`${file}: missing opening frontmatter delimiter`);
  const closing = lines.findIndex((line, index) => index > 0 && line.trim() === "---");
  if (closing < 0) throw new Error(`${file}: missing closing frontmatter delimiter`);

  const packages = new Map<string, "major" | "minor" | "patch" | "none">();
  for (const line of lines.slice(1, closing)) {
    const match = /^\s*["']?([^"':]+)["']?\s*:\s*(major|minor|patch|none)\s*$/.exec(line);
    if (!match) {
      if (line.trim()) throw new Error(`${file}: malformed changeset entry: ${line.trim()}`);
      continue;
    }
    packages.set(match[1]!.trim(), match[2] as "major" | "minor" | "patch" | "none");
  }

  const body = lines.slice(closing + 1).join("\n").trim();
  if (packages.size === 0) throw new Error(`${file}: changeset has no package entries`);
  if (!body) throw new Error(`${file}: changeset has an empty description`);
  return { file, packages, body };
}

export function readPendingChangesets(root = REPOSITORY_ROOT): PendingChangeset[] {
  const changesetRoot = join(root, ".changeset");
  return readdirSync(changesetRoot)
    .filter((file) => file.endsWith(".md") && file !== "README.md")
    .sort()
    .map((file) => parseChangesetFrontmatter(readFileSync(join(changesetRoot, file), "utf8"), file));
}

export function readLatestChangelogVersion(member: Member): string | null {
  const changelogPath = join(member.directory, "CHANGELOG.md");
  if (!existsSync(changelogPath)) return null;
  const source = readFileSync(changelogPath, "utf8");
  return /^##\s+\[?v?(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)/gm.exec(source)?.[1] ?? null;
}

export function readVersionFiles(member: Member): string[] {
  const sourceRoot = join(member.directory, "src");
  if (!existsSync(sourceRoot)) return [];
  const files: string[] = [];
  const visit = (directory: string): void => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) visit(path);
      else if (/version[^/]*\.(?:ts|tsx|js|mjs)$/.test(entry.name)) files.push(path);
    }
  };
  visit(sourceRoot);
  return files.sort();
}

export function readStaticRuntimeVersions(file: string): string[] {
  const source = readFileSync(file, "utf8");
  const versions: string[] = [];
  for (const line of source.split(/\r?\n/)) {
    const match = /export\s+const\s+([A-Za-z0-9_]*(?:VERSION|Version))\s*=.*?["'](\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)["']/.exec(line);
    if (match && !match[1]!.startsWith("FALLBACK")) versions.push(match[2]!);
  }
  return versions;
}

export function readWorkspaceReferences(members: Member[]): WorkspaceReference[] {
  return members.flatMap((member) =>
    DEPENDENCY_SECTIONS.flatMap((section) => {
      const dependencies = member.manifest[section];
      if (!dependencies || typeof dependencies !== "object" || Array.isArray(dependencies)) return [];
      return Object.entries(dependencies as Record<string, unknown>)
        .filter(([, value]) => typeof value === "string" && value.startsWith("workspace:"))
        .map(([dependency, range]) => ({ member, section, dependency, range: range as string }));
    }),
  );
}

export function rewriteWorkspaceRange(range: string, targetVersion: string): string {
  const suffix = range.slice("workspace:".length).trim();
  if (suffix === "*") return targetVersion;
  if (suffix === "^") return `^${targetVersion}`;
  if (suffix === "~") return `~${targetVersion}`;
  if (/^(?:\^|~)?\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(suffix)) return suffix;
  throw new Error(`Unsupported workspace range: ${range}`);
}

/**
 * The changeset-consuming release diff shape: `changeset version` bumps the
 * package.json versions named by pending changesets, writes the CHANGELOG.md
 * headings, and DELETES the applied .changeset/*.md files. A release PR built that
 * way (measured hasna/apps#277, #154) legitimately ships version bumps with no
 * PENDING changeset — the accompanying changeset was consumed to produce the bump.
 * This returns the names of the .changeset/*.md files deleted in `base...HEAD`
 * (null when the base ref is unresolvable, mirroring changedPackageVersions).
 */
export function consumedChangesetFiles(
  root = REPOSITORY_ROOT,
  base = process.env.VERSIONING_BASE_REF ?? "origin/main",
): string[] | null {
  const result = Bun.spawnSync({
    cmd: ["git", "diff", "--unified=0", `${base}...HEAD`, "--", ".changeset/"],
    cwd: root,
    stdout: "pipe",
    stderr: "pipe",
  });
  if (result.exitCode !== 0) return null;
  const lines = new TextDecoder().decode(result.stdout).split(/\r?\n/);
  const deleted: string[] = [];
  for (let index = 0; index < lines.length; index++) {
    const fileMatch = /^--- a\/\.changeset\/([^/]+\.md)$/.exec(lines[index]!);
    if (fileMatch && lines[index + 1]?.trim() === "+++ /dev/null" && fileMatch[1] !== "README.md") deleted.push(fileMatch[1]!);
  }
  return deleted;
}

/**
 * Packages named by the changesets this diff consumed (see consumedChangesetFiles):
 * their content is read from the diff's MERGE-BASE and parsed, so the release PR's
 * version bumps count as accompanied-by-a-changeset — the changeset is in the diff,
 * consumed rather than pending. Empty when the diff consumed nothing.
 *
 * The merge-base, never the base ref itself: a consumed file can vanish from the
 * base ref once the base moves past the release (the release's .changeset deletions
 * then sit on BOTH sides of the three-dot diff), while the merge-base still holds
 * it. Measured live 2026-08-18 against hasna/apps#277's head (prompts 0.3.33) with
 * an origin/main that had already absorbed the release.
 */
export function consumedChangesetPackages(
  root = REPOSITORY_ROOT,
  base = process.env.VERSIONING_BASE_REF ?? "origin/main",
): Map<string, string> {
  const files = consumedChangesetFiles(root, base) ?? [];
  if (files.length === 0) return new Map();
  const mergeBaseResult = Bun.spawnSync({ cmd: ["git", "merge-base", base, "HEAD"], cwd: root, stdout: "pipe", stderr: "pipe" });
  if (mergeBaseResult.exitCode !== 0) return new Map();
  const readRef = new TextDecoder().decode(mergeBaseResult.stdout).trim();
  const packages = new Map<string, string>();
  for (const file of files) {
    const raw = Bun.spawnSync({ cmd: ["git", "show", `${readRef}:.changeset/${file}`], cwd: root, stdout: "pipe", stderr: "pipe" });
    if (raw.exitCode !== 0) continue;
    const parsed = parseChangesetFrontmatter(new TextDecoder().decode(raw.stdout), file);
    for (const packageName of parsed.packages.keys()) packages.set(packageName, file);
  }
  return packages;
}

export function changedPackageVersions(root = REPOSITORY_ROOT): Map<string, string> | null {
  const base = process.env.VERSIONING_BASE_REF ?? "origin/main";
  const result = Bun.spawnSync({
    cmd: ["git", "diff", "--unified=0", `${base}...HEAD`, "--", "apps/*/package.json"],
    cwd: root,
    stdout: "pipe",
    stderr: "pipe",
  });
  if (result.exitCode !== 0) return null;
  const diff = new TextDecoder().decode(result.stdout);
  const changed = new Map<string, string>();
  let currentPackage: string | null = null;
  for (const line of diff.split(/\r?\n/)) {
    const pathMatch = /^\+\+\+ b\/apps\/([^/]+)\/package\.json$/.exec(line);
    if (pathMatch) currentPackage = pathMatch[1]!;
    const versionMatch = /^\+\s+"version":\s+"([^"]+)"/.exec(line);
    if (versionMatch && currentPackage) changed.set(currentPackage, versionMatch[1]!);
  }
  return changed;
}

export function parseBunfigExcludes(path: string): Set<string> {
  if (!existsSync(path)) return new Set();
  const source = readFileSync(path, "utf8");
  const sectionStart = source.indexOf("minimumReleaseAgeExcludes");
  if (sectionStart < 0) return new Set();
  const section = source.slice(sectionStart, source.indexOf("]", sectionStart) + 1);
  return new Set([...section.matchAll(/["'](@hasna\/[^"']+)["']/g)].map((match) => match[1]!));
}

export function homeBunfigPath(): string {
  return process.env.VERSIONING_BUNFIG_PATH ?? join(process.env.HOME ?? dirname(REPOSITORY_ROOT), ".bunfig.toml");
}
