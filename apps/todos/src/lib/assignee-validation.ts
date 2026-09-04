/**
 * Validation for `--assign <agent>` — the assignment path, not a sweep.
 *
 * `--assign` used to be passed straight through to the store. It accepted a
 * name that belonged to nobody, a name that belonged to several agents at
 * once, and a ROSTER SEAT, all at rc=0 and all indistinguishable afterwards
 * from a properly owned row. Owner directive k_ms8qy755_ryetl9 settles the
 * last of those: a task assigned to a seat is assigned to NOBODY. The store
 * disagrees — a seat slug is a registered agent, `todos heartbeat
 * agent-chief-staff` returns rc=0 — so the CLI has to carry the distinction
 * that the schema cannot.
 *
 * Measured on station01, 2026-08-01, over the 2566 pending tasks in the shared
 * store. Of the 493 carrying an assignee: 365 (74%) named a seat, 44 (9%)
 * named something that is not an agent at all (bare task ids, a repo name, the literal string `unassigned`), and 66 (13%) named an
 * agent whose name maps to more than one row. 18 rows (3.6%) were clean.
 *
 * Why validation lives HERE and not in a cleanup sweep: a rule enforced by
 * sweep decays. The ghost-assignment defect that preceded this one minted rows
 * faster than any cleanup, and the backfill only became worth running once the
 * creation path was fixed in 0.13.7.
 *
 * WHAT THIS DELIBERATELY DOES NOT DO — recorded so it is not "fixed" later by
 * someone reading the original bug report. The obvious design is to refuse a
 * name that is currently active under a DIFFERENT session. That check cannot
 * be written against this store: `agents.session_id` is populated on 0 of 1219
 * rows and `status` reads `active` on 1219 of 1219, so a session- or
 * status-based guard would pass unconditionally — a check that cannot fail.
 * The implementable generalisation of "someone else's live agent" is name
 * AMBIGUITY, which is real (132 names occupy more than one row) and is what
 * the `ambiguous` verdict covers.
 *
 * This module imports nothing but `node:fs`/`node:path` and the shared name
 * normaliser, for the same reason `agent-name-normalize.ts` imports nothing:
 * it is reachable from the CLI, the MCP server and both storage engines, and
 * must not drag a module graph behind it.
 */
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { normalizeAgentNameInput } from "./agent-name-normalize.js";
import { env } from "../lib/env.js";

/** The subset of an agent row this validator needs. */
export interface KnownAgent {
  id: string;
  name: string;
}

export interface AssigneeContext {
  /** Every agent row known to the store. */
  agents: KnownAgent[];
  /** Roster seat slugs, normalised. See {@link loadSeatSlugs}. */
  seats: Set<string>;
  /** Caller passed `--assign-seat`: filing at a seat is deliberate. */
  allowSeat?: boolean;
  /**
   * Builds the exact runnable suffix that pairs `--assign-seat` with the
   * refused value, FOR THE VERB THE CALLER IS ACTUALLY ON.
   *
   * This function is shared by four call sites — `add`, `update`,
   * `task upsert`, and the standalone `assign <id> <agent>` — and three of
   * them take the assignee via a `--assign <agent>` FLAG while the fourth
   * takes it POSITIONALLY with no `--assign` flag at all. A single hardcoded
   * `--assign <value> --assign-seat` snippet is therefore correct for three
   * verbs and `error: unknown option '--assign'` on the fourth (todos
   * 75296282, PR hasna/todos#162 review by pr162-reviewer, cycle 1): the
   * seat-refusal message recommended an invocation the verb it was printed
   * from does not accept — the exact class of defect the message exists to
   * remove, relocated rather than fixed.
   *
   * Each call site supplies its own builder naming its own real shape, so the
   * message can never again claim a flag a given verb does not have.
   * Undefined falls back to naming `--assign-seat` in prose with no runnable
   * snippet, which is always safe because it recommends no invocation shape
   * at all.
   */
  seatHint?: (value: string) => string;
}

