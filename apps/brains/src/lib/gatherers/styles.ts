// Training data gatherer for open-styles (@hasnaxyz/styles)
// Imported via SDK — no direct DB reads.

import type { GatherResult, GathererOptions, TrainingExample } from "./types.js";

const SYSTEM_PROMPT = "You are a design-aware AI assistant with knowledge of the user's style preferences, design system, and visual identity. You help apply consistent styling across projects.";

export async function gatherFromStyles(options: GathererOptions = {}): Promise<GatherResult> {
  // Dynamic import so the package is optional — won't crash if not installed
  let sdk: {
    listProfiles?: () => Promise<unknown[]>;
    listPrefs?: () => Promise<unknown[]>;
    searchStyles?: (q: string) => Promise<unknown[]>;
    getStyle?: (id: string) => Promise<unknown>;
  };

  try {
    // @ts-ignore — optional peer dependency
    sdk = await import("@hasnaxyz/styles") as typeof sdk;
  } catch {
    return { source: "styles", examples: [], count: 0 };
  }

  // If the SDK exports gatherTrainingData directly, prefer it
  const sdkAny = sdk as Record<string, unknown>;
  if (typeof sdkAny["gatherTrainingData"] === "function") {
    return (sdkAny["gatherTrainingData"] as (o: GathererOptions) => Promise<GatherResult>)(options);
  }

  const examples: TrainingExample[] = [];
  const limit = options.limit ?? 500;

  try {
    if (typeof sdk.listProfiles === "function") {
      const profiles = await sdk.listProfiles();
      for (const profile of profiles.slice(0, Math.floor(limit / 3))) {
        const p = profile as Record<string, unknown>;
        examples.push({
          messages: [
            { role: "system", content: SYSTEM_PROMPT },
            { role: "user", content: `What are the style settings in the "${String(p["name"] ?? "default")}" profile?` },
            { role: "assistant", content: `Style profile "${String(p["name"] ?? "default")}": ${JSON.stringify(p, null, 2)}` },
          ],
        });
      }
    }

    if (typeof sdk.listPrefs === "function") {
      const prefs = await sdk.listPrefs();
      for (const pref of prefs.slice(0, Math.floor(limit / 3))) {
        const pr = pref as Record<string, unknown>;
        examples.push({
          messages: [
            { role: "system", content: SYSTEM_PROMPT },
            { role: "user", content: `What is my preference for "${String(pr["key"] ?? pr["name"] ?? "style")}"?` },
            { role: "assistant", content: `Your preference: ${String(pr["value"] ?? JSON.stringify(pr))}` },
          ],
        });
      }
    }
  } catch {
    // SDK call failed — return whatever we gathered so far
  }

  const finalExamples = examples.slice(0, limit);
  return { source: "styles", examples: finalExamples, count: finalExamples.length };
}
