/**
 * @hasna/computer — Open-source computer use for AI agents
 *
 * Control your Mac with Anthropic or OpenAI.
 * CLI + MCP server + REST API + SDK.
 */

// Types
export type {
  Provider,
  MouseButton,
  Point,
  ScreenSize,
  Screenshot,
  DriverAction,
  ActionResult,
  ComputerDriver,
  ModelResponse,
  ComputerProvider,
  SessionStatus,
  ActionLog,
  Session,
  RunOptions,
  SafetyConfig,
} from "./types/index.js";

// Agent
export { runTask } from "./agent/loop.js";

// Drivers
export { createMacDriver, MacDriver } from "./drivers/mac/index.js";
export { captureScreenshot, getScreenSize, saveScreenshotToFile } from "./drivers/mac/screenshot.js";
export { executeAction } from "./drivers/mac/input.js";

// Providers
export { createProvider, createAnthropicProvider, createOpenAIProvider } from "./providers/index.js";

// Database
export {
  getDb,
  createSession,
  updateSession,
  logAction,
  getSession,
  listSessions,
  getActionLogs,
  deleteSession,
  getStats,
} from "./db/index.js";
