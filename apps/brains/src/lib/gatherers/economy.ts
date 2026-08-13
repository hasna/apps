// Training data gatherer for open-economy (@hasna/economy)

import type { GatherResult, GathererOptions, TrainingExample } from "./types.js";

const SYSTEM_PROMPT = "You are a cost-aware AI assistant that tracks API usage, identifies expensive patterns, and helps optimize AI spending.";

export async function gatherFromEconomy(options: GathererOptions = {}): Promise<GatherResult> {
  let sdk: Record<string, unknown>;
  try {
    // @ts-ignore — optional peer dependency
    sdk = await import("@hasna/economy") as Record<string, unknown>;
  } catch {
    return { source: "economy", examples: [], count: 0 };
  }

  if (typeof sdk["gatherTrainingData"] === "function") {
    return (sdk["gatherTrainingData"] as (o: GathererOptions) => Promise<GatherResult>)(options);
  }

  const examples: TrainingExample[] = [];
  const limit = options.limit ?? 500;

  try {
    // Try common economy SDK exports
    const listSessions = sdk["listSessions"] ?? sdk["getSessions"] ?? sdk["getCostSummary"];
    if (typeof listSessions === "function") {
      const sessions = await (listSessions as () => Promise<unknown[]>)();
      const items = Array.isArray(sessions) ? sessions : [sessions];
      for (const session of items.slice(0, Math.floor(limit / 2))) {
        const s = session as Record<string, unknown>;
        examples.push({
          messages: [
            { role: "system", content: SYSTEM_PROMPT },
            { role: "user", content: `How much did session "${String(s["session_id"] ?? s["id"] ?? "unknown")}" cost?` },
            { role: "assistant", content: `Session cost: $${String(s["total_cost"] ?? s["cost"] ?? "0.00")} — ${String(s["model"] ?? "unknown model")}, ${String(s["total_tokens"] ?? s["tokens"] ?? "?")} tokens` },
          ],
        });
      }
    }

    const getModelBreakdown = sdk["getModelBreakdown"];
    if (typeof getModelBreakdown === "function") {
      const breakdown = await (getModelBreakdown as () => Promise<unknown>)();
      examples.push({
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: "Which AI models have I spent the most on?" },
          { role: "assistant", content: `Model cost breakdown: ${JSON.stringify(breakdown, null, 2)}` },
        ],
      });
    }
  } catch { /* partial ok */ }

  const finalExamples = examples.slice(0, limit);
  return { source: "economy", examples: finalExamples, count: finalExamples.length };
}
