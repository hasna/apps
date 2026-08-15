import { chromium, type Browser, type Page } from "playwright";
import { spawn, type ChildProcess } from "child_process";
import { BrowserError } from "../types/index.js";

let lightpandaProcess: ChildProcess | null = null;

/**
 * Check if Lightpanda browser is installed (optional dependency).
 */
export function isLightpandaAvailable(): boolean {
  try {
    // Check if the binary exists via the npm package's known paths
    const possiblePaths = [
      // npm package installs binary here
      `${process.env["HOME"]}/.cache/lightpanda-node/lightpanda`,
      // Or via LIGHTPANDA_EXECUTABLE_PATH env
      process.env["LIGHTPANDA_EXECUTABLE_PATH"],
    ];

    for (const p of possiblePaths) {
      if (p) {
        try {
          const { existsSync } = require("fs");
          if (existsSync(p)) return true;
        } catch {
          continue;
        }
      }
    }

    // Try running the binary to check
    const { execSync } = require("child_process");
    execSync("lightpanda --version", { stdio: "ignore", timeout: 5000 });
    return true;
  } catch {
    return false;
  }
}

/**
 * Find the Lightpanda binary path.
 */
function findLightpandaBinary(): string {
  // 1. Environment variable
  const envPath = process.env["LIGHTPANDA_EXECUTABLE_PATH"];
  if (envPath) return envPath;

  // 2. Default cache location from npm package
  const cachePath = `${process.env["HOME"]}/.cache/lightpanda-node/lightpanda`;
  try {
    const { existsSync } = require("fs");
    if (existsSync(cachePath)) return cachePath;
  } catch {
    // continue
  }

  // 3. Global binary (if in PATH)
  return "lightpanda";
}

/**
 * Start Lightpanda as a CDP server on a random available port.
 * Returns the WebSocket endpoint URL.
 */
export async function startLightpandaServer(
  port?: number,
): Promise<{ process: ChildProcess; wsEndpoint: string }> {
  const binary = findLightpandaBinary();
  const cdpPort = port ?? 9222 + Math.floor(Math.random() * 1000);

  return new Promise((resolve, reject) => {
    const proc = spawn(binary, ["serve", "--port", String(cdpPort)], {
      stdio: ["ignore", "pipe", "pipe"],
    });

    let resolved = false;
    const timeout = setTimeout(() => {
      if (!resolved) {
        resolved = true;
        // Assume server started even if we didn't see the message
        resolve({
          process: proc,
          wsEndpoint: `ws://127.0.0.1:${cdpPort}`,
        });
      }
    }, 5000);

    proc.stdout?.on("data", (data: Buffer) => {
      const output = data.toString();
      // Lightpanda logs the CDP endpoint when ready
      if (output.includes("127.0.0.1") || output.includes("listening") || output.includes("DevTools")) {
        if (!resolved) {
          resolved = true;
          clearTimeout(timeout);
          resolve({
            process: proc,
            wsEndpoint: `ws://127.0.0.1:${cdpPort}`,
          });
        }
      }
    });

    proc.stderr?.on("data", (data: Buffer) => {
      const output = data.toString();
      if (output.includes("127.0.0.1") || output.includes("listening")) {
        if (!resolved) {
          resolved = true;
          clearTimeout(timeout);
          resolve({
            process: proc,
            wsEndpoint: `ws://127.0.0.1:${cdpPort}`,
          });
        }
      }
    });

    proc.on("error", (err) => {
      clearTimeout(timeout);
      if (!resolved) {
        resolved = true;
        reject(new BrowserError(
          `Failed to start Lightpanda: ${err.message}. ` +
          `Install it with: bun install @lightpanda/browser`
        ));
      }
    });

    proc.on("exit", (code) => {
      if (!resolved) {
        resolved = true;
        clearTimeout(timeout);
        reject(new BrowserError(
          `Lightpanda exited with code ${code}. ` +
          `Install it with: bun install @lightpanda/browser`
        ));
      }
    });
  });
}

/**
 * Launch a Lightpanda browser via CDP and return a Playwright Browser instance.
 */
export async function launchLightpanda(
  _options?: { viewport?: { width: number; height: number } },
): Promise<Browser> {
  try {
    const { process: proc, wsEndpoint } = await startLightpandaServer();
    lightpandaProcess = proc;

    // Connect Playwright to Lightpanda via CDP
    const browser = await chromium.connectOverCDP(wsEndpoint);
    return browser;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new BrowserError(`Failed to launch Lightpanda: ${message}`);
  }
}

/**
 * Create a page from a Lightpanda-connected browser.
 */
export async function getLightpandaPage(
  browser: Browser,
  options?: { viewport?: { width: number; height: number }; userAgent?: string; locale?: string },
): Promise<Page> {
  try {
    // Lightpanda via CDP — use existing contexts or create new
    const contexts = browser.contexts();
    const context = contexts.length > 0
      ? contexts[0]!
      : await browser.newContext({
          viewport: options?.viewport ?? { width: 1280, height: 720 },
          userAgent: options?.userAgent,
          locale: options?.locale,
        });

    const page = await context.newPage();
    return page;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new BrowserError(`Failed to create Lightpanda page: ${message}`);
  }
}

/**
 * Close a Lightpanda browser and kill the server process.
 */
export async function closeLightpanda(browser: Browser): Promise<void> {
  try {
    await browser.close();
  } catch {
    // May already be closed
  }

  if (lightpandaProcess) {
    try {
      lightpandaProcess.kill("SIGTERM");
      lightpandaProcess = null;
    } catch {
      // Process may already be dead
    }
  }
}

/**
 * Install Lightpanda browser.
 */
export async function installLightpanda(): Promise<void> {
  const { execSync } = require("child_process");
  try {
    execSync("bun install @lightpanda/browser", {
      stdio: "inherit",
      cwd: process.env["HOME"],
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new BrowserError(
      `Failed to install Lightpanda: ${message}\n` +
      `Try manually: bun install @lightpanda/browser`
    );
  }
}
