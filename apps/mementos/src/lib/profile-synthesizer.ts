/**
 * Profile Synthesizer — aggregates preference and fact memories into a coherent profile.
 * Cached as a special pinned memory, auto-refreshed when preferences change.
 */

import { createMemory, listMemories, getMemoryByKey, updateMemory } from "../db/memories.js";
import { isApiMode, apiJson } from "../db/api-mode.js";
import {
  MementosApiProtocolError,
  expectBoolean,
  expectNonNegativeInteger,
  expectObject,
} from "../db/api-response-contract.js";
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

export type ProfileScope = "agent" | "project" | "global";
export const PROFILE_SYNTHESIS_CONTRACT = "mementos.profile.synthesize.v2" as const;

export class ProfileScopeError extends Error {
  readonly code = "MEMENTOS_PROFILE_SCOPE";
  constructor(message: string) {
    super(message);
    this.name = "ProfileScopeError";
  }
}

export class ProfileSynthesisError extends Error {
  readonly code = "MEMENTOS_PROFILE_SYNTHESIS";
  constructor() {
    super("Profile synthesis provider failed");
    this.name = "ProfileSynthesisError";
  }
}

interface ProfileTarget {
  scope: ProfileScope;
  id: string;
  memory_scope: "private" | "shared" | "global";
  agent_id?: string;
  project_id?: string;
}

function resolveProfileTarget(options: {
  project_id?: string;
  agent_id?: string;
  scope?: ProfileScope;
}): ProfileTarget {
  const scope = options.scope ?? (options.project_id ? "project" : options.agent_id ? "agent" : "global");
  if (scope === "project") {
    if (!options.project_id) throw new ProfileScopeError("project scope requires project_id");
    return { scope, id: options.project_id, memory_scope: "shared", project_id: options.project_id };
  }
  if (scope === "agent") {
    if (!options.agent_id) throw new ProfileScopeError("agent scope requires agent_id");
    return { scope, id: options.agent_id, memory_scope: "private", agent_id: options.agent_id };
  }
  return { scope: "global", id: "global", memory_scope: "global" };
}

export function getProfileKey(scope: string, id: string): string {
  return `_profile_${scope}_${id}`;
}

function listProfileMemories(
  category: "preference" | "fact",
  target: ProfileTarget,
) {
  if (target.scope !== "global") {
    return listMemories({
      category,
      scope: target.memory_scope,
      project_id: target.project_id,
      agent_id: target.agent_id,
      machine_id: null,
      status: "active",
      limit: 30,
    });
  }

  // Preserve the historical unowned shared/global corpus while refusing
  // project- or agent-owned records. Separate scoped reads prevent private
  // records from ever entering the candidate set.
  return [
    ...listMemories({ category, scope: "global", machine_id: null, status: "active", limit: 30 }),
    ...listMemories({ category, scope: "shared", machine_id: null, status: "active", limit: 1000 }),
  ].filter((memory) => memory.agent_id === null && memory.project_id === null).slice(0, 30);
}

