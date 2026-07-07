import { existsSync, realpathSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { isAbsolute, relative, resolve } from "node:path";

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

export function gitTopLevelForPath(path: string): string | undefined {
  if (!existsSync(path)) return undefined;
  const result = spawnSync("git", ["-C", path, "rev-parse", "--show-toplevel"], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
  });
  const root = result.stdout.trim();
  return result.status === 0 && root ? realpathOrResolve(root) : undefined;
}

export function gitProjectRootForPath(path: string): string | undefined {
  const canonical = realpathOrResolve(path);
  const root = gitTopLevelForPath(canonical);
  if (!root) return undefined;
  const rel = relative(root, canonical);
  if (!rel) return root;
  if (rel.startsWith("..") || isAbsolute(rel)) return undefined;
  if (isGeneratedWorkspaceRelativePath(rel)) return undefined;
  return root;
}

export function isExistingGitProjectPath(path: string): boolean {
  return Boolean(gitProjectRootForPath(path));
}
