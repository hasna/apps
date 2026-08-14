/**
 * The policy inputs `todos delegate` reads: the embargo list and the depth
 * threshold. Both are DATA, deliberately.
 *
 * WHY THE EMBARGO IS A FILE AND NOT A CONSTANT. Seats go off limits by owner
 * directive, and the directive arrives faster than a release does. A name
 * compiled into the CLI is wrong the moment the embargo lifts, and lifting it
 * then needs a publish and a fleet install — so the list would be maintained by
 * whoever is willing to ship a patch, which is nobody. Hardcoding a specific
 * agent name here would also violate the standing rule against baking
 * environment-specific identifiers into code paths.
 *
 * WHY IT IS NOT IN THE SEAT ROSTER, which is the obvious-looking home: the
 * roster at `~/.hasna/identities/hasna-seats.roster.json` declares
 * `rosterIsClosed: true` and states that an agent MUST NOT add, remove or
 * rename a seat there. An embargo is not a roster edit, and expressing it as
 * one would require exactly the mutation that file forbids. It gets its own
 * file so the roster stays closed and the embargo stays editable.
 *
 * BOTH READERS DEGRADE TO "NO POLICY" RATHER THAN THROWING. A station-local
 * config file does not exist inside an e2b sandbox or a cloud runner, and a
 * verb that refused every delegation because it could not find its config would
 * be a worse defect than the one it enforces. The cost is stated rather than
 * hidden: with no embargo file, no name is embargoed.
 */
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { normalizeAgentNameInput } from "./agent-name-normalize.js";

export function defaultDelegationEmbargoPath(): string {
  return (
    process.env["TODOS_DELEGATION_EMBARGO_PATH"] ||
    join(homedir(), ".hasna", "identities", "delegation-embargo.json")
  );
}

/**
 * Normalised names that must not receive a delegation.
 *
 * Accepts either `{ "embargoed": ["name", ...] }` or a bare array, and tolerates
 * entries shaped `{ "slug": "name" }` so the file can carry a reason alongside
 * each name without the reader needing a schema version.
 */
export function loadDelegationEmbargo(path: string = defaultDelegationEmbargoPath()): Set<string> {
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8")) as unknown;
    const entries: unknown[] = Array.isArray(parsed)
      ? parsed
      : Array.isArray((parsed as { embargoed?: unknown })?.embargoed)
        ? ((parsed as { embargoed: unknown[] }).embargoed)
        : [];
    const names = new Set<string>();
    for (const entry of entries) {
      const raw = typeof entry === "string" ? entry : (entry as { slug?: unknown })?.slug;
      if (typeof raw === "string" && raw.trim()) names.add(normalizeAgentNameInput(raw));
    }
    return names;
  } catch {
    return new Set<string>();
  }
}

export interface DelegationDepthThreshold {
  /** `null` means no threshold is armed: report the count, never park. */
  value: number | null;
  source: "flag" | "env" | "unset";
}

/**
 * Resolve the open-task count above which a delegation parks.
 *
 * THE DEFAULT IS DELIBERATELY UNSET, and this is the clause with a cost
 * attached. Seat queues on this fleet were measured at 190 open rows, so any
 * plausible shipped number would park essentially every delegation — and a gate
 * that fires on every invocation is one operators learn to type past, which
 * converts a real signal into a formality. What the step is actually worth is
 * the PRINTED NUMBER and the RECORDED OVERRIDE, and those are delivered
 * unconditionally.
 *
 * So parking is opt-in until per-seat data justifies a number, and the number
 * lives in configuration rather than in a release when it does.
 */
export function resolveDelegationDepthThreshold(flagValue?: string | number | undefined): DelegationDepthThreshold {
  const fromFlag = coerceThreshold(flagValue);
  if (fromFlag !== null) return { value: fromFlag, source: "flag" };

  const fromEnv = coerceThreshold(process.env["TODOS_DELEGATION_DEPTH_THRESHOLD"]);
  if (fromEnv !== null) return { value: fromEnv, source: "env" };

  return { value: null, source: "unset" };
}

function coerceThreshold(value: string | number | undefined): number | null {
  if (value === undefined || value === null || value === "") return null;
  const parsed = typeof value === "number" ? value : Number.parseInt(String(value).trim(), 10);
  if (!Number.isSafeInteger(parsed) || parsed < 0) return null;
  return parsed;
}

/** Minutes a dispatched row may sit unclaimed before the steering pass owns it. */
export const DEFAULT_CLAIM_WINDOW_MINUTES = 30;
