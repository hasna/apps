import { join, dirname } from "path";
import { existsSync } from "fs";
import { fileURLToPath } from "url";
import { getHomeDir } from "../../lib/home.js";
import type { DriverAction, ActionResult, Screenshot } from "../../types/index.js";
import { captureScreenshot } from "./screenshot.js";

/**
 * Execute a mouse/keyboard action using cliclick + Swift helpers on macOS.
 */
export async function executeAction(action: DriverAction): Promise<ActionResult> {
  const start = Date.now();

  try {
    switch (action.type) {
      case "screenshot": {
        const screenshot = await captureScreenshot();
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

        await runCliclick(cmd);
        // Small delay to let the UI react
        await sleep(100);
        const screenshot = await captureScreenshot();
        return { success: true, screenshot, duration_ms: Date.now() - start };
      }

      case "type": {
        // Use cliclick for typing — handles special chars
        // Escape colons in the text for cliclick
        const escaped = action.text.replace(/:/g, "\\:");
        await runCliclick(`t:${escaped}`);
        await sleep(50);
        const screenshot = await captureScreenshot();
        return { success: true, screenshot, duration_ms: Date.now() - start };
      }

      case "key": {
        // Map common key names to cliclick key press format
        const mapped = mapKeys(action.keys);
        await runCliclick(`kp:${mapped}`);
        await sleep(50);
        const screenshot = await captureScreenshot();
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
        await runShell(...args);
        await sleep(100);
        const screenshot = await captureScreenshot();
        return { success: true, screenshot, duration_ms: Date.now() - start };
      }

      case "mouse_move": {
        await runCliclick(`m:${action.point.x},${action.point.y}`);
        const screenshot = await captureScreenshot();
        return { success: true, screenshot, duration_ms: Date.now() - start };
      }

      case "drag": {
        await runCliclick(
          `dd:${action.from.x},${action.from.y}`,
          `du:${action.to.x},${action.to.y}`
        );
        await sleep(100);
        const screenshot = await captureScreenshot();
        return { success: true, screenshot, duration_ms: Date.now() - start };
      }

      case "wait": {
        await sleep(action.ms);
        const screenshot = await captureScreenshot();
        return { success: true, screenshot, duration_ms: Date.now() - start };
      }

      case "open_url": {
        await runShell("open", action.url);
        await sleep(1000); // Give browser time to load
        const screenshot = await captureScreenshot();
        return { success: true, screenshot, duration_ms: Date.now() - start };
      }

      case "open_app": {
        await runShell("open", "-a", action.name);
        await sleep(500);
        const screenshot = await captureScreenshot();
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
async function runCliclick(...args: string[]): Promise<void> {
  const proc = Bun.spawn(["cliclick", ...args], {
    stdout: "pipe",
    stderr: "pipe",
  });
  await proc.exited;
  if (proc.exitCode !== 0) {
    const stderr = await new Response(proc.stderr).text();
    throw new Error(`cliclick failed: ${stderr}`);
  }
}

/** Run an arbitrary shell command */
async function runShell(...cmd: string[]): Promise<string> {
  const proc = Bun.spawn(cmd, {
    stdout: "pipe",
    stderr: "pipe",
  });
  await proc.exited;
  if (proc.exitCode !== 0) {
    const stderr = await new Response(proc.stderr).text();
    throw new Error(`${cmd[0]} failed: ${stderr}`);
  }
  return new Response(proc.stdout).text();
}

/** Run osascript */
async function runOsascript(script: string): Promise<string> {
  return runShell("osascript", "-e", script);
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

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Resolve path to the compiled Swift scroll helper binary */
let _scrollHelperPath: string | null = null;
function getScrollHelperPath(): string {
  if (_scrollHelperPath) return _scrollHelperPath;

  // Check multiple locations: helpers/ relative to this file, or in package
  const candidates = [
    // Development: helpers/ in project root
    join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "helpers", "scroll"),
    // Installed: helpers/ relative to dist/
    join(dirname(fileURLToPath(import.meta.url)), "..", "helpers", "scroll"),
    // Global install
    join(getHomeDir(), ".hasna", "computer", "helpers", "scroll"),
  ];

  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      _scrollHelperPath = candidate;
      return candidate;
    }
  }

  throw new Error(
    "Scroll helper not found. Run `swiftc helpers/scroll.swift -o helpers/scroll` from the project root."
  );
}