/**
 * Three outcomes, and the split between REFUSE and WARN is evidence-driven
 * rather than a matter of taste:
 *
 * - `seat` REFUSES. The seat list is a closed, declared set and an owner
 *   directive says the row is ownerless. There is no honest reading of
 *   `--assign agent-ceo` that means "a session will pick this up".
 * - `ambiguous` REFUSES. The name certainly exists; what cannot be done is
 *   PICK, and picking the first row is precisely how a task lands on a
 *   stranger. A fresh store cannot trip this, because a name has to occupy two
 *   rows to be ambiguous.
 * - `unknown` only WARNS. Assigning to an agent that has not registered yet is
 *   a REAL, EXISTING, TESTED contract in this CLI — `todos add --assign
 *   brutus` against a store where brutus has never registered must succeed
 *   (src/cli/creator-attribution.test.ts). Refusing it broke 9 existing tests
 *   when this validator was first written to refuse, which is exactly the
 *   legitimate flow that measurement was supposed to find. The check cannot
 *   tell a typo from a not-yet-registered agent, so it says so and gets out of
 *   the way.
 */
export type AssigneeVerdict =
  | { ok: true; assignee: string; agentId?: string; isSeat: boolean; warning?: string }
  | {
      ok: false;
      reason: "seat" | "ambiguous";
      message: string;
      candidates?: KnownAgent[];
    };

/**
 * What a READ-side `--assigned <ref>` filter is about to do, when that is worth
 * saying out loud. See {@link describeAssigneeFilter}.
 */
export type AssigneeFilterNotice =
  | { kind: "ok" }
  | { kind: "ambiguous"; message: string; candidates: KnownAgent[] };

/**
 * The read-path counterpart to {@link validateAssignee}, for `list --assigned`.
 *
 * WHY THIS EXISTS (todos task 0cbf512c). Both storage engines resolve an
 * `assigned_to` filter through an alias set — `resolveAssignedToAliases`
 * (db/database.ts) and `resolveAgentForAssignedFilter`
 * (storage/postgres-adapter.ts). Both deliberately degrade an AMBIGUOUS name,
 * one that case-insensitively occupies 2+ agent rows, to LITERAL-ONLY matching
 * rather than picking a row at random. That choice is right and is not changed
 * here: picking is how a task lands on a stranger.
 *
 * What was wrong is that the degradation was SILENT. Both call sites describe
 * literal-only as "same as no match". It is not. "No match" returns zero rows
 * and the caller can see it; literal-only returns a POPULATED, PLAUSIBLE,
 * PARTIAL set at rc=0 with nothing on stderr, so a complete answer and a
 * truncated one are indistinguishable.
 *
 * Measured live on the cloud store, @hasna/todos 0.15.6, 2026-08-07:
 * `--assigned 01d4cc12` returned 190 rows (`{fabricius: 182, '01d4cc12': 8}`)
 * while `--assigned fabricius` returned 182 and 0 bytes of stderr. Eight rows
 * whose `assigned_to` holds a raw agent id are invisible to the name query that
 * seat actually runs.
 *
 * This WARNS rather than refusing, which is the one place it departs from
 * `validateAssignee`. A write can be refused and retried; a read is run by
 * scripts and by every agent's own queue check, and making it exit non-zero
 * would be a worse regression than the defect. The partial set is still the
 * best available answer — it just has to say that it is partial.
 *
 * Bridging two rows into one identity is a separate identity-model decision and
 * is deliberately NOT attempted here (todos task a37a7137).
 */
export function describeAssigneeFilter(input: string, ctx: Pick<AssigneeContext, "agents">): AssigneeFilterNotice {
  const raw = input.trim();
  const normalized = normalizeAgentNameInput(raw);
  if (!normalized) return { kind: "ok" };

  // An exact ID match is the DISAMBIGUATED form and is precisely the query that
  // already returns the complete set (190 live, above). Warning on it would fire
  // on the one call that is correct, which is how a warning gets tuned out.
  if (ctx.agents.some((a) => a.id.toLowerCase() === normalized)) return { kind: "ok" };

  const byName = ctx.agents.filter((a) => normalizeAgentNameInput(a.name) === normalized);
  // 0 rows: a free-text or not-yet-registered assignee matches literally and
  // COMPLETELY — nothing is hidden, so there is nothing to warn about. The
  // empty-result "did you mean" warning in the list command covers that case,
  // and it is a different claim. 1 row: resolves cleanly, alias set is exact.
  //
  // An empty roster also lands here, which is deliberate: the roster fetch
  // degrades to [] when the store cannot be read (assignee-context.ts), and
  // every name then looks unambiguous. Emitting nothing is the only honest
  // option — the same reasoning that suppresses the sibling warning when
  // `ctx.degraded` is set.
  if (byName.length <= 1) return { kind: "ok" };

  const ids = byName.map((a) => a.id).sort();
  return {
    kind: "ambiguous",
    candidates: byName,
    message:
      `'${raw}' names ${byName.length} registered agents (${ids.join(", ")}), so this result is INCOMPLETE — ` +
      `rows whose assignee was stored as one of the other ids are missing from it. ` +
      `Re-run with an agent ID instead to get that agent's full queue.`,
  };
}

