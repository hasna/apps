import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  renameSync,
  rmSync,
} from "node:fs";
import { dirname, isAbsolute, join, normalize, relative, resolve } from "node:path";

function assertSafeRelativePath(path: string): void {
  const normalized = normalize(path);
  if (!path || isAbsolute(path) || normalized === ".." || normalized.startsWith(`..${process.platform === "win32" ? "\\" : "/"}`)) {
    throw new Error(`artifact promotion path must stay within the repository: ${path || "<empty>"}`);
  }
}

/**
 * Promote verified build outputs while retaining an exact, same-filesystem
 * rollback until every caller-supplied late gate has passed.
 */
export function withVerifiedArtifactPromotion<T>(
  repositoryRoot: string,
  verifiedSourceRoot: string,
  relativePaths: string[],
  runLateGates: () => T,
): T {
  const root = resolve(repositoryRoot);
  const sourceRoot = resolve(verifiedSourceRoot);
  for (const path of relativePaths) {
    assertSafeRelativePath(path);
    const source = resolve(sourceRoot, path);
    if (relative(sourceRoot, source).startsWith("..") || !existsSync(source)) {
      throw new Error(`verified build is missing ${path}`);
    }
  }

  const rollbackRoot = mkdtempSync(join(dirname(root), ".todos-release-rollback-"));
  const backedUp = new Set<string>();
  const touched = new Set<string>();
  let committed = false;
  try {
    for (const path of relativePaths) {
      const destination = join(root, path);
      const backup = join(rollbackRoot, path);
      if (existsSync(destination)) {
        mkdirSync(dirname(backup), { recursive: true });
        renameSync(destination, backup);
        backedUp.add(path);
      }
      touched.add(path);
      mkdirSync(dirname(destination), { recursive: true });
      cpSync(join(sourceRoot, path), destination, { recursive: true, verbatimSymlinks: true });
    }

    const result = runLateGates();
    committed = true;
    return result;
  } finally {
    if (!committed) {
      for (const path of [...touched].reverse()) {
        const destination = join(root, path);
        rmSync(destination, { recursive: true, force: true });
        if (backedUp.has(path)) {
          const backup = join(rollbackRoot, path);
          mkdirSync(dirname(destination), { recursive: true });
          renameSync(backup, destination);
        }
      }
    }
    rmSync(rollbackRoot, { recursive: true, force: true });
  }
}
