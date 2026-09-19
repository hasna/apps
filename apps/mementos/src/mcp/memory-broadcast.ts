/**
 * Memory broadcast utility — notifies active agents when shared memories are saved.
 * Conversations authority and credentials resolve through @hasna/contracts.
 * Non-blocking: notification failures never fail the memory write.
 */

import type { Memory } from "../types/index.js";
import {
  conversationsRequest,
  type ConversationsTransportOptions,
} from "../lib/conversations-transport.js";

/** Broadcast a newly saved shared memory to the other active project agents. */
export async function broadcastSharedMemory(
  memory: Memory,
  savingAgentId: string,
  transport: ConversationsTransportOptions = {},
): Promise<void> {
  if (!memory.project_id) return;

  try {
    const query = new URLSearchParams({
      online_only: "true",
      project_id: memory.project_id,
    });
    const listRes = await conversationsRequest(`/agents?${query}`, {
      signal: AbortSignal.timeout(3000),
    }, transport);
    if (!listRes.ok) return;

    const { agents } = await listRes.json() as { agents?: Array<{ id: string; name: string }> };
    const otherAgents = (agents ?? []).filter((agent) => agent.id !== savingAgentId);
    if (otherAgents.length === 0) return;

    const notification = `[Memory Update] Agent ${savingAgentId} saved shared memory: "${memory.key}" — ${memory.summary || memory.value.slice(0, 100)}. Consider recalling this memory if relevant to your current task.`;

    await Promise.all(otherAgents.map((agent) =>
      conversationsRequest("/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ from: savingAgentId, to: agent.id, content: notification }),
        signal: AbortSignal.timeout(3000),
      }, transport).catch(() => undefined)
    ));
  } catch {
    // Conversations is optional for the memory write; fail closed, not local.
  }
}