/**
 * The canonical declarative seat roster, in the `AgentRoster` format shipped
 * by `@hasna/identities`. `identities` has no built-in path for it — every
 * consumer passes `--roster <file>` — so the path is config here, not a
 * constant baked into a code path.
 */
export function defaultSeatRosterPath(): string {
  return (
    env.seatRosterPath() ||
    join(homedir(), ".hasna", "identities", "hasna-seats.roster.json")
  );
}

/**
 * Read seat slugs out of the roster file.
 *
 * Returns an EMPTY SET on a missing or malformed roster, and never throws. The
 * roster is a station-local file that does not exist inside an e2b sandbox or
 * a cloud runner, and a validator that refused every assignment when it could
 * not find its config would be a worse defect than the one it fixes. The cost
 * of degrading is bounded and stated: without the roster the seat check is
 * skipped, while the unknown-agent and ambiguous-name checks still apply.
 */
export function loadSeatSlugs(path: string = defaultSeatRosterPath()): Set<string> {
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8")) as { agents?: Array<{ slug?: unknown }> };
    const slugs = new Set<string>();
    for (const agent of parsed.agents ?? []) {
      if (typeof agent?.slug === "string" && agent.slug.trim()) {
        slugs.add(normalizeAgentNameInput(agent.slug));
      }
    }
    return slugs;
  } catch {
    return new Set<string>();
  }
}

/**
 * Resolve and validate an `--assign` value.
 *
 * Accepts either an agent name (case-insensitive) or an agent ID. An ID is
 * resolved to its name first, so that passing a seat's ID is caught by the
 * seat rule exactly as passing its slug is.
 */
export function validateAssignee(input: string, ctx: AssigneeContext): AssigneeVerdict {
  const raw = input.trim();
  const normalized = normalizeAgentNameInput(raw);

  if (!normalized) {
    return {
      ok: true,
      assignee: raw,
      isSeat: false,
      warning: "Assignee is empty. Use --unassigned to file this deliberately with no owner.",
    };
  }

  // An exact ID match wins: it is the unambiguous form, and it is how a caller
  // disambiguates a name that several agents share.
  const byId = ctx.agents.find((a) => a.id.toLowerCase() === normalized);
  const byName = ctx.agents.filter((a) => normalizeAgentNameInput(a.name) === normalized);

  // The effective name is what the roster is checked against. A seat may have
  // NO agent row at all — `agent-chief-engineering` is a live seat with no row
  // in this store — so the raw input has to stand in when nothing resolves.
  const effectiveName = byId ? normalizeAgentNameInput(byId.name) : normalized;

  if (ctx.seats.has(effectiveName)) {
    if (ctx.allowSeat) {
      return { ok: true, assignee: byId ? byId.name : raw, agentId: byId?.id, isSeat: true };
    }
    const hint = ctx.seatHint?.(raw);
    return {
      ok: false,
      reason: "seat",
      message:
        `'${raw}' is a durable SEAT, and a task assigned to a seat is assigned to nobody — no session is watching that queue. ` +
        `Assign a specific agent, use --unassigned to file it with no owner on purpose, or repeat the command with --assign-seat added to confirm the seat is deliberate` +
        (hint ? `: ${hint}` : " (see --help for this command's exact form)."),
    };
  }

  if (byId) {
    return { ok: true, assignee: byId.name, agentId: byId.id, isSeat: false };
  }

  if (byName.length === 0) {
    // Allowed on purpose — see the note on AssigneeVerdict. Routing work to an
    // agent that registers later is legitimate; this only makes a typo visible
    // instead of silent, which is what let repo names and bare task ids
    // become assignees on 44 live rows.
    return {
      ok: true,
      assignee: raw,
      isSeat: false,
      warning:
        `No agent named '${raw}' is registered yet. If that is a typo the task is now routed to nobody — ` +
        `check with 'todos agents'.`,
    };
  }

  if (byName.length > 1) {
    const ids = byName.map((a) => a.id).sort();
    return {
      ok: false,
      reason: "ambiguous",
      message:
        `'${raw}' names ${byName.length} registered agents (${ids.join(", ")}), so assigning by name would pick one at random — ` +
        `which is how a task lands on a stranger. Pass the agent ID instead.`,
      candidates: byName,
    };
  }

  return { ok: true, assignee: byName[0]!.name, agentId: byName[0]!.id, isSeat: false };
}
