/**
 * Profile Synthesizer — aggregates preference and fact memories into a coherent profile.
 * Cached as a special pinned memory, auto-refreshed when preferences change.
 */

import { createMemory, listMemories, getMemoryByKey, updateMemory } from "../db/memories.js";
import { isApiMode, apiJson } from "../db/api-mode.js";
import { isServerContext } from "../storage.js";

const PROFILE_PROMPT = `You synthesize a coherent agent/project profile from individual preference and fact memories.

Output a concise profile (200-300 words max) organized by:
- **Stack & Tools**: Languages, frameworks, package managers, etc.
- **Code Style**: Formatting, patterns, naming conventions
- **Workflow**: Testing, deployment, git practices
- **Communication**: Response style, verbosity, formatting preferences
- **Key Facts**: Architecture decisions, constraints, team conventions

Only include sections that have relevant data. Be specific and actionable.
Output in markdown format.`;

export function getProfileKey(scope: string, id: string): string {
  return `_profile_${scope}_${id}`;
}

export async function synthesizeProfile(options: {
  project_id?: string;
  agent_id?: string;
  scope?: "agent" | "project" | "global";
  force_refresh?: boolean;
}): Promise<{ profile: string; memory_count: number; from_cache: boolean } | null> {
  // Hosted transport: the server owns the corpus AND the LLM spend. A client
  // must not gather the corpus itself (it would need the whole memory set) nor
  // hold an ANTHROPIC_API_KEY to produce a profile — it asks
  // POST /v1/profile/synthesize and returns what the server produced.
  if (!isServerContext() && isApiMode()) {
    const { data } = apiJson<{
      profile?: string | null;
      memory_count?: number;
      from_cache?: boolean;
    }>("POST", "/profile/synthesize", {
      project_id: options.project_id,
      agent_id: options.agent_id,
      force_refresh: options.force_refresh === true,
    });
    // The route answers {profile: null, message} when there is nothing to
    // synthesize — the same "no profile" outcome as the local arm's null.
    if (!data || data.profile === null || data.profile === undefined) return null;
    return {
      profile: data.profile,
      memory_count: data.memory_count ?? 0,
      from_cache: data.from_cache ?? false,
    };
  }
  const scope = options.scope || (options.project_id ? "project" : options.agent_id ? "agent" : "global");
  const id = options.project_id || options.agent_id || "global";
  const profileKey = getProfileKey(scope, id);

  // Check cache unless force_refresh
  if (!options.force_refresh) {
    const cached = getMemoryByKey(profileKey, "shared", undefined, options.project_id);
    if (cached) {
      const age = Date.now() - new Date(cached.updated_at).getTime();
      const maxAge = 24 * 60 * 60 * 1000; // 24 hours
      const isStale = cached.metadata?.stale === true;
      if (age < maxAge && !isStale) {
        return { profile: cached.value, memory_count: 0, from_cache: true };
      }
    }
  }

  // Gather preference and fact memories
  const prefMemories = listMemories({
    category: "preference",
    project_id: options.project_id,
    machine_id: null,
    status: "active",
    limit: 30,
  });
  const factMemories = listMemories({
    category: "fact",
    project_id: options.project_id,
    machine_id: null,
    status: "active",
    limit: 30,
  });
  const allMemories = [...prefMemories, ...factMemories];

  if (allMemories.length === 0) return null;

  const apiKey = process.env["ANTHROPIC_API_KEY"];
  if (!apiKey) {
    // Fallback: build profile from memories without LLM
    const lines = allMemories.map(m => `- ${m.key}: ${m.value}`).join("\n");
    const fallbackProfile = `## Profile\n${lines}`;
    saveProfile(profileKey, fallbackProfile, allMemories.length, options);
    return { profile: fallbackProfile, memory_count: allMemories.length, from_cache: false };
  }

  try {
    const memoryList = allMemories
      .sort((a, b) => b.importance - a.importance)
      .map(m => `[${m.category}] ${m.key}: ${m.value}`)
      .join("\n");

    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 500,
        system: PROFILE_PROMPT,
        messages: [{ role: "user", content: `Synthesize a profile from these ${allMemories.length} memories:\n\n${memoryList}` }],
      }),
    });

    if (!response.ok) return null;
    const data = await response.json() as { content: { type: string; text: string }[] };
    const profile = data.content?.[0]?.text?.trim();
    if (!profile) return null;

    saveProfile(profileKey, profile, allMemories.length, options);
    return { profile, memory_count: allMemories.length, from_cache: false };
  } catch {
    return null;
  }
}

function saveProfile(
  key: string,
  value: string,
  memoryCount: number,
  options: { project_id?: string; agent_id?: string }
): void {
  try {
    createMemory({
      key,
      value,
      category: "fact",
      scope: "shared",
      importance: 10,
      source: "auto",
      tags: ["profile", "synthesized"],
      when_to_use: "When needing to understand this agent's or project's preferences, style, and conventions",
      metadata: { memory_count: memoryCount, synthesized_at: new Date().toISOString(), stale: false },
      agent_id: options.agent_id,
      project_id: options.project_id,
    });
  } catch {
    // Profile save failed — non-critical
  }
}

/**
 * Mark profile as stale. Called from PostMemorySave hook when a preference/fact is saved.
 */
export function markProfileStale(projectId?: string, agentId?: string): void {
  // Hosted transport: there is no bulk-metadata route, and there must not be a
  // silent no-op either — the cached profile would stay fresh-looking forever.
  // The cache keys are deterministic (getProfileKey), so mark exactly the ones
  // this hook can name, through the hosted read/update routes.
  if (!isServerContext() && isApiMode()) {
    try {
      const keys = [
        projectId ? getProfileKey("project", projectId) : undefined,
        agentId ? getProfileKey("agent", agentId) : undefined,
        getProfileKey("global", "global"),
      ].filter((k): k is string => !!k);
      for (const key of keys) {
        const cached = getMemoryByKey(key, "shared", undefined, projectId);
        if (!cached) continue;
        updateMemory(cached.id, {
          metadata: { ...(cached.metadata ?? {}), stale: true },
          // Optimistic locking: the version we just read. A concurrent writer
          // wins and this best-effort mark is skipped (caught below), exactly
          // like the local arm's swallowed failure.
          version: cached.version,
        });
      }
    } catch {
      // Non-critical (same contract as the local arm).
    }
    return;
  }
  try {
    const { getDatabase } = require("../db/database.js");
    const db = getDatabase();
    // Mark all profile memories for this project as stale
    db.run(
      `UPDATE memories SET metadata = json_set(COALESCE(metadata, '{}'), '$.stale', json('true'))
       WHERE key LIKE '_profile_%' AND COALESCE(project_id, '') = ?`,
      [projectId || ""]
    );
  } catch {
    // Non-critical
  }
}
