/**
 * Identity resolution for MCP tools.
 *
 * The MCP server is one long-lived daemon under a single HOME, so
 * register_agent/heartbeat deliberately no longer write the installation-wide
 * agent-id file — see setSessionAgent() in ./channel.ts. That alone would leave
 * implicit attribution with nowhere to go: every MCP tool resolved through
 * lib/identity's resolveIdentity(), which falls through to the machine identity
 * and, on a box that has none, invents a random name from the pool and persists
 * it as the machine identity. The default author would then be a name belonging
 * to no agent at all.
 *
 * So MCP tools resolve through here. The agent named by the most recent
 * register_agent/heartbeat is this connection's implicit author — the same
 * attribution the daemon had before machine-identity writes were removed, but
 * held in memory instead of stamped onto the whole box.
 *
 * Priority: explicit `from` → CONVERSATIONS_AGENT_ID → this MCP session's agent
 * → machine identity. The env var stays above the session so an operator-pinned
 * identity is never quietly displaced by a tool call.
 */

import { resolveIdentity as resolveInstallationIdentity } from "../lib/identity.js";
import { getSessionAgent } from "./channel.js";

export function resolveIdentity(explicit?: string): string {
  const explicitValue = explicit?.trim();
  if (explicitValue) return explicitValue;

  const envValue = process.env.CONVERSATIONS_AGENT_ID?.trim();
  if (envValue) return envValue;

  const sessionAgent = getSessionAgent()?.trim();
  if (sessionAgent) return sessionAgent;

  return resolveInstallationIdentity();
}
