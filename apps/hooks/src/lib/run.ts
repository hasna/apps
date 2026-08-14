/**
 * Verified hook execution — the verified bytes are the executed bytes.
 *
 * The trust check hashes the script content once; executing a PATH afterwards
 * would re-open the file and could run different bytes (TOCTOU). So the
 * verified content is written to a runner-owned temp file next to the original
 * script and that file is executed. The original path is never opened for
 * execution after verification.
 *
 * The temp file sits in the script's own directory so the hook's relative
 * imports resolve exactly as they do today (bundled hooks import shared
 * modules like ../../../src/lib/db-writer). A temp file in the system tmp dir
 * would break that resolution.
 */

import { randomBytes } from "crypto";
import { rmSync, writeFileSync } from "fs";
import { basename, dirname, isAbsolute, join } from "path";

export interface VerifiedRunOptions {
  /** Registered hook name (for error messages) */
  name: string;
  /**
   * The hook's on-disk script path. Only its directory and basename are used:
   * the path itself is never re-opened for execution.
   */
  scriptPath: string;
  /** The verified bytes to execute — exactly what was hashed and trusted */
  content: Buffer;
  /** Args passed through to the hook script */
  args?: string[];
  /** Input passed to the hook on stdin */
  stdin: string;
  env?: Record<string, string | undefined>;
  timeout?: number;
}

export interface VerifiedRunResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

function extensionOf(scriptPath: string): string {
  const base = basename(scriptPath);
  const dot = base.lastIndexOf(".");
  return dot > 0 ? base.slice(dot + 1) : "ts";
}

export async function executeVerifiedScript(options: VerifiedRunOptions): Promise<VerifiedRunResult> {
  const scriptDir = dirname(options.scriptPath);
  const tempPath = join(scriptDir, `.hooks-verified-${randomBytes(12).toString("hex")}.${extensionOf(options.scriptPath)}`);
  try {
    // "wx" refuses to overwrite; the name is unguessable, so a pre-existing
    // file with the same name is evidence of interference, not a collision.
    writeFileSync(tempPath, options.content, { flag: "wx", mode: 0o600 });
    const proc = Bun.spawn(["bun", "run", isAbsolute(tempPath) ? tempPath : `./${tempPath}`, ...(options.args ?? [])], {
      stdin: new Response(options.stdin),
      stdout: "pipe",
      stderr: "pipe",
      env: options.env ?? process.env,
      ...(options.timeout ? { timeout: options.timeout } : {}),
    });
    const [stdoutText, stderrText, exitCode] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ]);
    return { stdout: stdoutText, stderr: stderrText, exitCode };
  } finally {
    try {
      rmSync(tempPath, { force: true });
    } catch {
      // Best-effort cleanup; the file is 0600 and holds only the verified
      // hook content.
    }
  }
}
