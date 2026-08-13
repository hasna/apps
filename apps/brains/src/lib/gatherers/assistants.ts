// Training data gatherer for open-assistants (@hasna/assistants)

import type { GatherResult, GathererOptions, TrainingExample } from "./types.js";

const SYSTEM_PROMPT = "You are a personal AI assistant with full context of the user's work environment, preferences, ongoing tasks, contacts, and projects.";

export async function gatherFromAssistants(options: GathererOptions = {}): Promise<GatherResult> {
  let sdk: Record<string, unknown>;
  try {
    // @ts-ignore — optional peer dependency
    sdk = await import("@hasna/assistants") as Record<string, unknown>;
  } catch {
    return { source: "assistants", examples: [], count: 0 };
  }

  if (typeof sdk["gatherTrainingData"] === "function") {
    return (sdk["gatherTrainingData"] as (o: GathererOptions) => Promise<GatherResult>)(options);
  }

  const examples: TrainingExample[] = [];
  const limit = options.limit ?? 500;

  try {
    // Try to get session/interaction history
    const listSessions = sdk["listSessions"] ?? sdk["getSessions"];
    if (typeof listSessions === "function") {
      const sessions = await (listSessions as () => Promise<unknown[]>)();
      for (const session of sessions.slice(0, Math.floor(limit / 2))) {
        const s = session as Record<string, unknown>;
        const messages = s["messages"] as Array<Record<string, unknown>> | undefined;
        if (messages && messages.length >= 2) {
          // Build a multi-turn example from the session
          const turns = messages
            .filter(m => m["role"] === "user" || m["role"] === "assistant")
            .slice(0, 6)
            .map(m => ({ role: m["role"] as "user" | "assistant", content: String(m["content"] ?? "") }));
          if (turns.length >= 2) {
            examples.push({ messages: [{ role: "system", content: SYSTEM_PROMPT }, ...turns] });
          }
        }
      }
    }
  } catch { /* partial ok */ }

  const finalExamples = examples.slice(0, limit);
  return { source: "assistants", examples: finalExamples, count: finalExamples.length };
}
