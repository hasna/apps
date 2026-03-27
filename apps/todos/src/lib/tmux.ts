import type { TmuxTarget } from "../types/index.ts";

export const DELAY_MIN = 3000;
export const DELAY_MAX = 5000;

/**
 * Parse a tmux target spec into its components.
 * Accepts: "window", "session:window", "session:window.pane"
 */
export function parseTmuxTarget(spec: string): TmuxTarget {
  if (!spec || spec.trim() === "") {
    throw new Error("tmux target spec cannot be empty");
  }
  const raw = spec.trim();

  // Split session from the rest on ":"
  const colonIdx = raw.indexOf(":");
  let session: string | null = null;
  let windowPane: string;

  if (colonIdx !== -1) {
    session = raw.slice(0, colonIdx) || null;
    windowPane = raw.slice(colonIdx + 1);
  } else {
    windowPane = raw;
  }

  if (!windowPane) {
    throw new Error(`Invalid tmux target: "${spec}" — window part is missing`);
  }

  // Split window from pane on "."
  const dotIdx = windowPane.indexOf(".");
  let window: string;
  let pane: string | null = null;

  if (dotIdx !== -1) {
    window = windowPane.slice(0, dotIdx);
    pane = windowPane.slice(dotIdx + 1) || null;
  } else {
    window = windowPane;
  }

  if (!window) {
    throw new Error(`Invalid tmux target: "${spec}" — window name is empty`);
  }

  return { session, window, pane, raw };
}

/**
 * Build the canonical tmux target string from a TmuxTarget.
 */
export function formatTmuxTarget(target: TmuxTarget): string {
  let s = target.session ? `${target.session}:` : "";
  s += target.window;
  if (target.pane) s += `.${target.pane}`;
  return s;
}

/**
 * Validate a tmux target by running `tmux list-panes -t <target>`.
 * Throws if tmux is not installed or the target doesn't exist.
 */
export async function validateTmuxTarget(spec: string): Promise<void> {
  const target = parseTmuxTarget(spec);
  const targetStr = formatTmuxTarget(target);

  let proc: ReturnType<typeof Bun.spawn>;
  try {
    proc = Bun.spawn(["tmux", "list-panes", "-t", targetStr], {
      stdout: "pipe",
      stderr: "pipe",
    });
  } catch {
    throw new Error("tmux is not installed or not in PATH");
  }

  const exitCode = await proc.exited;
  if (exitCode !== 0) {
    const stderr = await new Response(proc.stderr as any).text();
    throw new Error(
      `tmux target "${targetStr}" not found: ${stderr.trim() || "unknown error"}`,
    );
  }
}

/**
 * Auto-calculate delay in ms based on message length.
 * Range: DELAY_MIN (3s) to DELAY_MAX (5s), scaling linearly.
 */
export function calculateDelay(message: string): number {
  const len = message.length;
  // 40ms per 100 chars, capped at DELAY_MAX
  const extra = Math.floor((len / 100) * 40);
  return Math.min(DELAY_MIN + extra, DELAY_MAX);
}

/**
 * Send a message to a tmux window/pane, wait delayMs, then send Enter.
 * Set dryRun=true to log instead of executing.
 */
export async function sendToTmux(
  target: string,
  message: string,
  delayMs: number,
  dryRun = false,
): Promise<void> {
  if (dryRun) {
    console.log(`[dry-run] sendToTmux target=${target} delay=${delayMs}ms`);
    console.log(`[dry-run] message: ${message.slice(0, 200)}`);
    return;
  }

  // Step 1: send the message text (no Enter yet)
  const sendProc = Bun.spawn(["tmux", "send-keys", "-t", target, message, ""], {
    stdout: "pipe",
    stderr: "pipe",
  });
  const sendExit = await sendProc.exited;
  if (sendExit !== 0) {
    const stderr = await new Response(sendProc.stderr).text();
    throw new Error(`tmux send-keys failed for target "${target}": ${stderr.trim()}`);
  }

  // Step 2: wait
  await Bun.sleep(delayMs);

  // Step 3: send Enter
  const enterProc = Bun.spawn(["tmux", "send-keys", "-t", target, "", "Enter"], {
    stdout: "pipe",
    stderr: "pipe",
  });
  const enterExit = await enterProc.exited;
  if (enterExit !== 0) {
    const stderr = await new Response(enterProc.stderr).text();
    throw new Error(`tmux send-keys Enter failed for target "${target}": ${stderr.trim()}`);
  }
}
