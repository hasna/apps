// Pure AppleScript generation for the Ghostty driver.
//
// Everything in this file is side-effect free and unit-testable without
// macOS UI. Execution lives in driver.ts.
//
// Verified against Ghostty 1.3.1's AppleScript dictionary:
//   - `new window` is a command (NOT `make new window`)
//   - `focused terminal of selected tab of w` / `focused terminal of <tabRef>`
//   - `split <terminal> direction right|left|up|down` returns the new terminal
//   - `input text "cmd" to t` pastes via bracketed paste — a trailing newline
//     does NOT submit, so every command MUST be followed by
//     `send key "enter" to t`
//   - `perform action "equalize_splits" on t` — once per tab after its grid
//   - `perform action "toggle_maximize" on t` — maximize (not fullscreen),
//     applied once right after `new window`
//   - `tab` is an AppleScript reserved word — tab variables are named tbN

import type { PaneGrid } from "../types.js";

/** Parse "RxC" (e.g. "2x2", "3x1") into a PaneGrid. Throws on invalid input. */
export function parseGrid(spec: string): PaneGrid {
  const m = /^(\d+)x(\d+)$/.exec(spec.trim());
  if (!m) throw new Error(`Invalid grid spec "${spec}" — expected RxC (e.g. 2x2, 3x1)`);
  const rows = parseInt(m[1], 10);
  const cols = parseInt(m[2], 10);
  if (rows < 1 || cols < 1) {
    throw new Error(`Invalid grid spec "${spec}" — rows and cols must be >= 1`);
  }
  return { rows, cols };
}

/** Parse a comma-separated tabs spec like "2x2,1x2,1x2" into one grid per tab. */
export function parseTabsSpec(spec: string): PaneGrid[] {
  const parts = spec.split(",");
  if (parts.length === 0 || spec.trim() === "") {
    throw new Error(`Invalid tabs spec "${spec}" — expected comma-separated grids (e.g. "2x2,1x2")`);
  }
  return parts.map((p) => parseGrid(p));
}

