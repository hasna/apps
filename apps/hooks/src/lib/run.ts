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
import type { Subprocess } from "bun";
import { buildHookEnv } from "./hook-env.js";

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

/**
 * Raised when a verified script exceeds its timeout. The whole process group
 * was killed, so no descendant survives (see executeVerifiedScript).
 */
export class HookTimeoutError extends Error {
  readonly timeoutMs: number;
  constructor(timeoutMs: number) {
    super(`Hook timed out after ${timeoutMs}ms (process group killed)`);
    this.name = "HookTimeoutError";
    this.timeoutMs = timeoutMs;
  }
}

const BASH_EXTENSIONS = new Set(["sh", "bash"]);
const BUN_EXTENSIONS = new Set(["ts", "tsx", "js", "jsx", "mjs", "cjs", "mts", "cts"]);

function extensionOf(scriptPath: string): string {
  const base = basename(scriptPath);
  const dot = base.lastIndexOf(".");
  return dot > 0 ? base.slice(dot + 1) : "ts";
}

/** Basename of the interpreter named by the first line's shebang, or null. */
function shebangInterpreter(firstLine: string): string | null {
  if (!firstLine.startsWith("#!")) return null;
  const rest = firstLine.slice(2).trim();
  if (!rest) return null;
  const parts = rest.split(/\s+/);
  // #!/usr/bin/env [-S] bash -e — the env form names the interpreter as a word
  if (parts[0] === "env" || parts[0] === "/usr/bin/env") {
    return parts[1] && parts[1] !== "-S" ? basename(parts[1]) : parts[2] ? basename(parts[2]) : null;
  }
  // #!/bin/bash, #!/usr/bin/bash, #! bash — the direct form
  return basename(parts[0]);
}

interface InterpreterChoice {
  command: string[];
  /**
   * Extension for the runner-owned temp file. Derived from the interpreter,
   * never from the original script path: bun routes files by extension and
   * sends anything ending .sh to its own partial bash parser regardless of
   * shebang, so a node-shebang .sh hook would still be parsed as bash.
   */
  tempExt: string;
}

/**
 * Pick the interpreter for the verified bytes.
 *
 * A recognized shebang wins over the extension: the script declares its own
 * interpreter and the runner honors it. Without a shebang, the extension
 * decides — .sh/.bash run under /bin/bash (bun's own parser is a partial bash
 * subset and rejects real bash like escaped-paren regexes), known JS/TS
 * extensions run under the runner's own bun binary (process.execPath —
 * resolved independently of the child env's PATH, so a per-hook PATH
 * override cannot break the spawn, and a sanitized PATH that drops the bun
 * dir cannot either), and anything else is refused loudly rather than
 * guessed.
 */
function interpreterFor(name: string, scriptPath: string, content: Buffer): InterpreterChoice {
  const ext = extensionOf(scriptPath);
  const firstLine = content.subarray(0, 512).toString("utf8").split("\n", 1)[0] ?? "";
  const interp = shebangInterpreter(firstLine);
  if (interp) {
    if (interp === "bash" || interp === "sh") return { command: ["/bin/bash"], tempExt: "sh" };
    if (interp === "node" || interp === "bun") return { command: [process.execPath, "run"], tempExt: BUN_EXTENSIONS.has(ext) ? ext : "ts" };
    throw new Error(
      `Refusing to run hook '${name}': shebang '${firstLine}' is not a recognized interpreter (supported: bash/sh, node/bun)`,
    );
  }
  if (BASH_EXTENSIONS.has(ext)) return { command: ["/bin/bash"], tempExt: "sh" };
  if (BUN_EXTENSIONS.has(ext)) return { command: [process.execPath, "run"], tempExt: ext };
  throw new Error(
    `Refusing to run hook '${name}': unsupported script extension '.${ext}' (supported: .sh .bash .ts .tsx .js .jsx .mjs .cjs .mts .cts, or a recognized shebang)`,
  );
}

/**
 * Read a subprocess pipe to EOF with a deadline. A hook that backgrounds a
 * child which inherits the pipe keeps it open forever; without the deadline
 * the run would hang (the orphaned child holds the write end). On deadline we
 * stop, cancel the reader and return what was collected — the caller then
 * kills the process group.
 */
async function readPipeWithDeadline(stream: ReadableStream<Uint8Array>, deadlineMs: number): Promise<string> {
  const reader = stream.getReader();
  const chunks: string[] = [];
  const deadline = Date.now() + deadlineMs;
  try {
    while (true) {
      const remaining = deadline - Date.now();
      if (remaining <= 0) break;
      let result: { done: boolean; value?: Uint8Array };
      try {
        result = await Promise.race([
          reader.read() as Promise<{ done: boolean; value?: Uint8Array }>,
          new Promise<never>((_, reject) => {
            const t = setTimeout(() => reject(new Error("pipe-drain-deadline")), remaining);
            (t as any).unref?.();
          }),
        ]);
      } catch {
        break;
      }
      if (result.done) break;
      chunks.push(new TextDecoder().decode(result.value));
    }
  } finally {
    try {
      await reader.cancel();
    } catch {
      // Reader already released.
    }
  }
  return chunks.join("");
}

