/**
 * Headless mode support for macOS computer use.
 *
 * Three strategies (tried in order):
 * 1. Virtual display via macOS screen sharing (built-in VNC)
 * 2. Lume VM integration (if installed — trycua/cua)
 * 3. Fallback: error with instructions
 *
 * For most users, the practical headless approach is:
 * - Enable macOS Screen Sharing (System Settings > General > Sharing)
 * - The Mac creates a virtual display accessible via VNC
 * - `screencapture` works against this display
 * - Or use a headless Mac mini / Mac Studio with no monitor
 */

import { platform } from "os";
import { formatMacProcessFailure, runMacProcess } from "./process.js";

export interface HeadlessConfig {
  /** Strategy to use */
  strategy: "vnc" | "lume" | "auto";
  /** VNC host:port (default: localhost:5900) */
  vncAddress?: string;
  /** Lume VM name */
  lumeVmName?: string;
}

/**
 * Check if a display is available for screencapture.
 * Returns false if no display is attached (headless server).
 */
export async function hasDisplay(): Promise<boolean> {
  if (platform() !== "darwin") return false;

  try {
    const result = await runMacProcess(["system_profiler", "SPDisplaysDataType", "-detailLevel", "mini"]);
    if (result.exitCode !== 0) return false;
    // If there are displays, we'll see "Resolution:" lines
    return result.stdout.includes("Resolution:");
  } catch {
    return false;
  }
}

/**
 * Check if macOS Screen Sharing (VNC) is enabled.
 */
export async function isScreenSharingEnabled(): Promise<boolean> {
  if (platform() !== "darwin") return false;

  try {
    const result = await runMacProcess(["launchctl", "print", "system/com.apple.screensharing"]);
    return result.exitCode === 0;
  } catch {
    return false;
  }
}

/**
 * Check if Lume CLI is installed (trycua/cua).
 */
export async function isLumeInstalled(): Promise<boolean> {
  try {
    const result = await runMacProcess(["which", "lume"]);
    return result.exitCode === 0;
  } catch {
    return false;
  }
}

/**
 * Start a Lume VM for headless computer use.
 * Returns the VNC address to connect to.
 */
export async function startLumeVm(vmName: string = "computer-headless"): Promise<string> {
  // Check if VM exists
  const list = await runMacProcess(["lume", "list"]);
  if (list.exitCode !== 0) {
    throw new Error(`Failed to list Lume VMs: ${formatMacProcessFailure(["lume", "list"], list)}`);
  }

  if (!list.stdout.includes(vmName)) {
    // Create VM
    const create = await runMacProcess(["lume", "create", vmName, "--os", "macos", "--no-display"]);
    if (create.exitCode !== 0) {
      throw new Error(`Failed to create Lume VM: ${formatMacProcessFailure(["lume", "create", vmName, "--os", "macos", "--no-display"], create)}`);
    }
  }

  // Start VM headless
  const run = Bun.spawn(
    ["lume", "run", vmName, "--no-display"],
    { stdout: "pipe", stderr: "pipe" }
  );
  // Don't await — it runs in background

  // Wait for VNC to be available
  await new Promise((r) => setTimeout(r, 5000));

  return `localhost:5900`; // Lume default VNC port
}

/**
 * Get headless mode status and instructions.
 */
export async function getHeadlessStatus(): Promise<{
  display: boolean;
  screenSharing: boolean;
  lume: boolean;
  recommendation: string;
}> {
  const [display, screenSharing, lume] = await Promise.all([
    hasDisplay(),
    isScreenSharingEnabled(),
    isLumeInstalled(),
  ]);

  let recommendation: string;
  if (platform() !== "darwin") {
    recommendation =
      `Current platform is ${platform()}; this native headless driver is macOS-only. ` +
      "Use a macOS machine, a browser/fleet adapter, or add a Linux/Windows display driver.";
  } else if (display) {
    recommendation = "Display detected. Headless mode not needed — use normal mode.";
  } else if (screenSharing) {
    recommendation = "No display but Screen Sharing enabled. Connect via VNC to use computer use.";
  } else if (lume) {
    recommendation = "No display. Lume is installed — use --headless to spin up a macOS VM.";
  } else {
    recommendation =
      "No display detected. To use headless mode:\n" +
      "  1. Enable Screen Sharing: System Settings > General > Sharing > Screen Sharing\n" +
      "  2. Or install Lume: /bin/bash -c \"$(curl -fsSL https://raw.githubusercontent.com/trycua/cua/main/libs/lume/scripts/install.sh)\"\n" +
      "  3. Or connect a display/dummy HDMI adapter";
  }

  return { display, screenSharing, lume, recommendation };
}
