// Training data gatherer for @hasnaxyz/styles
// Implements the GatherTrainingDataFn protocol from @hasna/brains.

import { listProfiles } from "./profiles.js";
import { listPrefs } from "./preferences.js";
import { listTemplates } from "./templates.js";
import { STYLES } from "./registry.js";

// ── Inline types (mirrors @hasna/brains protocol) ────────────────────────────

export interface TrainingExample {
  messages: Array<{
    role: "system" | "user" | "assistant";
    content: string;
  }>;
}

export interface GatherResult {
  source: string;
  examples: TrainingExample[];
  count: number;
}

export interface GathererOptions {
  limit?: number;
  since?: Date;
  outputDir?: string;
}

// GatherTrainingDataFn — matches @hasna/brains protocol.ts
export type GatherTrainingDataFn = (
  options?: GathererOptions
) => Promise<GatherResult>;

// ── Implementation ────────────────────────────────────────────────────────────

const SYSTEM_PROMPT =
  "You are a design-aware AI assistant with knowledge of the user's style preferences and design system. You help apply consistent styling across projects and make design decisions aligned with the active style profile.";

export const gatherTrainingData: GatherTrainingDataFn = async (
  options: GathererOptions = {}
): Promise<GatherResult> => {
  const limit = options.limit ?? 500;
  const examples: TrainingExample[] = [];

  // ── 1. Style profiles ──────────────────────────────────────────────────────
  try {
    const profiles = listProfiles();
    for (const profile of profiles.slice(0, Math.floor(limit / 4))) {
      examples.push({
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          {
            role: "user",
            content: `Describe the "${profile.name}" style profile and its design principles.`,
          },
          {
            role: "assistant",
            content:
              `Style profile: ${profile.displayName} (${profile.category})\n\n` +
              `Description: ${profile.description || "No description."}\n\n` +
              (profile.principles.length
                ? `Principles:\n${profile.principles.map((p) => `- ${p}`).join("\n")}\n\n`
                : "") +
              (profile.antiPatterns?.length
                ? `Anti-patterns to avoid:\n${profile.antiPatterns.map((a) => `- ${a}`).join("\n")}\n\n`
                : "") +
              (profile.tags.length
                ? `Tags: ${profile.tags.join(", ")}`
                : ""),
          },
        ],
      });

      if (profile.principles.length > 0) {
        examples.push({
          messages: [
            { role: "system", content: SYSTEM_PROMPT },
            {
              role: "user",
              content: `How should I apply the ${profile.displayName} style to my project?`,
            },
            {
              role: "assistant",
              content:
                `To apply the ${profile.displayName} style:\n\n` +
                profile.principles.map((p) => `- ${p}`).join("\n"),
            },
          ],
        });
      }
    }
  } catch {
    // partial results are fine
  }

  // ── 2. Preferences ────────────────────────────────────────────────────────
  try {
    const prefs = listPrefs();
    for (const pref of prefs.slice(0, Math.floor(limit / 4))) {
      examples.push({
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          {
            role: "user",
            content: `What is the current preference for "${pref.key}"?`,
          },
          {
            role: "assistant",
            content:
              `Preference "${pref.key}" (${pref.scope} scope): ${pref.value}`,
          },
        ],
      });
    }
  } catch {
    // partial results are fine
  }

  // ── 3. Templates ──────────────────────────────────────────────────────────
  try {
    const templates = listTemplates();
    for (const tpl of templates.slice(0, Math.floor(limit / 4))) {
      examples.push({
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          {
            role: "user",
            content: `What is the "${tpl.name}" template used for?`,
          },
          {
            role: "assistant",
            content:
              `Template "${tpl.name}": ${tpl.description || "No description."} ` +
              (Object.keys(tpl.variables).length
                ? `Variables: ${Object.keys(tpl.variables).join(", ")}`
                : ""),
          },
        ],
      });
    }
  } catch {
    // partial results are fine
  }

  // ── 4. Built-in style catalog ─────────────────────────────────────────────
  try {
    const styleSlice = STYLES.slice(0, Math.floor(limit / 4));
    for (const style of styleSlice) {
      examples.push({
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          {
            role: "user",
            content: `Tell me about the "${style.name}" style.`,
          },
          {
            role: "assistant",
            content:
              `${style.displayName} (${style.category}): ${style.description}\n\n` +
              (style.principles?.length
                ? `Principles:\n${style.principles.map((p: string) => `- ${p}`).join("\n")}`
                : ""),
          },
        ],
      });
    }
  } catch {
    // partial results are fine
  }

  const finalExamples = examples.slice(0, limit);
  return { source: "styles", examples: finalExamples, count: finalExamples.length };
};
