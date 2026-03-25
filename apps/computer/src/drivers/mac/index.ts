import type { ComputerDriver, DriverAction, ActionResult, ScreenSize, Screenshot } from "../../types/index.js";
import { captureScreenshot, getScreenSize } from "./screenshot.js";
import { executeAction } from "./input.js";

/**
 * macOS computer driver — uses screencapture + cliclick for native screen control.
 * Requires: macOS, cliclick (brew install cliclick), Accessibility permissions.
 */
export class MacDriver implements ComputerDriver {
  private displayNumber?: number;

  constructor(opts?: { displayNumber?: number }) {
    this.displayNumber = opts?.displayNumber;
  }

  async getScreenSize(): Promise<ScreenSize> {
    return getScreenSize();
  }

  async screenshot(): Promise<Screenshot> {
    return captureScreenshot(this.displayNumber);
  }

  async execute(action: DriverAction): Promise<ActionResult> {
    return executeAction(action);
  }

  async dispose(): Promise<void> {
    // No resources to clean up for the native driver
  }
}

/** Create a macOS driver */
export function createMacDriver(opts?: { displayNumber?: number }): ComputerDriver {
  return new MacDriver(opts);
}
