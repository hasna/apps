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

// Integrations
export { runPostSessionIntegrations, saveToRecordings, registerWithSessions, pushToLogs } from "./lib/integrations.js";

// Agents
export { registerAgent, heartbeat, setFocus, getAgent, listAgents } from "./db/agents.js";
export type { Agent } from "./db/agents.js";

// Safety
export { checkAction, resetRateLimiter } from "./agent/safety.js";
export type { SafetyCheckResult } from "./agent/safety.js";

// Config
export { loadConfig, saveConfig, getConfigValue, setConfigValue, getConfigPath, DEFAULT_CONFIG } from "./lib/config.js";
export type { ComputerConfig } from "./lib/config.js";

// Pricing
export { calculateCost, formatCost, stepCost, listPricing } from "./lib/pricing.js";

// Utilities
export { scaleScreenshot, getScaledSize, RECOMMENDED_WIDTHS } from "./lib/scale.js";
export { screenshotsMatch, computeScreenHash, compareHashes } from "./lib/diff.js";
export { renderInlineImage, supportsInlineImages, detectProtocol } from "./lib/terminal-image.js";
export type { TerminalProtocol } from "./lib/terminal-image.js";

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
  searchSessions,
  searchActionLogs,
} from "./db/index.js";
