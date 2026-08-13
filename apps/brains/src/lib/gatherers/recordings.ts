// Training data gatherer for open-recordings (@hasna/recordings)

import type { GatherResult, GathererOptions, TrainingExample } from "./types.js";

const SYSTEM_PROMPT = "You are a voice-aware AI assistant that transcribes, searches, and summarizes audio recordings.";

export async function gatherFromRecordings(options: GathererOptions = {}): Promise<GatherResult> {
  let sdk: Record<string, unknown>;
  try {
    // @ts-ignore — optional peer dependency
    sdk = await import("@hasna/recordings") as Record<string, unknown>;
  } catch {
    return { source: "recordings", examples: [], count: 0 };
  }

  if (typeof sdk["gatherTrainingData"] === "function") {
    return (sdk["gatherTrainingData"] as (o: GathererOptions) => Promise<GatherResult>)(options);
  }

  const examples: TrainingExample[] = [];
  const limit = options.limit ?? 500;

  try {
    if (typeof sdk["listRecordings"] === "function") {
      const recordings = await (sdk["listRecordings"] as () => Promise<unknown[]>)();
      for (const rec of recordings.slice(0, limit)) {
        const r = rec as Record<string, unknown>;
        if (r["transcription"] || r["transcript"]) {
          const transcript = String(r["transcription"] ?? r["transcript"]);
          examples.push({
            messages: [
              { role: "system", content: SYSTEM_PROMPT },
              { role: "user", content: `Summarize the recording "${String(r["fileName"] ?? r["name"] ?? r["id"])}"` },
              { role: "assistant", content: transcript.slice(0, 2000) },
            ],
          });
          // Also add a search example
          const words = transcript.split(" ").slice(0, 3).join(" ");
          examples.push({
            messages: [
              { role: "system", content: SYSTEM_PROMPT },
              { role: "user", content: `Find recordings mentioning "${words}"` },
              { role: "assistant", content: `Found recording: "${String(r["fileName"] ?? r["name"])}" — ${new Date(Number(r["createdAt"] ?? Date.now())).toLocaleDateString()}` },
            ],
          });
        }
      }
    }
  } catch { /* partial ok */ }

  const finalExamples = examples.slice(0, limit);
  return { source: "recordings", examples: finalExamples, count: finalExamples.length };
}
