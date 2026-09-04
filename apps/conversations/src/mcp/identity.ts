/**
 * Identity resolution for MCP tools.
 *
 * register_agent/heartbeat deliberately no longer re-stamp the installation-wide
 * agent-id file on every call — see setSessionAgent() in ./channel.ts. That
 * alone would leave implicit attribution with nowhere to go: every MCP tool
 * resolved through lib/identity's resolveIdentity(), which falls through to the
 * machine identity and, on a box that has none, invents a random name from the
 * pool and persists it as the machine identity. The default author would then be
 * a name belonging to no agent at all — and `conversations-hook` and the CLI,
 * which resolve through that same file, would answer to it too.
 *
 * Two things replace it, and they are deliberately different mechanisms:
 *
 *   1. The agent named by the most recent register_agent/heartbeat is the
 *      implicit author *for that connection*. Held in memory, keyed by the
 *      McpServer that owns the connection, never written to disk.
 *   2. On a box with NO identity file at all, the first register_agent seeds it
 *      (see ./tools/agents.ts). Seed-if-absent, not last-writer-wins: an
 *      identity that already exists is never overwritten. This is what keeps the
 *      MCP session, the CLI, and the blocker hook naming the same agent on a
 *      fresh install instead of splitting into two identities.
 *
 * Priority: explicit `from` → CONVERSATIONS_AGENT_ID → this connection's agent
 * → machine identity. The env var stays above the connection so an
 * operator-pinned identity is never quietly displaced by a tool call.
 *
 * On the default Streamable HTTP transport the connection rung is inert by
 * construction: ./http.ts builds a fresh server per request with
 * `sessionIdGenerator: undefined`, so there is no session to remember and
 * resolution falls straight through to the env var and then the machine
 * identity. Agents sharing one HTTP daemon must pass `from` explicitly (or run
 * their own process with CONVERSATIONS_AGENT_ID set) — the alternative,
 * remembering "the last agent that registered" process-wide, attributes one
 * agent's messages to another.
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { resolveIdentity as resolveInstallationIdentity } from "../lib/identity.js";
import { env } from "../lib/env.js";
import { getSessionAgent } from "./channel.js";

/**
 * Build the identity resolver for one MCP connection.
 *
 * Tool modules call this once, in their register function, so every handler
 * closes over the server it was registered on. A module-level resolver cannot
 * do this: it has no way to tell which of the daemon's connections is calling.
 */
export function identityFor(server: McpServer): (explicit?: string) => string {
  return function resolveIdentity(explicit?: string): string {
    const explicitValue = explicit?.trim();
    if (explicitValue) return explicitValue;

    const envValue = env.agentId()?.trim();
    if (envValue) return envValue;

    const sessionAgent = getSessionAgent(server)?.trim();
    if (sessionAgent) return sessionAgent;

    return resolveInstallationIdentity();
  };
}
