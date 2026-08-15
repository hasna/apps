import type { AgentPresence } from "../types.js";

export function resolveSelfSenderId(
  agent: string,
  presence: Pick<AgentPresence, "id"> | null | undefined,
): string {
  return presence?.id || agent;
}
