import { existsSync, realpathSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";

const GENERATED_WORKSPACE_DIRS = new Set([".tmp", ".bun-cache", "node_modules", "dist"]);

export function realpathOrResolve(path: string): string {
  try {
    return realpathSync(path);
  } catch {
    return resolve(path);
  }
}

export function isGeneratedWorkspaceRelativePath(path: string): boolean {
  return path.split(/[\\/]+/).filter(Boolean).some((part) => GENERATED_WORKSPACE_DIRS.has(part));
}

function relativePathWithin(root: string, path: string): string | undefined {
  const rel = relative(root, path);
  if (!rel) return "";
  if (rel === ".." || rel.startsWith(`..${sep}`) || isAbsolute(rel)) return undefined;
  return rel;
}

export function gitTopLevelForPath(path: string): string | undefined {
  if (!existsSync(path)) return undefined;
  const result = spawnSync("git", ["-C", path, "rev-parse", "--show-toplevel"], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
  });
  const root = result.stdout.trim();
  return result.status === 0 && root ? realpathOrResolve(root) : undefined;
}

function lexicalGitTopLevelsForPath(path: string): string[] {
  const roots: string[] = [];
  let current = dirname(path);
  while (true) {
    const root = gitTopLevelForPath(current);
    if (
      root &&
      relativePathWithin(root, current) !== undefined &&
      !roots.includes(root)
    ) {
      roots.push(root);
    }
    const parent = dirname(current);
    if (parent === current) return roots;
    current = parent;
  }
}

export function gitProjectRootForPath(path: string): string | undefined {
  const requested = resolve(path);
  const canonical = realpathOrResolve(requested);
  const root = gitTopLevelForPath(canonical);
  if (!root) return undefined;
  for (const lexicalRoot of lexicalGitTopLevelsForPath(requested)) {
    const lexicalRel = relativePathWithin(lexicalRoot, requested);
    if (lexicalRel !== undefined && isGeneratedWorkspaceRelativePath(lexicalRel)) return undefined;
  }
  const requestedRel = relativePathWithin(root, requested);
  if (requestedRel !== undefined && isGeneratedWorkspaceRelativePath(requestedRel)) return undefined;
  const canonicalRel = relativePathWithin(root, canonical);
  if (canonicalRel === undefined) return undefined;
  if (isGeneratedWorkspaceRelativePath(canonicalRel)) return undefined;
  return root;
}

export function isExistingGitProjectPath(path: string): boolean {
  return Boolean(gitProjectRootForPath(path));
}