export async function executeVerifiedScript(options: VerifiedRunOptions): Promise<VerifiedRunResult> {
  const scriptDir = dirname(options.scriptPath);
  const interpreter = interpreterFor(options.name, options.scriptPath, options.content);
  const tempPath = join(scriptDir, `.hooks-verified-${randomBytes(12).toString("hex")}.${interpreter.tempExt}`);
  let proc: Subprocess | null = null;
  let timedOut = false;
  const timeoutTimer = options.timeout
    ? setTimeout(() => {
        timedOut = true;
        // Kill the whole process group (detached spawn makes the child its
        // own group leader), so children of the hook cannot outlive it.
        killGroup(proc, { leaderAlive: proc !== null && proc.exitCode === null });
      }, options.timeout)
    : null;
  try {
    // "wx" refuses to overwrite; the name is unguessable, so a pre-existing
    // file with the same name is evidence of interference, not a collision.
    writeFileSync(tempPath, options.content, { flag: "wx", mode: 0o600 });
    proc = Bun.spawn([...interpreter.command, isAbsolute(tempPath) ? tempPath : `./${tempPath}`, ...(options.args ?? [])], {
      stdin: new Response(options.stdin),
      stdout: "pipe",
      stderr: "pipe",
      // P1-1 env isolation: the child never gets process.env wholesale. The
      // allowlist + name-based deny list + interpreter-injection strip
      // (cf99cf76: BASH_ENV/ENV/NODE_OPTIONS etc. can re-import credentials
      // from files through the interpreter) applies to the caller's extras
      // too, so a caller cannot reintroduce a credential-bearing name.
      env: buildHookEnv(process.env, options.env),
      // Detached spawn makes the child its own session/process-group leader,
      // so a timeout can kill the group (kill(-pid)) instead of leaving
      // grandchildren orphaned (bug 4d4c8f0b).
      detached: true,
    });
    const exitCode = await proc.exited;
    if (timedOut) {
      throw new HookTimeoutError(options.timeout!);
    }
    // Drain with a bounded grace period: a backgrounded child that inherited
    // the pipes would otherwise hold EOF forever. After the grace we kill the
    // group and keep whatever output arrived.
    const [stdoutText, stderrText] = await Promise.all([
      readPipeWithDeadline(proc.stdout as ReadableStream<Uint8Array>, 750),
      readPipeWithDeadline(proc.stderr as ReadableStream<Uint8Array>, 750),
    ]);
    // The leader is already reaped here — never signal its numeric pid again
    // (PID reuse would kill an unrelated process). Only surviving group
    // members are cleaned up.
    killGroup(proc, { leaderAlive: false });
    return { stdout: stdoutText, stderr: stderrText, exitCode };
  } finally {
    if (timeoutTimer) clearTimeout(timeoutTimer);
    try {
      rmSync(tempPath, { force: true });
    } catch {
      // Best-effort cleanup; the file is 0600 and holds only the verified
      // hook content.
    }
  }
}

/**
 * Kill every process in the hook's process group by positive pid.
 *
 * Negative-pid (process-group) kills are unreliable here on two counts:
 * Bun's process.kill() ignores them (measured: no error, no effect), and the
 * fleet's Landlock signal-scope domains block them silently even via the
 * system kill binary (measured: /usr/bin/kill -9 -pgid returns 0 and the
 * group survives). Same-domain positive-pid signaling works.
 *
 * The group is enumerated from /proc and re-enumerated to a fixed point,
 * because a one-shot snapshot races with members that fork between the
 * snapshot and their own kill (reviewer P1-1: 3 survivors from an 80-child
 * forking hook). The leader's numeric pid is only signaled while it is known
 * to be the live group leader (detached spawn makes pid == pgid), never after
 * the process has been reaped (reviewer P1-2: PID reuse would kill an
 * unrelated process).
 */
function killGroup(proc: Subprocess | null, options: { leaderAlive: boolean }): void {
  if (!proc) return;
  const pgid = proc.pid;
  for (let pass = 0; pass < 5; pass++) {
    let members: number[] = [];
    try {
      // Spawn ps directly — no shell, no PATH/parser indirection.
      const res = Bun.spawnSync(["ps", "-eo", "pid=,pgid="], { stdout: "pipe", stderr: "pipe" });
      if (res.exitCode === 0) {
        members = res.stdout
          .toString()
          .split("\n")
          .map((line) => line.trim().split(/\s+/))
          .filter((cols): cols is string[] => cols.length === 2 && cols[1] === String(pgid))
          .map((cols) => Number(cols[0]))
          .filter((pid) => Number.isInteger(pid) && pid > 1)
          // A reaped leader's numeric pid must never be signaled again: the
          // row could be a NEW process-group leader that reused the pid
          // (reviewer P1-2, second pass). While the leader is alive its pid
          // is its own identity (detached spawn: pid == pgid) and stays in
          // the member list.
          .filter((pid) => options.leaderAlive || pid !== proc.pid);
      }
    } catch {
      // Fall through.
    }
    if (members.length === 0) break;
    let killed = 0;
    for (const pid of members) {
      try {
        // Double-check the member still belongs to this group immediately
        // before signaling (membership may change between passes).
        const probe = Bun.spawnSync(["ps", "-o", "pid=,pgid=", "-p", String(pid)], { stdout: "pipe", stderr: "pipe" });
        const cols = probe.stdout.toString().trim().split(/\s+/);
        if (cols.length === 2 && cols[1] === String(pgid)) {
          process.kill(pid, "SIGKILL");
          killed++;
        }
      } catch {
        // Already exited.
      }
    }
    if (killed === 0) break; // nothing left to kill; avoid a spin
  }
  if (options.leaderAlive) {
    try {
      process.kill(proc.pid, "SIGKILL");
    } catch {
      // Already exited.
    }
  }
}
