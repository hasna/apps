import { existsSync, rmSync } from "node:fs";
import { join } from "node:path";
import { ensureDir, getTodosGlobalDir, readJsonFile, writeJsonFile } from "./sync-utils.js";

/**
 * Ambient creator identity.
 *
 * The defect this closes: `todos init <name>` registered an agent and printed
 * "Use --agent <id> on future commands", but persisted that identity NOWHERE.
 * Every later command therefore had to re-supply `--agent` by hand, and in
 * practice nothing did — so `todos add` recorded who a task was FOR
 * (`assigned_to`) and never who FILED it. Measured on project 931835c7:
 * agent_id populated on 35/436 tasks, assigned_by on 0/436.
 *
 * Resolution order, most explicit first:
 *   1. an explicit value (the `--agent` flag)
 *   2. TODOS_AGENT_ID
 *   3. HASNA_TODOS_AGENT_ID
 *   4. the identity persisted by `todos init`
 *
 * Returns null when no identity can be established. Callers must treat null as
 * "unattributable" and say so — never as "attributable to nobody in particular".
 */

export interface PersistedIdentity {
  agent_id: string;
  agent_name?: string;
  session_id?: string;
  registered_at: string;
}

export type CreatorIdentitySource = "explicit" | "env" | "persisted" | "none";

export interface ResolvedCreatorIdentity {
  agent_id: string | null;
  source: CreatorIdentitySource;
}

export function identityFilePath(): string {
  return join(getTodosGlobalDir(), "identity.json");
}

export function readPersistedIdentity(): PersistedIdentity | null {
  const path = identityFilePath();
  if (!existsSync(path)) return null;
  const parsed = readJsonFile<PersistedIdentity>(path);
  if (!parsed || typeof parsed.agent_id !== "string" || !parsed.agent_id.trim()) return null;
  return parsed;
}

export interface IdentityCollision {
  /** The identity already on disk that a new `init` would have overwritten. */
  existing: PersistedIdentity;
}

/**
 * The file is keyed on $HOME, and this fleet runs many named agent sessions per
 * station under one HOME. Two sessions each running `todos init` would silently
 * leave the loser attributing its tasks to the winner — and a WRONG author is
 * worse than a missing one, because a null is visibly absent while a name is
 * simply believed. So a second, different identity is refused rather than
 * clobbered; the per-session escape hatch is the TODOS_AGENT_ID environment
 * variable, which outranks this file and cannot collide between processes.
 */
export function detectIdentityCollision(agentId: string, agentName?: string): IdentityCollision | null {
  const existing = readPersistedIdentity();
  if (!existing) return null;
  const sameId = canonicalAgentRef(existing.agent_id) === canonicalAgentRef(agentId);
  const sameName = Boolean(agentName) && canonicalAgentRef(existing.agent_name || "") === canonicalAgentRef(agentName!);
  if (sameId || sameName) return null;
  return { existing };
}

/** Persist the identity established by `todos init` so later commands inherit it. */
export function persistIdentity(identity: { agent_id: string; agent_name?: string; session_id?: string }): PersistedIdentity {
  const record: PersistedIdentity = {
    agent_id: identity.agent_id,
    ...(identity.agent_name ? { agent_name: identity.agent_name } : {}),
    ...(identity.session_id ? { session_id: identity.session_id } : {}),
    registered_at: new Date().toISOString(),
  };
  ensureDir(getTodosGlobalDir());
  writeJsonFile(identityFilePath(), record);
  return record;
}

/** Drop the persisted identity — used by `todos release` so the seat does not leak into the next session. */
export function clearPersistedIdentity(): boolean {
  const path = identityFilePath();
  if (!existsSync(path)) return false;
  try {
    rmSync(path);
    return true;
  } catch {
    return false;
  }
}

/**
 * Canonicalise exactly as `registerAgent` does (src/db/agents.ts: trim + lower-case).
 *
 * Without this the three sources disagree about the SAME agent: the persisted file
 * returns the registered name, which is already lower-cased, while the flag and the
 * environment variable were taken verbatim. An agent that registered with `todos init`
 * in one session and `TODOS_AGENT_ID=Cassius` in another — both sanctioned, and the
 * env var is the very escape hatch this module recommends for concurrent sessions —
 * would file some tasks as "cassius" and others as "Cassius". The comparison is a SQL
 * string inequality, so `not_created_by` would fail to exclude half of the agent's own
 * filings and leak them back into its own inbox: exactly the self-noise the filter
 * exists to remove.
 */
export function canonicalAgentRef(value: string): string {
  return value.trim().toLowerCase();
}

/**
 * Is this identity bound to THIS PROCESS, or merely lying around on the disk?
 *
 * `explicit` (--agent) and `env` (TODOS_AGENT_ID) travel with the process, so two
 * concurrent sessions cannot be handed the same one by accident. `persisted` is a
 * single file keyed on $HOME, and this fleet runs many named agent sessions per
 * station under one HOME — so it identifies the STATION, never the caller.
 *
 * The write side was already guarded: `todos init` refuses to clobber a foreign
 * identity (detectIdentityCollision). Nothing guarded the read side, and that is
 * the whole defect — refusing to record session B's identity silently converted
 * into attributing B's work to A. Measured on station01 2026-07-31: one agent ran
 * `todos init` at 17:31:04Z and every unregistered session on the box filed as it
 * from 17:37:36Z onward.
 *
 * So an ambient identity may be DISPLAYED, but it must never be written into a
 * task. A wrong name is worse than a missing one — this module's own doctrine —
 * and it is worse here in the direction that costs most: `assigned_to` is the
 * queue every seat reads, and `agent_id` is a filterable column
 * (task-crud.ts `filter.agent_id`) that also stands in as the acting agent
 * wherever `assigned_to` is null (`task.assigned_to || task.agent_id`).
 */
export function isProcessBoundSource(source: CreatorIdentitySource): boolean {
  return source === "explicit" || source === "env";
}

/**
 * The identity this process may WRITE onto a task, or null when it has none.
 *
 * Deliberately narrower than `resolveCreatorIdentity`, which still reports the
 * ambient identity so that `todos init`/diagnostics can show what is on disk.
 */
export function resolveWritableIdentity(explicit?: string | null): ResolvedCreatorIdentity {
  const resolved = resolveCreatorIdentity(explicit);
  if (!isProcessBoundSource(resolved.source)) return { agent_id: null, source: "none" };
  return resolved;
}

export function resolveCreatorIdentity(explicit?: string | null): ResolvedCreatorIdentity {
  const fromExplicit = explicit?.trim();
  if (fromExplicit) return { agent_id: canonicalAgentRef(fromExplicit), source: "explicit" };

  const fromEnv = (process.env["TODOS_AGENT_ID"] || process.env["HASNA_TODOS_AGENT_ID"] || "").trim();
  if (fromEnv) return { agent_id: canonicalAgentRef(fromEnv), source: "env" };

  const persisted = readPersistedIdentity();
  if (persisted) {
    // Prefer the NAME over the UUID. `todos init` returns both, but the fleet
    // addresses agents by name — `--assign cassius`, `--agent cassius` — so
    // assigned_to and agent_id hold names in practice. Attributing to the UUID
    // instead would write a created_by that matches nothing any other agent
    // filters on, and `--inbox` would silently return an empty list. `agents.name`
    // is UNIQUE, so the name is a stable key rather than a display label.
    return { agent_id: canonicalAgentRef(persisted.agent_name || persisted.agent_id), source: "persisted" };
  }

  return { agent_id: null, source: "none" };
}
