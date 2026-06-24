import type { ComputerDriver, DriverAction, ActionResult, DriverExecutionContext, ScreenSize, Screenshot } from "../../types/index.js";
import { captureScreenshot, getScreenSize } from "./screenshot.js";
import { executeAction as executeRawAction } from "./input.js";
import { executeComputerAction } from "../../agent/policy.js";

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

  async execute(action: DriverAction, context: DriverExecutionContext = {}): Promise<ActionResult> {
    return executeComputerAction(action, {
      executor: executeRawAction,
      runtimeLease: false,
      transport: "driver",
      capability: `computer.${action.type}`,
      signal: context.signal,
    });
  }

  async dispose(): Promise<void> {
    // No resources to clean up for the native driver
  }
}

/** Create a macOS driver */
export function createMacDriver(opts?: { displayNumber?: number }): ComputerDriver {
  return new MacDriver(opts);
}
