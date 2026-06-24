import type { DriverAction, ActionResult, DriverExecutionContext, Screenshot } from "../../types/index.js";
import { captureScreenshot } from "./screenshot.js";
import { resolveMacHelper } from "./helpers.js";
import { formatAbortSignalReason, formatMacProcessFailure, runMacProcess } from "./process.js";

/**
 * Execute a mouse/keyboard action using cliclick + Swift helpers on macOS.
 */
export async function executeAction(
  action: DriverAction,
  context: DriverExecutionContext = {},
): Promise<ActionResult> {
  const start = Date.now();

  try {
    throwIfAborted(context.signal);
    switch (action.type) {
      case "screenshot": {
        const screenshot = await captureScreenshot(undefined, context);
        return { success: true, screenshot, duration_ms: Date.now() - start };
      }

      case "click": {
        const btn = action.button ?? "left";
        const count = action.count ?? 1;
        let cmd: string;

        if (btn === "right") {
          cmd = `rc:${action.point.x},${action.point.y}`;
        } else if (count === 2) {
          cmd = `dc:${action.point.x},${action.point.y}`;
        } else if (count === 3) {
          cmd = `tc:${action.point.x},${action.point.y}`;
        } else {
          cmd = `c:${action.point.x},${action.point.y}`;
        }

        await runCliclick(cmd, context);
        // Small delay to let the UI react
        await sleep(100, context.signal);
        const screenshot = await captureScreenshot(undefined, context);
        return { success: true, screenshot, duration_ms: Date.now() - start };
      }

      case "type": {
        // Use cliclick for typing — handles special chars
        // Escape colons in the text for cliclick
        const escaped = action.text.replace(/:/g, "\\:");
        await runCliclick(`t:${escaped}`, context);
        await sleep(50, context.signal);
        const screenshot = await captureScreenshot(undefined, context);
        return { success: true, screenshot, duration_ms: Date.now() - start };
      }

      case "key": {
        // Map common key names to cliclick key press format
        const mapped = mapKeys(action.keys);
        await runCliclick(`kp:${mapped}`, context);
        await sleep(50, context.signal);
        const screenshot = await captureScreenshot(undefined, context);
        return { success: true, screenshot, duration_ms: Date.now() - start };
      }

      case "scroll": {
        // Use compiled Swift CGEvent helper for native scroll wheel events
        const scrollHelperPath = getScrollHelperPath();
        const args = [
          scrollHelperPath,
          String(action.point.x),
          String(action.point.y),
          String(action.deltaY),
        ];
        if (action.deltaX !== 0) {
          args.push(String(action.deltaX));
        }
        await runShell(args, context);
        await sleep(100, context.signal);
        const screenshot = await captureScreenshot(undefined, context);
        return { success: true, screenshot, duration_ms: Date.now() - start };
      }

      case "mouse_move": {
        await runCliclick(`m:${action.point.x},${action.point.y}`, context);
        const screenshot = await captureScreenshot(undefined, context);
        return { success: true, screenshot, duration_ms: Date.now() - start };
      }

      case "drag": {
        await runCliclick(
          `dd:${action.from.x},${action.from.y}`,
          `du:${action.to.x},${action.to.y}`,
          context,
        );
        await sleep(100, context.signal);
        const screenshot = await captureScreenshot(undefined, context);
        return { success: true, screenshot, duration_ms: Date.now() - start };
      }

      case "wait": {
        await sleep(action.ms, context.signal);
        const screenshot = await captureScreenshot(undefined, context);
        return { success: true, screenshot, duration_ms: Date.now() - start };
      }

      case "open_url": {
        await runShell(["open", action.url], context);
        await sleep(1000, context.signal); // Give browser time to load
        const screenshot = await captureScreenshot(undefined, context);
        return { success: true, screenshot, duration_ms: Date.now() - start };
      }

      case "open_app": {
        await runShell(["open", "-a", action.name], context);
        await sleep(500, context.signal);
        const screenshot = await captureScreenshot(undefined, context);
        return { success: true, screenshot, duration_ms: Date.now() - start };
      }

      default:
        return {
          success: false,
          error: `Unknown action type: ${(action as any).type}`,
          duration_ms: Date.now() - start,
        };
    }
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : String(err),
      duration_ms: Date.now() - start,
    };
  }
}

/** Run cliclick with given arguments */
async function runCliclick(...argsAndMaybeContext: Array<string | DriverExecutionContext>): Promise<void> {
  const maybeContext = argsAndMaybeContext[argsAndMaybeContext.length - 1];
  const context = typeof maybeContext === "object" ? maybeContext : {};
  const args = (typeof maybeContext === "object" ? argsAndMaybeContext.slice(0, -1) : argsAndMaybeContext) as string[];
  const command = ["cliclick", ...args];
  const result = await runMacProcess(command, { signal: context.signal });
  if (result.exitCode !== 0) {
    throw new Error(formatMacProcessFailure(command, result));
  }
}

/** Run an arbitrary shell command */
async function runShell(cmd: string[], context: DriverExecutionContext = {}): Promise<string> {
  const result = await runMacProcess(cmd, { signal: context.signal });
  if (result.exitCode !== 0) {
    throw new Error(formatMacProcessFailure(cmd, result));
  }
  return result.stdout;
}

/** Run osascript */
async function runOsascript(script: string): Promise<string> {
  return runShell(["osascript", "-e", script]);
}

/** Map key names to cliclick format */
function mapKeys(keys: string): string {
  const keyMap: Record<string, string> = {
    enter: "return",
    return: "return",
    tab: "tab",
    escape: "escape",
    esc: "escape",
    space: "space",
    delete: "delete",
    backspace: "delete",
    up: "arrow-up",
    down: "arrow-down",
    left: "arrow-left",
    right: "arrow-right",
    home: "home",
    end: "end",
    pageup: "page-up",
    pagedown: "page-down",
    f1: "f1",
    f2: "f2",
    f3: "f3",
    f4: "f4",
    f5: "f5",
    f6: "f6",
    f7: "f7",
    f8: "f8",
    f9: "f9",
    f10: "f10",
    f11: "f11",
    f12: "f12",
  };

  // Handle modifier+key combos like "cmd+c", "ctrl+shift+a"
  const parts = keys.toLowerCase().split("+").map((k) => k.trim());
  const mapped = parts.map((p) => keyMap[p] ?? p);
  return mapped.join("+");
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) return Promise.reject(new Error(formatAbortSignalReason(signal)));
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", abort);
      resolve();
    }, ms);
    const abort = () => {
      clearTimeout(timer);
      reject(new Error(formatAbortSignalReason(signal)));
    };
    signal?.addEventListener("abort", abort, { once: true });
  });
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw new Error(formatAbortSignalReason(signal));
}

/** Resolve path to the compiled Swift scroll helper binary */
let _scrollHelperPath: string | null = null;
function getScrollHelperPath(): string {
  if (_scrollHelperPath) return _scrollHelperPath;
  _scrollHelperPath = resolveMacHelper("scroll");
  return _scrollHelperPath;
}
