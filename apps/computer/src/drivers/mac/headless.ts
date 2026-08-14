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

import { existsSync } from "fs";

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
  const proc = Bun.spawn(
    ["system_profiler", "SPDisplaysDataType", "-detailLevel", "mini"],
    { stdout: "pipe", stderr: "pipe" }
  );
  await proc.exited;
  const stdout = await new Response(proc.stdout).text();
  // If there are displays, we'll see "Resolution:" lines
  return stdout.includes("Resolution:");
}

/**
 * Check if macOS Screen Sharing (VNC) is enabled.
 */
export async function isScreenSharingEnabled(): Promise<boolean> {
  const proc = Bun.spawn(
    ["launchctl", "print", "system/com.apple.screensharing"],
    { stdout: "pipe", stderr: "pipe" }
  );
  await proc.exited;
  return proc.exitCode === 0;
}

/**
 * Check if Lume CLI is installed (trycua/cua).
 */
export async function isLumeInstalled(): Promise<boolean> {
  const proc = Bun.spawn(["which", "lume"], { stdout: "pipe", stderr: "pipe" });
  await proc.exited;
  return proc.exitCode === 0;
}

/**
 * Start a Lume VM for headless computer use.
 * Returns the VNC address to connect to.
 */
export async function startLumeVm(vmName: string = "computer-headless"): Promise<string> {
  // Check if VM exists
  const list = Bun.spawn(["lume", "list"], { stdout: "pipe", stderr: "pipe" });
  await list.exited;
  const stdout = await new Response(list.stdout).text();

  if (!stdout.includes(vmName)) {
    // Create VM
    const create = Bun.spawn(
      ["lume", "create", vmName, "--os", "macos", "--no-display"],
      { stdout: "pipe", stderr: "pipe" }
    );
    await create.exited;
    if (create.exitCode !== 0) {
      const err = await new Response(create.stderr).text();
      throw new Error(`Failed to create Lume VM: ${err}`);
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
  if (display) {
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