/** Escape a string for embedding inside an AppleScript double-quoted literal. */
export function escapeAppleScript(s: string): string {
  return s.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

/** Single-quote a string for POSIX shells (used for `cd <dir>`). */
export function shellQuote(s: string): string {
  return `'${s.replace(/'/g, `'\\''`)}'`;
}

/**
 * Map run commands onto panes (row-major across tabs in order).
 * - `all` fills every pane with the single command (requires exactly one).
 * - Otherwise commands are assigned in order; extra panes get undefined.
 * Throws when there are more commands than panes.
 */
export function assignPaneCommands(
  totalPanes: number,
  run: string[],
  all: boolean
): (string | undefined)[] {
  if (all) {
    if (run.length !== 1) {
      throw new Error(`--all requires exactly one --run command (got ${run.length})`);
    }
    return Array.from({ length: totalPanes }, () => run[0]);
  }
  if (run.length > totalPanes) {
    throw new Error(`Got ${run.length} commands for ${totalPanes} pane${totalPanes === 1 ? "" : "s"} — add panes or drop commands`);
  }
  return Array.from({ length: totalPanes }, (_, i) => run[i]);
}

export interface GhosttyScriptOptions {
  /** One grid per tab; the first tab reuses the new window's selected tab. */
  tabs: PaneGrid[];
  /** Command per pane, row-major across tabs in order. undefined = empty shell. */
  commands?: (string | undefined)[];
  /** Working directory — every pane cds here before its command. */
  dir?: string;
  /** Maximize the new window (toggle_maximize, not native fullscreen). */
  max?: boolean;
  /** Optional transcript capture targets keyed by pane index. */
  transcript?: GhosttyTranscriptPlan;
}

export interface GhosttyTranscriptTarget {
  paneIndex: number;
  marker: string;
  logPath: string;
  statusPath: string;
}

export interface GhosttyTranscriptPlan {
  id: string;
  panes: GhosttyTranscriptTarget[];
}

/**
 * Build the full AppleScript for opening one Ghostty window with the given
 * tabs/grids/commands. Pure — returns the script string.
 *
 * Grid algorithm (per tab): build column 0 downward (split direction down
 * from the previous row), then split each row rightward C-1 times, then
 * equalize once. Commands inject row-major with `input text` + enter key.
 */
export function buildGhosttyScript(opts: GhosttyScriptOptions): string {
  const { tabs, commands = [], dir, max = false } = opts;
  if (tabs.length === 0) throw new Error("At least one tab grid is required");
  const transcriptByPane = new Map(
    opts.transcript?.panes.map((pane) => [pane.paneIndex, pane]) ?? []
  );

  const lines: string[] = [];
  lines.push('tell application "Ghostty"');
  lines.push("  activate");
  lines.push("  set w to new window");

  // Terminal variables are t<tab>_<row>_<col>; tab refs are tb<N> (never
  // `tab` — reserved word in AppleScript).
  const term = (t: number, r: number, c: number) => `t${t}_${r}_${c}`;

  let paneIndex = 0;

  for (let t = 0; t < tabs.length; t++) {
    const { rows, cols } = tabs[t];

    if (t === 0) {
      lines.push(`  set ${term(0, 0, 0)} to focused terminal of selected tab of w`);
      if (max) {
        lines.push(`  perform action "toggle_maximize" on ${term(0, 0, 0)}`);
      }
    } else {
      lines.push(`  set tb${t} to new tab in w`);
      lines.push(`  set ${term(t, 0, 0)} to focused terminal of tb${t}`);
    }

    // Column 0 down the left edge.
    for (let r = 1; r < rows; r++) {
      lines.push(`  set ${term(t, r, 0)} to split ${term(t, r - 1, 0)} direction down`);
    }
    // Each row's columns to the right.
    for (let r = 0; r < rows; r++) {
      for (let c = 1; c < cols; c++) {
        lines.push(`  set ${term(t, r, c)} to split ${term(t, r, c - 1)} direction right`);
      }
    }

    // Even out all panes (only meaningful with more than one).
    if (rows * cols > 1) {
      lines.push(`  perform action "equalize_splits" on ${term(t, 0, 0)}`);
    }

    // Inject commands row-major. `input text` pastes without submitting, so
    // each command is followed by an enter key press.
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const raw = commands[paneIndex];
        paneIndex++;
        let cmd: string | undefined;
        const transcriptTarget = (raw || dir) ? transcriptByPane.get(paneIndex - 1) : undefined;
        if (raw && transcriptTarget) cmd = wrapCommandForTranscript(raw, dir, transcriptTarget);
        else if (dir && transcriptTarget) cmd = wrapCommandForTranscript(":", dir, transcriptTarget);
        else if (dir && raw) cmd = `cd ${shellQuote(dir)} && ${raw}`;
        else if (dir) cmd = `cd ${shellQuote(dir)}`;
        else cmd = raw;
        if (cmd) {
          lines.push(`  input text "${escapeAppleScript(cmd)}" to ${term(t, r, c)}`);
          lines.push(`  send key "enter" to ${term(t, r, c)}`);
        }
      }
    }
  }

  lines.push(`  focus ${term(0, 0, 0)}`);
  lines.push("end tell");
  return lines.join("\n") + "\n";
}

export function wrapCommandForTranscript(
  rawCommand: string,
  dir: string | undefined,
  target: GhosttyTranscriptTarget,
): string {
  const statusFile = shellQuote(target.statusPath);
  const logFile = shellQuote(target.logPath);
  const marker = shellQuote(target.marker);
  const pane = shellQuote(String(target.paneIndex));
  const restoreDir = dir ? `cd ${shellQuote(dir)};` : "";
  const command = dir
    ? `(cd ${shellQuote(dir)} && { ${rawCommand}; })`
    : `({ ${rawCommand}; })`;

  return [
    `__occtrl_status_file=${statusFile};`,
    "{",
    `printf '%s\\n' ${shellQuote(`[occtrl:${target.marker}:begin pane=${target.paneIndex}]`)};`,
    command + ";",
    "__occtrl_status=$?;",
    `printf '[occtrl:%s:end pane=%s status=%s]\\n' ${marker} ${pane} \"$__occtrl_status\";`,
    `printf '%s\\n' \"$__occtrl_status\" > \"$__occtrl_status_file\";`,
    "}",
    `2>&1 | tee -a ${logFile};`,
    `__occtrl_status="$(cat "$__occtrl_status_file" 2>/dev/null || echo 1)";`,
    restoreDir,
    `if [ "$__occtrl_status" -eq 0 ]; then true; else false; fi`,
  ].join(" ");
}
