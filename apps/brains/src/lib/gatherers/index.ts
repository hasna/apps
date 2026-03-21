import { writeFile, mkdir } from "fs/promises";
import { join } from "path";
import { homedir } from "os";
import { gatherFromTodos } from "./todos.js";
import { gatherFromMementos } from "./mementos.js";
import { gatherFromConversations } from "./conversations.js";
import { gatherFromSessions } from "./sessions.js";
import type { GatherResult, GathererOptions, TrainingExample } from "./types.js";
import { getGatherer, getRegisteredSources } from "./registry.js";

export * from "./types.js";
export * from "./protocol.js";
export * from "./registry.js";
export { gatherFromTodos, gatherFromMementos, gatherFromConversations, gatherFromSessions };

export async function gatherAll(
  sources: string[],
  options: GathererOptions = {}
): Promise<GatherResult[]> {
  // "all" expands to every registered source
  const targets = sources.includes("all") ? getRegisteredSources() : sources;

  const results = await Promise.allSettled(
    targets.map((source) => {
      const fn = getGatherer(source);
      if (!fn) return Promise.resolve({ source, examples: [], count: 0 } as GatherResult);
      return fn(options);
    })
  );

  return results
    .filter((r): r is PromiseFulfilledResult<GatherResult> => r.status === "fulfilled")
    .map((r) => r.value);
}

export async function mergeAndWriteJSONL(
  results: GatherResult[],
  outputPath?: string
): Promise<{ path: string; totalExamples: number; duplicatesRemoved: number }> {
  const defaultDir = join(homedir(), ".brains", "datasets");
  await mkdir(defaultDir, { recursive: true });

  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const finalPath = outputPath ?? join(defaultDir, `training-${timestamp}.jsonl`);

  const allExamples: TrainingExample[] = results.flatMap((r) => r.examples);

  // Deduplicate by serialized message content
  const seen = new Set<string>();
  const dedupedExamples: TrainingExample[] = [];
  for (const ex of allExamples) {
    const key = JSON.stringify(ex.messages);
    if (!seen.has(key)) {
      seen.add(key);
      dedupedExamples.push(ex);
    }
  }

  const duplicatesRemoved = allExamples.length - dedupedExamples.length;
  const jsonl = dedupedExamples.map((ex) => JSON.stringify(ex)).join("\n");

  await writeFile(finalPath, jsonl, "utf-8");

  return { path: finalPath, totalExamples: dedupedExamples.length, duplicatesRemoved };
}