export async function synthesizeProfile(options: {
  project_id?: string;
  agent_id?: string;
  scope?: ProfileScope;
  force_refresh?: boolean;
  fail_on_provider_error?: boolean;
}): Promise<{ profile: string; memory_count: number; from_cache: boolean } | null> {
  // Hosted transport: the server owns the corpus AND the LLM spend. A client
  // must not gather the corpus itself (it would need the whole memory set) nor
  // hold an ANTHROPIC_API_KEY to produce a profile — it asks
  // POST /v1/profile/synthesize and returns what the server produced.
  if (!isServerContext() && isApiMode()) {
    const operation = "POST /profile/synthesize";
    const { data } = apiJson<unknown>("POST", "/profile/synthesize", {
      project_id: options.project_id,
      agent_id: options.agent_id,
      scope: options.scope,
      force_refresh: options.force_refresh === true,
    });
    const response = expectObject(data, operation);
    if (response["contract"] !== PROFILE_SYNTHESIS_CONTRACT) {
      throw new MementosApiProtocolError(
        operation,
        `expected contract '${PROFILE_SYNTHESIS_CONTRACT}'`,
      );
    }
    if (!("profile" in response)) {
      throw new MementosApiProtocolError(operation, "missing 'profile'");
    }
    // The route answers {profile: null, message} when there is nothing to
    // synthesize — the same "no profile" outcome as the local arm's null.
    if (response["profile"] === null) {
      if (response["reason"] !== "no_memories") {
        throw new MementosApiProtocolError(operation, "null profile requires reason 'no_memories'");
      }
      return null;
    }
    if (typeof response["profile"] !== "string" || response["profile"].length === 0) {
      throw new MementosApiProtocolError(operation, "expected 'profile' to be a non-empty string or null");
    }
    return {
      profile: response["profile"],
      memory_count: expectNonNegativeInteger(response, "memory_count", operation),
      from_cache: expectBoolean(response, "from_cache", operation),
    };
  }
  const target = resolveProfileTarget(options);
  const profileKey = getProfileKey(target.scope, target.id);

  // Check cache unless force_refresh
  if (!options.force_refresh) {
    const cached = getMemoryByKey(profileKey, "shared", target.agent_id, target.project_id);
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
  const prefMemories = listProfileMemories("preference", target);
  const factMemories = listProfileMemories("fact", target);
  const allMemories = [...prefMemories, ...factMemories];

  if (allMemories.length === 0) return null;

  const apiKey = process.env["ANTHROPIC_API_KEY"];
  if (!apiKey) {
    // Fallback: build profile from memories without LLM
    const lines = allMemories.map(m => `- ${m.key}: ${m.value}`).join("\n");
    const fallbackProfile = `## Profile\n${lines}`;
    saveProfile(profileKey, fallbackProfile, allMemories.length, target);
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

    if (!response.ok) {
      if (options.fail_on_provider_error) throw new ProfileSynthesisError();
      return null;
    }
    const data = await response.json() as { content: { type: string; text: string }[] };
    const profile = data.content?.[0]?.text?.trim();
    if (!profile) {
      if (options.fail_on_provider_error) throw new ProfileSynthesisError();
      return null;
    }

    saveProfile(profileKey, profile, allMemories.length, target);
    return { profile, memory_count: allMemories.length, from_cache: false };
  } catch (error) {
    if (options.fail_on_provider_error) {
      if (error instanceof ProfileSynthesisError) throw error;
      throw new ProfileSynthesisError();
    }
    return null;
  }
}

function saveProfile(
  key: string,
  value: string,
  memoryCount: number,
  target: ProfileTarget
): void {
  try {
    createMemory({
      key,
      value,
      category: "resource",
      scope: "shared",
      importance: 10,
      source: "auto",
      tags: ["profile", "synthesized"],
      when_to_use: "When needing to understand this agent's or project's preferences, style, and conventions",
      metadata: { memory_count: memoryCount, synthesized_at: new Date().toISOString(), stale: false },
      agent_id: target.agent_id,
      project_id: target.project_id,
    });
  } catch {
    // Profile save failed — non-critical
  }
}

/**
 * Mark profile as stale. Called from PostMemorySave hook when a preference/fact is saved.
 */
export function markProfileStale(projectId?: string, agentId?: string): void {
  const targets: ProfileTarget[] = [{ scope: "global", id: "global", memory_scope: "global" }];
  if (projectId) targets.push({ scope: "project", id: projectId, memory_scope: "shared", project_id: projectId });
  if (agentId) targets.push({ scope: "agent", id: agentId, memory_scope: "private", agent_id: agentId });

  try {
    const db = !isServerContext() && isApiMode()
      ? undefined
      : require("../db/database.js").getDatabase() as import("../storage.js").SqliteAdapter;
    for (const target of targets) {
      const cached = getMemoryByKey(
        getProfileKey(target.scope, target.id),
        "shared",
        target.agent_id,
        target.project_id,
        undefined,
        db,
      );
      if (!cached) continue;
      updateMemory(cached.id, {
        metadata: { ...(cached.metadata ?? {}), stale: true },
        version: cached.version,
      }, db);
    }
  } catch {
    // Cache invalidation is best-effort; synthesis still honors the 24h age.
  }
}
