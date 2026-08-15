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
 * extensions run under bun, and anything else is refused loudly rather than
 * guessed.
 */
function interpreterFor(name: string, scriptPath: string, content: Buffer): InterpreterChoice {
  const ext = extensionOf(scriptPath);
  const firstLine = content.subarray(0, 512).toString("utf8").split("\n", 1)[0] ?? "";
  const interp = shebangInterpreter(firstLine);
  if (interp) {
    if (interp === "bash" || interp === "sh") return { command: ["/bin/bash"], tempExt: "sh" };
    if (interp === "node" || interp === "bun") return { command: ["bun", "run"], tempExt: BUN_EXTENSIONS.has(ext) ? ext : "ts" };
    throw new Error(
      `Refusing to run hook '${name}': shebang '${firstLine}' is not a recognized interpreter (supported: bash/sh, node/bun)`,
    );
  }
  if (BASH_EXTENSIONS.has(ext)) return { command: ["/bin/bash"], tempExt: "sh" };
  if (BUN_EXTENSIONS.has(ext)) return { command: ["bun", "run"], tempExt: ext };
  throw new Error(
    `Refusing to run hook '${name}': unsupported script extension '.${ext}' (supported: .sh .bash .ts .tsx .js .jsx .mjs .cjs .mts .cts, or a recognized shebang)`,
  );
}

export async function executeVerifiedScript(options: VerifiedRunOptions): Promise<VerifiedRunResult> {
  const scriptDir = dirname(options.scriptPath);
  const interpreter = interpreterFor(options.name, options.scriptPath, options.content);
  const tempPath = join(scriptDir, `.hooks-verified-${randomBytes(12).toString("hex")}.${interpreter.tempExt}`);
  try {
    // "wx" refuses to overwrite; the name is unguessable, so a pre-existing
    // file with the same name is evidence of interference, not a collision.
    writeFileSync(tempPath, options.content, { flag: "wx", mode: 0o600 });
    const proc = Bun.spawn([...interpreter.command, isAbsolute(tempPath) ? tempPath : `./${tempPath}`, ...(options.args ?? [])], {
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
