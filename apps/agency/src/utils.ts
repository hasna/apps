import { execSync, spawn, execFileSync } from "child_process";
import { existsSync, statSync, readdirSync, mkdirSync, chmodSync, renameSync } from "fs";
import { join, resolve, dirname } from "path";
import { homedir } from "os";

export const HASNA_HOME = resolve(join(homedir(), ".hasna"));

export function dataPath(name: string): string {
  return join(HASNA_HOME, name);
}

export function dirExists(p: string): boolean {
  try {
    return existsSync(p) && statSync(p).isDirectory();
  } catch {
    return false;
  }
}

export function fileExists(p: string): boolean {
  try {
    return existsSync(p) && statSync(p).isFile();
  } catch {
    return false;
  }
}

export function dbSize(dir: string): number {
  if (!dirExists(dir)) return 0;
  try {
    let total = 0;
    const entries = readdirSync(dir, { recursive: true });
    for (const entry of entries) {
      const full = join(dir, String(entry));
      if (full.endsWith(".db") || full.endsWith(".sqlite") || full.endsWith(".sqlite3")) {
        try {
          total += statSync(full).size;
        } catch {
          /* unreadable entry */
        }
      }
    }
    return total;
  } catch {
    return 0;
  }
}

export function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  const val = bytes / Math.pow(1024, i);
  return `${val.toFixed(i > 0 ? 1 : 0)} ${units[i]}`;
}

export function execSafe(cmd: string, timeoutMs = 10_000): string | null {
  try {
    return execSync(cmd, {
      encoding: "utf8",
      timeout: timeoutMs,
      stdio: ["pipe", "pipe", "pipe"],
    }).trim();
  } catch {
    return null;
  }
}

/**
 * execSafe variant that passes an explicit environment to the child process.
 * Use for commands that need secrets (e.g. PGPASSWORD): the value lives in the
 * child environment only and never appears in the command string / process
 * argument list. `env` is merged over the ambient process environment.
 */
export function execSafeEnv(cmd: string, timeoutMs = 10_000, env: Record<string, string> = {}): string | null {
  try {
    return execSync(cmd, {
      encoding: "utf8",
      timeout: timeoutMs,
      stdio: ["pipe", "pipe", "pipe"],
      env: { ...process.env, ...env },
    }).trim();
  } catch {
    return null;
  }
}

/**
 * argv-based execution — the command and every argument travel as separate
 * argv entries, never through a shell, so operator- or disk-influenced values
 * (search queries, archive paths, database paths, identifiers) cannot carry
 * shell substitution or quote breakout. Use this wherever a value can be
 * influenced by the operator or by data on disk (release-review P1: reachable
 * shell injection through ordinary CLI input).
 */
export function spawnSafe(
  cmd: string,
  args: string[],
  timeoutMs = 10_000,
  env: Record<string, string | undefined> = {},
  cwd?: string,
): string | null {
  try {
    // The caller's env is authoritative over process.env, INCLUDING
    // exclusions: an explicit `undefined` value DELETES the key from the
    // child environment (a caller that must strip a credential from a child
    // process cannot express that through a spread that re-injects it —
    // release-review P1: ambient NODE_AUTH_TOKEN must never reach build/pack).
    const childEnv: Record<string, string> = {};
    for (const [k, v] of Object.entries(process.env)) {
      if (v !== undefined) childEnv[k] = v;
    }
    for (const [k, v] of Object.entries(env)) {
      if (v === undefined) delete childEnv[k];
      else childEnv[k] = v;
    }
    return execFileSync(cmd, args, {
      encoding: "utf8",
      timeout: timeoutMs,
      stdio: ["pipe", "pipe", "pipe"],
      env: childEnv,
      cwd,
    }).trim();
  } catch {
    return null;
  }
}

/**
 * Copies staged content over a live target directory with a pre-copy snapshot
 * and rollback. The snapshot lives in a mode-0700 sibling directory (never
 * inside the copied dir, never world-readable under /tmp) with the archive
 * forced to mode 0600, so it can never be copied into the target and never
 * exposes the complete live-data preimage (release-review P1). On copy failure
 * the preimage is restored by extracting the snapshot into a fresh 0700 tree
 * and atomically swapping it over the live target, so `rolledBack: true` means
 * the target equals the pre-copy state and no mid-copy residue survives
 * (release-review P1: an overlay restore is not a rollback). Any snapshot that
 * cannot be removed, or any rollback step that fails, is REPORTED via the
 * returned snapshot path — never silently dropped — and the snapshot is
 * retained for manual recovery.
 */
/**
 * Atomically swaps a restore tree over the live target: the live directory is
 * RENAMED aside first (atomic — never deleted), then the restore tree is
 * renamed into place (atomic). If the second rename fails, the live directory
 * is renamed back, so the target path is never absent at any point
 * (release-review P1: delete-then-rename is not an atomic swap and leaves the
 * target missing when the rename fails). Exported so tests can pin both the
 * success and the failure path.
 */
