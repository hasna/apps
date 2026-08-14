/**
 * Browser session tracking using @hasna/browser's session DB.
 *
 * Registers each browser session in open-browser's shared session store so that:
 * - Sessions are visible to the browser-mcp server
 * - Multiple agents can see and coordinate around active browser sessions
 * - Session metadata (run_id, scenario) is attached for debugging
 */

import { dbCreateSession, dbCloseSession } from "@hasna/browser";
import type { BrowserEngine } from "../types/index.js";

// Maps local result IDs to open-browser session IDs
const activeSessions = new Map<string, string>();

/**
 * Register a new browser session in open-browser's session DB.
 * Returns the session ID, which can be used to look up network logs.
 */
export function registerSession(options: {
  resultId: string;
  runId: string;
  scenarioId: string;
  engine: BrowserEngine;
  startUrl: string;
}): string | null {
  try {
    const session = dbCreateSession({
      engine: options.engine === "cdp" ? "playwright" : (options.engine as "playwright" | "lightpanda" | "bun"),
      startUrl: options.startUrl,
      name: `testers-run:${options.runId.slice(0, 8)}-sc:${options.scenarioId.slice(0, 8)}`,
      agentId: process.env["AGENT_ID"] ?? "testers",
    });
    activeSessions.set(options.resultId, session.id);
    return session.id;
  } catch {
    return null;
  }
}

/**
 * Mark a session as closed in open-browser's session DB.
 */
export function closeSession(resultId: string): void {
  const sessionId = activeSessions.get(resultId);
  if (!sessionId) return;
  try {
    dbCloseSession(sessionId);
  } catch {
    // Non-fatal
  } finally {
    activeSessions.delete(resultId);
  }
}

/**
 * Get the open-browser session ID for a result, if one was registered.
 */
export function getSessionId(resultId: string): string | undefined {
  return activeSessions.get(resultId);
}
