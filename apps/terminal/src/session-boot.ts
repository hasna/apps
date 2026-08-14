// Session boot cache — precompute common data on first MCP call
// Agents always start with git status + file tree + package.json — do it once

import { spawn } from "child_process";
import { existsSync, readFileSync } from "fs";
import { join } from "path";
import { getShell } from "./shell.js";

let bootCache: Record<string, unknown> | null = null;
let bootCwd: string = "";

function exec(command: string, cwd: string): Promise<string> {
  return new Promise((resolve) => {
    const proc = spawn(getShell(), ["-c", command], { cwd, stdio: ["ignore", "pipe", "pipe"] });
    let out = "";
    proc.stdout?.on("data", (d: Buffer) => { out += d.toString(); });
    proc.on("close", () => resolve(out.trim()));
    proc.on("error", () => resolve(""));
  });
}

/** Get or build session boot context */
export async function getBootContext(cwd: string): Promise<Record<string, unknown>> {
  if (bootCache && bootCwd === cwd) return bootCache;

  const [branch, status, log, srcLs] = await Promise.all([
    exec("git branch --show-current 2>/dev/null", cwd),
    exec("git status --porcelain 2>/dev/null", cwd),
    exec("git log --oneline -8 2>/dev/null", cwd),
    exec("ls -1 src/ 2>/dev/null || ls -1 lib/ 2>/dev/null || echo ''", cwd),
  ]);

  let pkg: any = null;
  const pkgPath = join(cwd, "package.json");
  if (existsSync(pkgPath)) {
    try { pkg = JSON.parse(readFileSync(pkgPath, "utf8")); } catch {}
  }

  const sourceFiles = srcLs.split("\n").filter(l => l.trim());

  bootCache = {
    cwd,
    git: {
      branch: branch || null,
      dirty: status.length > 0,
      changedFiles: status.split("\n").filter(l => l.trim()).length,
      recentCommits: log.split("\n").filter(l => l.trim()).slice(0, 5).map(l => {
        const m = l.match(/^([a-f0-9]+)\s+(.+)$/);
        return m ? { hash: m[1], message: m[2] } : null;
      }).filter(Boolean),
    },
    project: pkg ? {
      name: pkg.name,
      version: pkg.version,
      scripts: pkg.scripts ? Object.keys(pkg.scripts) : [],
      deps: pkg.dependencies ? Object.keys(pkg.dependencies).length : 0,
    } : null,
    sourceFiles: sourceFiles.slice(0, 50),
    sourceFileCount: sourceFiles.length,
    hint: sourceFiles.length > 50 ? "Boot context capped sourceFiles at 50 entries. Use project_overview or search_files for more." : undefined,
  };
  bootCwd = cwd;

  return bootCache;
}

/** Invalidate boot cache (call after git operations or file changes) */
export function invalidateBootCache(): void {
  bootCache = null;
}