/**
 * Creates the pre-copy snapshot of a live target: a mode-0700 sibling
 * directory (next to the STAGED dir, never inside the copied tree, never
 * world-readable under /tmp) holding a mode-0600 archive of the COMPLETE
 * preimage — no exclusions, because a rollback that cannot restore a
 * pre-existing subtree would delete data it cannot recover while reporting
 * success (release-review P1). Returns the archive path, or null when the
 * snapshot could not be taken. Exported so tests can pin the enforced modes.
 */
export function createPreCopySnapshot(snapDirBase: string, targetDir: string, timeoutMs: number): string | null {
  const snapDir = `${snapDirBase}.precopy`;
  try {
    mkdirSync(snapDir, { recursive: true, mode: 0o700 });
    chmodSync(snapDir, 0o700);
  } catch {
    return null;
  }
  const snapshot = join(snapDir, "precopy-snapshot.tar.gz");
  const snapResult = spawnSafe("tar", ["-czf", snapshot, "-C", targetDir, "."], timeoutMs);
  if (snapResult === null || !fileExists(snapshot)) {
    return null;
  }
  try {
    chmodSync(snapshot, 0o600);
  } catch {
    /* best-effort mode enforcement */
  }
  return snapshot;
}

export function atomicSwapRestore(restoreDir: string, targetDir: string): { ok: boolean; targetRestored: boolean } {
  const backupDir = `${targetDir}.swap-backup-${Date.now()}`;
  try {
    renameSync(targetDir, backupDir);
  } catch {
    // The live target could not even be moved aside — it is untouched.
    return { ok: false, targetRestored: true };
  }
  try {
    renameSync(restoreDir, targetDir);
  } catch {
    // The live target sits under the backup name; move it back so the target
    // path is never absent.
    try {
      renameSync(backupDir, targetDir);
      return { ok: false, targetRestored: true };
    } catch {
      return { ok: false, targetRestored: false };
    }
  }
  // The swap landed; the backup holds the pre-copy live tree and is removed
  // best-effort (a retained backup is the caller's call to report).
  spawnSafe("rm", ["-rf", backupDir], 60_000);
  return { ok: true, targetRestored: true };
}

export function copyStagedWithRollback(
  stagedDir: string,
  targetDir: string,
  timeoutMs = 120_000,
): { ok: boolean; rolledBack: boolean; snapshot: string | null } {
  let snapshot: string | null = null;
  if (dirExists(targetDir)) {
    // Snapshot the COMPLETE preimage — no exclusions. A rollback that cannot
    // restore a pre-existing subtree (e.g. `backups` excluded from the
    // snapshot, then removed as staged residue) would delete data it cannot
    // recover while reporting rolledBack: true (release-review P1).
    snapshot = createPreCopySnapshot(stagedDir, targetDir, timeoutMs);
    if (snapshot === null) {
      return { ok: false, rolledBack: false, snapshot: null };
    }
  }
  const copyResult = spawnSafe("cp", ["-a", `${stagedDir}/.`, `${targetDir}/`], timeoutMs);
  if (copyResult !== null) {
    if (snapshot) {
      // A snapshot that cannot be removed is REPORTED, not silently dropped.
      const removed = removeSnapshotTree(snapshot);
      if (!removed) return { ok: true, rolledBack: false, snapshot };
    }
    return { ok: true, rolledBack: false, snapshot: null };
  }
  // Copy failed — restore the exact preimage with an atomic swap: extract to a
  // fresh 0700 sibling tree, then replace the live target. The live target is
  // removed only AFTER the restore tree is verified present.
  if (snapshot) {
    const restoreDir = `${targetDir}.restore-${Date.now()}`;
    try {
      mkdirSync(restoreDir, { mode: 0o700 });
    } catch {
      return { ok: false, rolledBack: false, snapshot };
    }
    const extractResult = spawnSafe("tar", ["-xzf", snapshot, "-C", restoreDir], timeoutMs);
    if (extractResult === null || !dirExists(restoreDir)) {
      spawnSafe("rm", ["-rf", restoreDir], 10_000);
      return { ok: false, rolledBack: false, snapshot };
    }
    // Atomic swap: the live target is renamed aside (never deleted), the
    // restore tree is renamed into place, and on failure the live tree is
    // renamed back — the target path is never absent (release-review P1:
    // delete-then-rename is not an atomic swap). A failed swap reports
    // rolledBack: false with the retained snapshot as the recovery path,
    // because the renamed-back tree may carry mid-copy residue.
    const swap = atomicSwapRestore(restoreDir, targetDir);
    if (!swap.ok) {
      return { ok: false, rolledBack: false, snapshot };
    }
    const removed = removeSnapshotTree(snapshot);
    if (!removed) return { ok: false, rolledBack: true, snapshot };
    return { ok: false, rolledBack: true, snapshot: null };
  }
  return { ok: false, rolledBack: false, snapshot: null };
}

