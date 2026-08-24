/**
 * Atomic hydrate — write bytes to a target path so a reader never observes a
 * partial artifact.
 *
 * The sequence: write to a unique temp sibling, fsync-free rename into place,
 * and on any failure remove the temp so no residue survives. A rename within
 * the same directory is atomic on POSIX filesystems, which is what makes a
 * concurrent reader see either the old complete artifact or the new complete
 * artifact, never a torn one. If the rename fails the temp is removed and the
 * error propagates; the original target (when one existed) is left untouched.
 */
import { mkdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

export function atomicWrite(targetPath: string, bytes: Uint8Array): void {
  const dir = dirname(targetPath);
  mkdirSync(dir, { recursive: true });
  const tempPath = join(dir, `.${basenameSafe(targetPath)}.tmp-${process.pid}-${Date.now()}-${randomSuffix()}`);
  try {
    writeFileSync(tempPath, bytes);
    renameSync(tempPath, targetPath);
  } catch (error) {
    try {
      rmSync(tempPath, { force: true });
    } catch {
      // best-effort cleanup; the original error is the one that matters
    }
    throw error;
  }
}

function basenameSafe(targetPath: string): string {
  const parts = targetPath.split(/[\\/]+/).filter(Boolean);
  return parts[parts.length - 1] ?? "artifact";
}

function randomSuffix(): string {
  return Math.random().toString(36).slice(2, 10);
}
