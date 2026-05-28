// ─── TUI-specific MCP tools ──────────────────────────────────────────────────
// Terminal UI testing tools — interact with, observe, assert, and record TUI apps.

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z, json, err, resolveSessionId, getSessionPage } from "./helpers.js";
import { getTerminalState, isTuiHealthy, reconnectTui, waitForTerminalText, type TuiSession } from "../engines/tui.js";
import { getSessionEngine, getSessionTuiSession } from "../lib/session.js";
import { stopTuiRecording, trackTuiRecording } from "../lib/tui-recording.js";

// ─── Configurable defaults ───────────────────────────────────────────────────
const DEFAULT_TOOL_TIMEOUT_MS = 15_000;
const RECONNECT_ON_STUCK = true;

// ─── Key mapping ─────────────────────────────────────────────────────────────

const KEY_MAP: Record<string, string> = {
  "ctrl+c": "\x03", "ctrl+d": "\x04", "ctrl+z": "\x1a",
  "ctrl+l": "\x0c", "ctrl+a": "\x01", "ctrl+e": "\x05",
  "ctrl+k": "\x0b", "ctrl+u": "\x15", "ctrl+w": "\x17",
  "ctrl+r": "\x12", "ctrl+p": "\x10", "ctrl+n": "\x0e",
  enter: "Enter", tab: "Tab", escape: "Escape", esc: "Escape",
  backspace: "Backspace", delete: "Delete", space: " ",
  up: "ArrowUp", down: "ArrowDown", left: "ArrowLeft", right: "ArrowRight",
  arrow_up: "ArrowUp", arrow_down: "ArrowDown",
  arrow_left: "ArrowLeft", arrow_right: "ArrowRight",
  home: "Home", end: "End", page_up: "PageUp", page_down: "PageDown",
  f1: "F1", f2: "F2", f3: "F3", f4: "F4", f5: "F5", f6: "F6",
  f7: "F7", f8: "F8", f9: "F9", f10: "F10", f11: "F11", f12: "F12",
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

function assertTuiSession(sessionId: string) {
  const engine = getSessionEngine(sessionId);
  if (engine !== "tui") {
    throw new Error(`browser_tui_* tools require a TUI session (engine="tui"), but session uses engine="${engine}". Create one with: browser_session_create(engine="tui", start_url="your-command")`);
  }
}

function getTuiSession(sessionId: string): TuiSession {
  const session = getSessionTuiSession(sessionId);
  if (!session) {
    throw new Error(`TUI session handle missing for session ${sessionId}. Close and re-open with engine="tui".`);
  }
  return session;
}

function getTuiMeta(sessionId: string) {
  const session = getTuiSession(sessionId);
  return {
    method: session.method,
    reconnected: session.reconnectCount > 0,
  };
}

function withMeta<T extends Record<string, unknown>>(sessionId: string, data: T): T & { method: TuiSession["method"]; reconnected: boolean } {
  return { ...data, ...getTuiMeta(sessionId) };
}

function withStableMeta<T extends Record<string, unknown>>(sessionId: string, data: T): T & { stuck: false; method: TuiSession["method"]; reconnected: boolean } {
  return { ...data, stuck: false, ...getTuiMeta(sessionId) };
}

function filterRows(rows: string[], startRow?: number, endRow?: number) {
  const start = startRow ?? 0;
  const end = endRow ?? rows.length;
  const filtered = rows.slice(start, end);
  return {
    text: filtered.join("\n").trimEnd(),
    rows: filtered,
  };
}

// ─── In-memory recording state ───────────────────────────────────────────────

interface TuiRecording {
  sessionId: string;
  startTime: number;
  cols: number;
  rows: number;
  events: Array<[number, string, string]>;
  intervalId: ReturnType<typeof setInterval>;
  lastText: string;
}

const activeRecordings = new Map<string, TuiRecording>();

// ─── Health-check wrapper ─────────────────────────────────────────────────────

async function withTuiHealth<T>(
  sessionId: string,
  operation: (page: any, session: TuiSession) => Promise<T>,
  options: {
    timeoutMs?: number;
    reconnectOnStuck?: boolean;
    operationName?: string;
  } = {}
): Promise<T & { stuck?: boolean; reconnected?: boolean }> {
  const {
    timeoutMs = DEFAULT_TOOL_TIMEOUT_MS,
    reconnectOnStuck = RECONNECT_ON_STUCK,
    operationName = "operation",
  } = options;

  let session = getTuiSession(sessionId);
  let page = getSessionPage(sessionId);

  const health = await isTuiHealthy(session);
  if (!health.healthy && reconnectOnStuck && session.reconnectCount < 2) {
    try {
      const { getSessionCommand, setSessionTui } = await import("../lib/session.js");
      const cmd = getSessionCommand?.(sessionId) ?? "bash";
      const newSession = await reconnectTui(session, cmd, { method: session.method });
      setSessionTui(sessionId, newSession);
      session = newSession;
      page = newSession.page;
    } catch {
      // Let the operation fail naturally with the stale page if reconnect couldn't recover.
    }
  } else if (!health.healthy) {
    throw Object.assign(
      new Error(`TUI session is unhealthy: ${health.reason}. Close and reopen the session.`),
      { code: "TUI_UNHEALTHY" },
    );
  }

  let timer: ReturnType<typeof setTimeout>;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      const err2 = new Error(`${operationName} timed out after ${timeoutMs}ms — ttyd/playwright connection may be unhealthy. Status: ${health.healthy ? "was healthy before op" : "was already unhealthy"}. Try closing and re-opening the session.`);
      Object.assign(err2, { code: "TUI_TIMEOUT" });
      reject(err2);
    }, timeoutMs);
  });
  try {
    return await Promise.race([
      operation(page, session) as Promise<T & { stuck?: boolean; reconnected?: boolean }>,
      timeout,
    ]);
  } finally {
    clearTimeout(timer!);
  }
}

