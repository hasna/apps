import { execSync, spawn } from "child_process";
import { existsSync, statSync, readdirSync } from "fs";
import { join, resolve } from "path";
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
 * Verifies that `filePath` is a readable tar archive. Returns the full `tar -tzf`
 * listing on success, or null when the archive is unreadable/corrupt. Callers
 * MUST treat null as a hard failure — never display a truncated listing built
 * from a pipe (`tar | head`) as "validated", because that masks extraction
 * failures before live data is touched.
 */
export function verifyTarball(filePath: string, timeoutMs = 60_000): string | null {
  return execSafe(`tar -tzf "${filePath}" 2>&1`, timeoutMs);
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
): Promise<{ code: number | null; stdout: string; stderr: string }> {
  return new Promise((resolve2) => {
    let stdout = "";
    let stderr = "";
    let killed = false;
    const opts = {
      stdio: ["pipe", "pipe", "pipe"] as ["pipe", "pipe", "pipe"],
      env: { ...process.env, ...env },
    };
    const child = spawn(cmd, args, opts);
    const timer = setTimeout(() => {
      killed = true;
      child.kill("SIGTERM");
    }, timeoutMs);
    child.stdout?.on("data", (d) => {
      stdout += d.toString();
    });
    child.stderr?.on("data", (d) => {
      stderr += d.toString();
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (killed) {
        resolve2({ code: null, stdout, stderr: stderr + `\n[timeout]` });
      } else {
        resolve2({ code, stdout, stderr });
      }
    });
    child.on("error", (err) => {
      clearTimeout(timer);
      resolve2({ code: null, stdout, stderr: err.message });
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
