import type { AgentPresence } from "../types.js";

export function resolveSelfSenderIds(
  agent: string,
  presence: Pick<AgentPresence, "id"> | null | undefined,
): string[] {
  const ids = [agent];
  if (presence?.id && presence.id !== agent) ids.push(presence.id);
  return ids;
}