// ─── Registration ────────────────────────────────────────────────────────────

export function register(server: McpServer) {

// ── browser_tui_send_keys ────────────────────────────────────────────────────

server.tool(
  "browser_tui_send_keys",
  `Send keystrokes to a TUI terminal session. Use friendly key names.

SUPPORTED KEYS:
- Control: ctrl+c, ctrl+d, ctrl+z, ctrl+l, ctrl+a, ctrl+e, ctrl+k, ctrl+u, ctrl+w, ctrl+r
- Navigation: enter, tab, escape, backspace, delete, space
- Arrows: up, down, left, right (or arrow_up, arrow_down, arrow_left, arrow_right)
- Function: f1-f12
- Position: home, end, page_up, page_down

Pass multiple keys as a comma-separated string: "tab,tab,enter" or "ctrl+c"
For typing text, use browser_tui_send_text instead.`,
  {
    session_id: z.string().optional(),
    keys: z.string().describe("Comma-separated key names: 'enter', 'ctrl+c', 'tab,tab,enter', 'arrow_down,arrow_down,enter'"),
    timeout_ms: z.number().optional().default(15000).describe("Hard timeout in ms (default: 15000)"),
  },
  async ({ session_id, keys, timeout_ms }) => {
    try {
      const sid = resolveSessionId(session_id);
      assertTuiSession(sid);

      const result = await withTuiHealth(sid, async (page) => {
        const keyList = keys.split(",").map((k) => k.trim().toLowerCase());
        const sent: string[] = [];
        for (const key of keyList) {
          const mapped = KEY_MAP[key];
          if (mapped) {
            if (mapped.length === 1 && mapped.charCodeAt(0) < 32) {
              await page.keyboard.insertText(mapped);
            } else {
              await page.keyboard.press(mapped);
            }
            sent.push(key);
          } else {
            await page.keyboard.press(key);
            sent.push(key);
          }
        }
        return { sent, count: sent.length };
      }, { timeoutMs: timeout_ms, operationName: "browser_tui_send_keys" });

      return json(withStableMeta(sid, result));
    } catch (e) {
      if ((e as any).code === "TUI_TIMEOUT") return err(e);
      if ((e as any).code === "TUI_UNHEALTHY") return err(e);
      return err(e);
    }
  }
);

// ── browser_tui_send_text ────────────────────────────────────────────────────

server.tool(
  "browser_tui_send_text",
  `Type text into a TUI terminal and optionally press Enter. This is the most common way to interact with terminal apps.`,
  {
    session_id: z.string().optional(),
    text: z.string().describe("Text to type into the terminal"),
    press_enter: z.boolean().optional().default(true).describe("Press Enter after typing (default: true)"),
    timeout_ms: z.number().optional().default(15000).describe("Hard timeout in ms (default: 15000)"),
  },
  async ({ session_id, text, press_enter, timeout_ms }) => {
    try {
      const sid = resolveSessionId(session_id);
      assertTuiSession(sid);

      const result = await withTuiHealth(sid, async (page) => {
        const textarea = await page.$(".xterm-helper-textarea");
        if (textarea) {
          await textarea.type(text);
        } else {
          await page.keyboard.type(text);
        }
        if (press_enter) await page.keyboard.press("Enter");
        return { typed: text, pressed_enter: press_enter };
      }, { timeoutMs: timeout_ms, operationName: "browser_tui_send_text" });

      return json(withStableMeta(sid, result));
    } catch (e) {
      if ((e as any).code === "TUI_TIMEOUT") return err(e);
      if ((e as any).code === "TUI_UNHEALTHY") return err(e);
      return err(e);
    }
  }
);

// ── browser_tui_resize ───────────────────────────────────────────────────────

server.tool(
  "browser_tui_resize",
  "Resize the terminal to a specific number of columns and rows.",
  {
    session_id: z.string().optional(),
    cols: z.number().describe("Number of columns (e.g. 80, 120, 200)"),
    rows: z.number().describe("Number of rows (e.g. 24, 40, 50)"),
    timeout_ms: z.number().optional().default(15000).describe("Hard timeout in ms (default: 15000)"),
  },
  async ({ session_id, cols, rows, timeout_ms }) => {
    try {
      const sid = resolveSessionId(session_id);
      assertTuiSession(sid);

      const result = await withTuiHealth(sid, async (page) => {
        return page.evaluate((args: any) => {
          const [c, r] = args;
          const term = (window as any).term ?? (window as any).terminal;
          if (!term) return { resized: false, error: "No terminal instance found" };
          term.resize(c, r);
          return { resized: true, cols: c, rows: r };
        }, [cols, rows]);
      }, { timeoutMs: timeout_ms, operationName: "browser_tui_resize" });

      return json(withMeta(sid, result));
    } catch (e) {
      if ((e as any).code === "TUI_TIMEOUT" || (e as any).code === "TUI_UNHEALTHY") return err(e);
      return err(e);
    }
  }
);

// ── browser_tui_get_text ─────────────────────────────────────────────────────

server.tool(
  "browser_tui_get_text",
  `Get the text content from the terminal buffer. Returns all visible text, or a specific row range.`,
  {
    session_id: z.string().optional(),
    start_row: z.number().optional().describe("First row to read (0-indexed, default: 0)"),
    end_row: z.number().optional().describe("Last row (exclusive). Omit for all rows."),
    timeout_ms: z.number().optional().default(15000).describe("Hard timeout in ms (default: 15000)"),
  },
  async ({ session_id, start_row, end_row, timeout_ms }) => {
    try {
      const sid = resolveSessionId(session_id);
      assertTuiSession(sid);

      const result = await withTuiHealth(sid, async (page, session) => {
        const state = await getTerminalState(page, session.method, timeout_ms);
        const filtered = filterRows(state.rows, start_row, end_row);
        return {
          ...filtered,
          row_count: state.row_count,
        };
      }, { timeoutMs: timeout_ms, operationName: "browser_tui_get_text" });

      return json(withMeta(sid, result));
    } catch (e) {
      if ((e as any).code === "TUI_TIMEOUT") return err(e);
      if ((e as any).code === "TUI_UNHEALTHY") return err(e);
      return err(e);
    }
  }
);

// ── browser_tui_wait_for_text ────────────────────────────────────────────────

server.tool(
  "browser_tui_wait_for_text",
  `Wait for specific text to appear in the terminal output. Polls until found or timeout.
  Returns stuck:true if the terminal became unresponsive during the wait.`,
  {
    session_id: z.string().optional(),
    text: z.string().describe("Text to wait for (substring match)"),
    timeout_ms: z.number().optional().default(30000).describe("Timeout in milliseconds (default: 30000)"),
  },
  async ({ session_id, text, timeout_ms }) => {
    try {
      const sid = resolveSessionId(session_id);
      assertTuiSession(sid);

      const result = await withTuiHealth(sid, async (page, session) => {
        return waitForTerminalText(page, text, timeout_ms, session.method);
      }, { timeoutMs: timeout_ms + 5_000, operationName: "browser_tui_wait_for_text" });

      return json(withMeta(sid, result));
    } catch (e) {
      if ((e as any).code === "TUI_TIMEOUT") return err(e);
      if ((e as any).code === "TUI_UNHEALTHY") return err(e);
      return err(e);
    }
  }
);

// ── browser_tui_get_cursor ───────────────────────────────────────────────────

server.tool(
  "browser_tui_get_cursor",
  "Get the current cursor position (row and column) in the terminal.",
  {
    session_id: z.string().optional(),
    timeout_ms: z.number().optional().default(15000).describe("Hard timeout in ms (default: 15000)"),
  },
  async ({ session_id, timeout_ms }) => {
    try {
      const sid = resolveSessionId(session_id);
      assertTuiSession(sid);

      const result = await withTuiHealth(sid, async (page, session) => {
        const state = await getTerminalState(page, session.method, timeout_ms);
        if (state.cursor_row < 0 || state.cursor_col < 0) return null;
        return { row: state.cursor_row, col: state.cursor_col };
      }, { timeoutMs: timeout_ms, operationName: "browser_tui_get_cursor" });

      if (!result) return err(new Error("Could not read cursor — no terminal instance"));
      return json(withStableMeta(sid, result));
    } catch (e) {
      if ((e as any).code === "TUI_TIMEOUT" || (e as any).code === "TUI_UNHEALTHY") return err(e);
      return err(e);
    }
  }
);

// ── browser_tui_assert ───────────────────────────────────────────────────────

server.tool(
  "browser_tui_assert",
  `Assert conditions on the terminal state. Chain multiple conditions with AND.

CONDITION SYNTAX:
- "text contains X"        — terminal buffer contains substring X
- "row N contains X"       — row N (0-indexed) contains substring X
- "cursor at R,C"          — cursor is at row R, column C
- "row_count > N"          — total rows greater than N
- "row_count == N"         — total rows equals N`,
  {
    session_id: z.string().optional(),
    condition: z.string().describe("Assertion condition(s), joined with AND"),
    timeout_ms: z.number().optional().default(15000).describe("Hard timeout in ms (default: 15000)"),
  },
  async ({ session_id, condition, timeout_ms }) => {
    try {
      const sid = resolveSessionId(session_id);
      assertTuiSession(sid);

      const result = await withTuiHealth(sid, async (page, session) => {
        const state = await getTerminalState(page, session.method, timeout_ms);
        const termText = state.text;
        const cursor = { row: state.cursor_row, col: state.cursor_col };
        const checks: Array<{ assertion: string; result: boolean }> = [];
        let allPassed = true;

        for (const part of condition.split(/\s+AND\s+/i)) {
          const trimmed = part.trim();
          let passed = false;

          if (/^text\s+contains\s+/i.test(trimmed)) {
            const needle = trimmed.replace(/^text\s+contains\s+/i, "").replace(/^["']|["']$/g, "");
            passed = termText.includes(needle);
          } else if (/^row\s+(\d+)\s+contains\s+/i.test(trimmed)) {
            const match = trimmed.match(/^row\s+(\d+)\s+contains\s+(.+)/i);
            if (match) {
              const rowIdx = parseInt(match[1]);
              const needle = match[2].replace(/^["']|["']$/g, "");
              passed = (state.rows[rowIdx] ?? "").includes(needle);
            }
          } else if (/^cursor\s+at\s+(\d+)\s*,\s*(\d+)/i.test(trimmed)) {
            const match = trimmed.match(/^cursor\s+at\s+(\d+)\s*,\s*(\d+)/i);
            if (match) passed = cursor.row === parseInt(match[1]) && cursor.col === parseInt(match[2]);
          } else if (/^row_count\s*(>|>=|<|<=|==|!=)\s*(\d+)/i.test(trimmed)) {
            const match = trimmed.match(/^row_count\s*(>|>=|<|<=|==|!=)\s*(\d+)/i);
            if (match) {
              const op = match[1];
              const n = parseInt(match[2]);
              const cnt = state.row_count;
              passed = op === ">" ? cnt > n
                : op === ">=" ? cnt >= n
                : op === "<" ? cnt < n
                : op === "<=" ? cnt <= n
                : op === "==" ? cnt === n
                : cnt !== n;
            }
          }

          checks.push({ assertion: trimmed, result: passed });
          if (!passed) allPassed = false;
        }

        return { passed: allPassed, checks, cursor, row_count: state.row_count };
      }, { timeoutMs: timeout_ms, operationName: "browser_tui_assert" });

      return json(withMeta(sid, result));
    } catch (e) {
      if ((e as any).code === "TUI_TIMEOUT" || (e as any).code === "TUI_UNHEALTHY") return err(e);
      return err(e);
    }
  }
);

// ── browser_tui_snapshot ─────────────────────────────────────────────────────

server.tool(
  "browser_tui_snapshot",
  "Capture a structured snapshot of the terminal buffer: all rows, row refs, cursor position, dimensions, and theme.",
  {
    session_id: z.string().optional(),
    timeout_ms: z.number().optional().default(15000).describe("Hard timeout in ms (default: 15000)"),
  },
  async ({ session_id, timeout_ms }) => {
    try {
      const sid = resolveSessionId(session_id);
      assertTuiSession(sid);

      const result = await withTuiHealth(sid, async (page, session) => {
        const state = await getTerminalState(page, session.method, timeout_ms);
        return {
          rows: state.rows,
          refs: state.refs,
          cols: state.cols,
          total_rows: state.total_rows,
          buffer_length: state.buffer_length,
          cursor_row: state.cursor_row,
          cursor_col: state.cursor_col,
          font_size: state.font_size,
          theme: state.theme,
        };
      }, { timeoutMs: timeout_ms, operationName: "browser_tui_snapshot" });

      return json(withStableMeta(sid, result));
    } catch (e) {
      if ((e as any).code === "TUI_TIMEOUT" || (e as any).code === "TUI_UNHEALTHY") return err(e);
      return err(e);
    }
  }
);

// ── browser_tui_record_start ─────────────────────────────────────────────────

server.tool(
  "browser_tui_record_start",
  "Start recording the terminal session as an asciicast v2 file.",
  {
    session_id: z.string().optional(),
    interval_ms: z.number().optional().default(500).describe("Polling interval in ms (default: 500)"),
  },
  async ({ session_id, interval_ms }) => {
    try {
      const sid = resolveSessionId(session_id);
      assertTuiSession(sid);

      if (activeRecordings.has(sid)) {
        return err(new Error("Recording already active for this session. Stop it first with browser_tui_record_stop."));
      }

      const page = getSessionPage(sid);
      const session = getTuiSession(sid);
      const initialState = await getTerminalState(page, session.method);
      const dims = { cols: initialState.cols ?? 80, rows: initialState.total_rows || initialState.row_count || 24 };

      const recording: TuiRecording = {
        sessionId: sid,
        startTime: Date.now(),
        cols: dims.cols,
        rows: dims.rows,
        events: [],
        lastText: initialState.text,
        intervalId: setInterval(async () => {
          try {
            const currentPage = getSessionPage(sid);
            const currentSession = getTuiSession(sid);
            const state = await getTerminalState(currentPage, currentSession.method);
            if (state.text !== recording.lastText) {
              const elapsed = (Date.now() - recording.startTime) / 1000;
              recording.events.push([elapsed, "o", state.text.slice(recording.lastText.length) || state.text]);
              recording.lastText = state.text;
            }
          } catch {
            // Ignore polling errors while recording; stop path remains explicit.
          }
        }, interval_ms),
      };

      activeRecordings.set(sid, recording);
      trackTuiRecording(sid, recording.intervalId);
      return json({
        recording: true,
        session_id: sid,
        interval_ms,
        cols: dims.cols,
        rows: dims.rows,
        method: session.method,
      });
    } catch (e) { return err(e); }
  }
);

// ── browser_tui_record_stop ──────────────────────────────────────────────────

server.tool(
  "browser_tui_record_stop",
  "Stop recording and return the asciicast v2 JSON.",
  { session_id: z.string().optional() },
  async ({ session_id }) => {
    try {
      const sid = resolveSessionId(session_id);
      const recording = activeRecordings.get(sid);
      if (!recording) return err(new Error("No active recording for this session"));

      clearInterval(recording.intervalId);
      stopTuiRecording(sid);
      activeRecordings.delete(sid);

      const duration = (Date.now() - recording.startTime) / 1000;
      const header = {
        version: 2,
        width: recording.cols,
        height: recording.rows,
        timestamp: Math.floor(recording.startTime / 1000),
        duration,
        env: { TERM: "xterm-256color", SHELL: "/bin/bash" },
      };

      const lines = [JSON.stringify(header)];
      for (const [time, type, data] of recording.events) lines.push(JSON.stringify([time, type, data]));
      const asciicast = lines.join("\n");

      return json({
        format: "asciicast_v2",
        duration_seconds: Math.round(duration * 10) / 10,
        event_count: recording.events.length,
        asciicast,
        method: getTuiSession(sid).method,
      });
    } catch (e) { return err(e); }
  }
);

// ── browser_tui_health ───────────────────────────────────────────────────────

server.tool(
  "browser_tui_health",
  `Health check for a TUI session. Returns healthy status, latency, reconnect count, and the active read method.
  Use this to verify a session is still responsive before running other tools.`,
  { session_id: z.string().optional() },
  async ({ session_id }) => {
    try {
      const sid = resolveSessionId(session_id);
      assertTuiSession(sid);
      const session = getTuiSession(sid);
      const health = await isTuiHealthy(session);
      return json({
        healthy: health.healthy,
        latency_ms: health.healthy ? (health as any).latency_ms : null,
        reason: health.healthy ? null : (health as any).reason,
        reconnect_count: session.reconnectCount,
        method: session.method,
      });
    } catch (e) { return err(e); }
  }
);

} // end register
