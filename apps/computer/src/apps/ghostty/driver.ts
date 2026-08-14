// Ghostty app driver — deterministic window/tab/pane orchestration via the
// Ghostty AppleScript dictionary (Ghostty 1.3+, macOS only).

import { existsSync } from "node:fs";
import type { AppAvailability, AppDriver, AppOpenSpec, AppOpenResult, PaneGrid } from "../types.js";
import { assignPaneCommands, buildGhosttyScript } from "./applescript.js";

const APP_BUNDLE = "/Applications/Ghostty.app";

export interface GhosttyEnvironment {
  platform?: NodeJS.Platform | string;
  hasAppBundle?: boolean;
  hasBinary?: boolean;
}

/** Availability check, injectable for tests. */
export function ghosttyAvailability(env: GhosttyEnvironment = {}): AppAvailability {
  const platform = env.platform ?? process.platform;
  if (platform !== "darwin") {
    return { available: false, reason: "Ghostty orchestration requires macOS (AppleScript)" };
  }
  const hasAppBundle = env.hasAppBundle ?? existsSync(APP_BUNDLE);
  const hasBinary = env.hasBinary ?? Bun.which("ghostty") !== null;
  if (!hasAppBundle && !hasBinary) {
    return { available: false, reason: `Ghostty not found (${APP_BUNDLE} missing and no \`ghostty\` on PATH)` };
  }
  return { available: true };
}

/** Run an AppleScript via osascript, capturing stderr for error reporting. */
async function runOsascript(script: string): Promise<{ ok: boolean; stderr: string }> {
  const proc = Bun.spawn(["osascript", "-e", script], {
    stdout: "pipe",
    stderr: "pipe",
  });
  const code = await proc.exited;
  const stderr = await new Response(proc.stderr).text();
  return { ok: code === 0, stderr: stderr.trim() };
}

/** Normalize an AppOpenSpec into one grid per tab. */
function resolveTabs(spec: AppOpenSpec): PaneGrid[] {
  if (spec.tabs && spec.tabs.length > 0) return spec.tabs;
  return [spec.grid ?? { rows: 1, cols: 1 }];
}

export const ghosttyDriver: AppDriver = {
  name: "ghostty",
  description: "Ghostty terminal — windows with pane grids, tabs, and a command per pane",

  available(): AppAvailability {
    return ghosttyAvailability();
  },

  async open(spec: AppOpenSpec): Promise<AppOpenResult> {
    const availability = ghosttyAvailability();
    if (!availability.available) {
      return { ok: false, message: availability.reason ?? "Ghostty is not available" };
    }

    const tabs = resolveTabs(spec);
    const totalPanes = tabs.reduce((sum, g) => sum + g.rows * g.cols, 0);

    let commands: (string | undefined)[];
    try {
      commands = assignPaneCommands(totalPanes, spec.run ?? [], spec.all ?? false);
    } catch (err) {
      return { ok: false, message: err instanceof Error ? err.message : String(err) };
    }

    const script = buildGhosttyScript({
      tabs,
      commands,
      dir: spec.dir,
      max: spec.max,
    });

    const result = await runOsascript(script);
    if (!result.ok) {
      return {
        ok: false,
        message: `osascript failed: ${result.stderr || "unknown error"}`,
        panes: totalPanes,
        tabs: tabs.length,
      };
    }

    const tabDesc = tabs.map((g) => `${g.rows}x${g.cols}`).join(",");
    return {
      ok: true,
      message: `Opened Ghostty: ${tabs.length} tab${tabs.length === 1 ? "" : "s"} (${tabDesc}), ${totalPanes} pane${totalPanes === 1 ? "" : "s"}`,
      panes: totalPanes,
      tabs: tabs.length,
    };
  },
};
