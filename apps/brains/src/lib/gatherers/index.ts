import { writeFile, mkdir } from "fs/promises";
import { join } from "path";
import { homedir } from "os";
import { gatherFromTodos } from "./todos.js";
import { gatherFromMementos } from "./mementos.js";
import { gatherFromConversations } from "./conversations.js";
import { gatherFromSessions } from "./sessions.js";
import type { GatherResult, GathererOptions, TrainingExample } from "./types.js";

export * from "./types.js";
export { gatherFromTodos, gatherFromMementos, gatherFromConversations, gatherFromSessions };

const ALL_SOURCES = ["todos", "mementos", "conversations", "sessions"] as const;
type Source = (typeof ALL_SOURCES)[number];

export async function gatherAll(
  sources: string[],
  options: GathererOptions = {}
): Promise<GatherResult[]> {
  const targets = sources.includes("all") ? [...ALL_SOURCES] : (sources as Source[]);

  const results = await Promise.allSettled(
    targets.map((source) => {
      switch (source) {
        case "todos": return gatherFromTodos(options);
        case "mementos": return gatherFromMementos(options);
        case "conversations": return gatherFromConversations(options);
        case "sessions": return gatherFromSessions(options);
        default: return Promise.resolve({ source, examples: [], count: 0 } as GatherResult);
      }
    })
  );

  return results
    .filter((r): r is PromiseFulfilledResult<GatherResult> => r.status === "fulfilled")
    .map((r) => r.value);
}

export async function mergeAndWriteJSONL(
  results: GatherResult[],
  outputPath?: string
): Promise<{ path: string; totalExamples: number }> {
  const defaultDir = join(homedir(), ".brains", "datasets");
  await mkdir(defaultDir, { recursive: true });

  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const finalPath = outputPath ?? join(defaultDir, `training-${timestamp}.jsonl`);

  const allExamples: TrainingExample[] = results.flatMap((r) => r.examples);
  const jsonl = allExamples.map((ex) => JSON.stringify(ex)).join("\n");

  await writeFile(finalPath, jsonl, "utf-8");

  return { path: finalPath, totalExamples: allExamples.length };
}
