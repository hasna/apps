// Training data gatherer for open-researcher (@hasna/researcher)

import type { GatherResult, GathererOptions, TrainingExample } from "./types.js";

const SYSTEM_PROMPT = "You are a scientific research assistant that helps design experiments, form hypotheses, and interpret results.";

export async function gatherFromResearcher(options: GathererOptions = {}): Promise<GatherResult> {
  let sdk: Record<string, unknown>;
  try {
    // @ts-ignore — optional peer dependency
    sdk = await import("@hasna/researcher") as Record<string, unknown>;
  } catch {
    return { source: "researcher", examples: [], count: 0 };
  }

  if (typeof sdk["gatherTrainingData"] === "function") {
    return (sdk["gatherTrainingData"] as (o: GathererOptions) => Promise<GatherResult>)(options);
  }

  const examples: TrainingExample[] = [];
  const limit = options.limit ?? 500;

  try {
    if (typeof sdk["listProjects"] === "function") {
      const projects = await (sdk["listProjects"] as () => Promise<unknown[]>)();
      for (const proj of projects.slice(0, Math.floor(limit / 2))) {
        const p = proj as Record<string, unknown>;
        examples.push({
          messages: [
            { role: "system", content: SYSTEM_PROMPT },
            { role: "user", content: `Summarize the research project "${String(p["name"] ?? p["id"])}"` },
            { role: "assistant", content: `Project "${String(p["name"] ?? p["id"])}": ${String(p["description"] ?? JSON.stringify(p))}` },
          ],
        });
      }
    }

    if (typeof sdk["listResults"] === "function") {
      const results = await (sdk["listResults"] as () => Promise<unknown[]>)();
      for (const result of results.slice(0, Math.floor(limit / 2))) {
        const r = result as Record<string, unknown>;
        examples.push({
          messages: [
            { role: "system", content: SYSTEM_PROMPT },
            { role: "user", content: `What were the results of experiment "${String(r["name"] ?? r["id"])}"?` },
            { role: "assistant", content: `Result: ${String(r["summary"] ?? r["output"] ?? JSON.stringify(r))}` },
          ],
        });
      }
    }
  } catch { /* partial results ok */ }

  const finalExamples = examples.slice(0, limit);
  return { source: "researcher", examples: finalExamples, count: finalExamples.length };
}