/**
 * Removes the snapshot directory holding `snapshotPath`. Returns false (and
 * leaves the tree in place) when any removal fails, so callers can REPORT the
 * retained snapshot instead of losing it silently (release-review P1).
 */
function removeSnapshotTree(snapshotPath: string): boolean {
  const snapDir = dirname(snapshotPath);
  const rm = spawnSafe("rm", ["-rf", snapDir], 5000);
  return rm !== null;
}

/**
 * Verifies that `filePath` is a readable tar archive. Returns the full `tar -tzf`
 * listing on success, or null when the archive is unreadable/corrupt. Callers
 * MUST treat null as a hard failure — never display a truncated listing built
 * from a pipe (`tar | head`) as "validated", because that masks extraction
 * failures before live data is touched.
 */
export function verifyTarball(filePath: string, timeoutMs = 60_000): string | null {
  // argv-based: the archive path is operator-supplied and must never travel
  // through a shell (release-review P1: shell injection via user-controlled
  // paths reaching archive verification).
  return spawnSafe("tar", ["-tzf", filePath], timeoutMs);
}

/**
 * Validates the tarball (rc-checked, no pipe masking) and returns up to `limit`
 * listing lines for display. Returns null when the archive is invalid.
 */
export function listTarball(filePath: string, limit: number, timeoutMs = 60_000): string | null {
  const listing = verifyTarball(filePath, timeoutMs);
  if (listing === null) return null;
  return listing.split("\n").slice(0, limit).join("\n");
}

export function getInstalledVersion(npmName: string): string | null {
  const result = execSafe(`npm ls -g ${npmName} --depth=0 --json 2>/dev/null`);
  if (!result) return null;
  try {
    const parsed = JSON.parse(result);
    const deps = parsed.dependencies || {};
    const key = Object.keys(deps).find((k) => k === npmName);
    return key ? deps[key].version || null : null;
  } catch {
    return null;
  }
}

export function getLatestVersion(npmName: string): string | null {
  return execSafe(`npm view ${npmName} version 2>/dev/null`);
}

export function spawnWithTimeout(
  cmd: string,
  args: string[],
  timeoutMs: number,
  env: Record<string, string> = {},
): Promise<{ code: number | null; stdout: string; stderr: string; timedOut: boolean }> {
  return new Promise((resolve2) => {
    let stdout = "";
    let stderr = "";
    let killed = false;
    let settled = false;
    // Hard deadline: SIGTERM at the timeout, then SIGKILL after a short grace,
    // and the promise resolves at the deadline regardless — a child that
    // ignores SIGTERM must never hang the caller past the advertised timeout.
    // (release-review P1: the advertised MCP timeout could hang indefinitely.)
    let killTimer: NodeJS.Timeout | null = null;
    const finish = (result: { code: number | null; stdout: string; stderr: string; timedOut: boolean }): void => {
      if (settled) return;
      settled = true;
      clearTimeout(termTimer);
      if (killTimer) clearTimeout(killTimer);
      resolve2(result);
    };
    const opts = {
      stdio: ["pipe", "pipe", "pipe"] as ["pipe", "pipe", "pipe"],
      env: { ...process.env, ...env },
    };
    const child = spawn(cmd, args, opts);
    const termTimer = setTimeout(() => {
      killed = true;
      try {
        child.kill("SIGTERM");
      } catch {
        /* already gone */
      }
      killTimer = setTimeout(() => {
        try {
          child.kill("SIGKILL");
        } catch {
          /* already gone */
        }
        finish({ code: null, stdout, stderr: stderr + `\n[timeout]`, timedOut: true });
      }, 1000);
    }, timeoutMs);
    child.stdout?.on("data", (d) => {
      stdout += d.toString();
    });
    child.stderr?.on("data", (d) => {
      stderr += d.toString();
    });
    child.on("close", (code) => {
      if (killed) {
        finish({ code: null, stdout, stderr: stderr + `\n[timeout]`, timedOut: true });
      } else {
        finish({ code, stdout, stderr, timedOut: false });
      }
    });
    child.on("error", (err) => {
      finish({ code: null, stdout, stderr: err.message, timedOut: false });
    });
  });
}

export function binaryExists(name: string): boolean {
  return execSafe(`which ${name}`) !== null;
}

export function pad(str: string, width: number): string {
  return str.length >= width ? str.slice(0, width) : str + " ".repeat(width - str.length);
}

export function truncate(str: string, max: number): string {
  return str.length <= max ? str : str.slice(0, max - 1) + "…";
}
