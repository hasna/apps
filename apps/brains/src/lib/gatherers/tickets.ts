// Training data gatherer for open-tickets (@hasna/tickets)

import type { GatherResult, GathererOptions, TrainingExample } from "./types.js";

const SYSTEM_PROMPT = "You are an issue management assistant that triages bugs, prioritizes features, and tracks incident resolutions.";

export async function gatherFromTickets(options: GathererOptions = {}): Promise<GatherResult> {
  let sdk: Record<string, unknown>;
  try {
    // @ts-ignore — optional peer dependency
    sdk = await import("@hasna/tickets") as Record<string, unknown>;
  } catch {
    return { source: "tickets", examples: [], count: 0 };
  }

  if (typeof sdk["gatherTrainingData"] === "function") {
    return (sdk["gatherTrainingData"] as (o: GathererOptions) => Promise<GatherResult>)(options);
  }

  const examples: TrainingExample[] = [];
  const limit = options.limit ?? 500;

  try {
    if (typeof sdk["listTickets"] === "function") {
      const tickets = await (sdk["listTickets"] as () => Promise<unknown[]>)();
      for (const ticket of tickets.slice(0, limit)) {
        const t = ticket as Record<string, unknown>;
        examples.push({
          messages: [
            { role: "system", content: SYSTEM_PROMPT },
            { role: "user", content: `What is the status of ticket "${String(t["title"] ?? t["id"])}"?` },
            { role: "assistant", content: `Ticket "${String(t["title"] ?? t["id"])}" [${String(t["status"] ?? "open")}/${String(t["priority"] ?? "medium")}]: ${String(t["description"] ?? "(no description)")}` },
          ],
        });
      }
    }
  } catch { /* partial ok */ }

  const finalExamples = examples.slice(0, limit);
  return { source: "tickets", examples: finalExamples, count: finalExamples.length };
}
