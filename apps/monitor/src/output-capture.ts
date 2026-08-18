/**
 * Safe output spool for slug runs.
 *
 * Process stdout and stderr are captured into mode-600 temporary files, never
 * into unbounded in-memory strings. Each stream is size-bounded: once a stream
 * exceeds its cap, capture stops writing but keeps draining the pipe so the
 * child never blocks on a full pipe. Commands are spawned with a structured
 * argv array (no shell strings, no interpolation).
 *
 * The spooled files are the input for `buildStreamEvidence`/`buildRunEvidence`
 * in `output-evidence.ts`; the raw spool files themselves are never written to
 * run receipts.
 */

import { spawn } from "node:child_process";
import { closeSync, existsSync, mkdtempSync, openSync, rmSync, writeSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

export interface CapturedStream {
  kind: "stdout" | "stderr";
  /** Absolute path of the mode-600 spool file holding the bounded bytes. */
  path: string;
  /** Total bytes observed on the stream (may exceed the written cap). */
  bytes: number;
  /** True when the stream exceeded its maxBytes cap. */
  truncated: boolean;
}

export interface CaptureOptions {
  /** Kill the process tree after this many milliseconds. 0/undefined = no timeout. */
  timeoutMs?: number;
  /** Per-stream byte cap for stdout. 0/undefined = unbounded. */
  maxStdoutBytes?: number;
  /** Per-stream byte cap for stderr. 0/undefined = unbounded. */
  maxStderrBytes?: number;
  cwd?: string;
  env?: Record<string, string>;
  /** Spool directory; defaults to a fresh tmpdir under the system temp root. */
  spoolDir?: string;
}

export interface CaptureResult {
  exitCode: number | null;
  timedOut: boolean;
  stdout: CapturedStream;
  stderr: CapturedStream;
  durationMs: number;
  /** Present when the spawn failed or the run timed out; absent on a clean exit. */
  error?: string;
}

interface StreamSink {
  kind: "stdout" | "stderr";
  fd: number;
  path: string;
  written: number;
  observed: number;
  truncated: boolean;
  cap: number;
}

function makeSpoolDir(provided?: string): string {
  if (provided) {
    if (!existsSync(provided)) throw new Error(`spoolDir does not exist: ${provided}`);
    return provided;
  }
  return mkdtempSync(join(tmpdir(), "monitor-spool-"));
}

function openSpoolFile(spoolDir: string, kind: "stdout" | "stderr", cap: number): StreamSink {
  const path = join(spoolDir, `${kind}.spool`);
  // Mode 600: captured process output is private to the monitor process.
  const fd = openSync(path, "w", 0o600);
  return { kind, fd, path, written: 0, observed: 0, truncated: false, cap };
}

function drain(sink: StreamSink, chunk: Buffer): void {
  sink.observed += chunk.length;
  const unbounded = sink.cap === 0;
  if (unbounded || sink.written < sink.cap) {
    const remaining = unbounded ? chunk.length : sink.cap - sink.written;
    const toWrite = Math.min(chunk.length, remaining);
    writeSync(sink.fd, chunk.subarray(0, toWrite));
    sink.written += toWrite;
  }
  if (sink.cap > 0 && sink.observed > sink.cap) {
    sink.truncated = true;
  }
}

function closeSink(sink: StreamSink): void {
  try {
    closeSync(sink.fd);
  } catch {
    // Already closed or never opened; spool cleanup is best-effort.
  }
}

function finalizeSink(sink: StreamSink): CapturedStream {
  return {
    kind: sink.kind,
    path: sink.path,
    bytes: sink.observed,
    truncated: sink.truncated,
  };
}

/**
 * Delete the spool files produced by a capture. Call this once the bounded
 * evidence has been built from the streams; the capture itself keeps the
 * files so `buildStreamEvidence`/`buildRunEvidence` can read them.
 */
export function removeCaptureSpool(result: Pick<CaptureResult, "stdout" | "stderr">): void {
  const dirs = new Set<string>();
  for (const stream of [result.stdout, result.stderr]) {
    try {
      rmSync(stream.path, { force: true });
      dirs.add(dirname(stream.path));
    } catch {
      // Best-effort cleanup.
    }
  }
  for (const dir of dirs) {
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      // Best-effort cleanup.
    }
  }
}

/**
 * Spawn `executable` with a structured argv array and spool both output
 * streams to bounded mode-600 files. Never invokes a shell.
 */
export async function captureCommandOutput(
  executable: string,
  args: readonly string[],
  options: CaptureOptions = {}
): Promise<CaptureResult> {
  const startedAt = Date.now();
  const spoolDir = makeSpoolDir(options.spoolDir);
  const stdoutSink = openSpoolFile(spoolDir, "stdout", options.maxStdoutBytes ?? 0);
  const stderrSink = openSpoolFile(spoolDir, "stderr", options.maxStderrBytes ?? 0);

  // Spool files are deliberately NOT deleted here: the evidence builder reads
  // them after capture. The caller removes them with removeCaptureSpool() once
  // the bounded evidence has been built.
  const closeStreams = (): void => {
    closeSink(stdoutSink);
    closeSink(stderrSink);
  };

  const child = spawn(executable, [...args], {
    shell: false,
    cwd: options.cwd,
    env: options.env ? { ...process.env, ...options.env } : process.env,
    detached: true,
    stdio: ["ignore", "pipe", "pipe"],
  });

  return await new Promise<CaptureResult>((resolve) => {
    let timedOut = false;
    let settled = false;
    let timeout: ReturnType<typeof setTimeout> | undefined;

    const finish = (result: CaptureResult): void => {
      if (settled) return;
      settled = true;
      if (timeout) clearTimeout(timeout);
      closeStreams();
      resolve(result);
    };

    const killChildTree = (signal: NodeJS.Signals): void => {
      if (!child.pid) {
        child.kill(signal);
        return;
      }
      try {
        process.kill(-child.pid, signal);
      } catch {
        child.kill(signal);
      }
    };

    if (options.timeoutMs && options.timeoutMs > 0) {
      timeout = setTimeout(() => {
        timedOut = true;
        killChildTree("SIGKILL");
      }, options.timeoutMs);
    }

    child.stdout.on("data", (chunk: Buffer) => drain(stdoutSink, chunk));
    child.stderr.on("data", (chunk: Buffer) => drain(stderrSink, chunk));

    child.once("error", (error) => {
      finish({
        exitCode: null,
        timedOut,
        stdout: finalizeSink(stdoutSink),
        stderr: finalizeSink(stderrSink),
        durationMs: Date.now() - startedAt,
        error: String(error),
      });
    });

    child.once("close", (exitCode) => {
      finish({
        exitCode: timedOut ? null : exitCode,
        timedOut,
        stdout: finalizeSink(stdoutSink),
        stderr: finalizeSink(stderrSink),
        durationMs: Date.now() - startedAt,
        error: timedOut
          ? `Command timed out after ${options.timeoutMs}ms`
          : undefined,
      });
    });
  });
}
