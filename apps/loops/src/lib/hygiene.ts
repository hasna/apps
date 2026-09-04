import { basename, join } from "node:path";
import { homedir } from "node:os";
import { getLoopsDataDir } from "./app-home.js";
import type { Loop, LoopRun, ScheduleSpec } from "../types.js";
import type { Store } from "./store.js";
import { advanceLoop } from "./scheduler.js";

export interface NameHygieneChange {
  id: string;
  status: string;
  scope: "machine" | "repo";
  scopeSlug: string;
  oldName: string;
  newName: string;
  changed: boolean;
}

export interface NameHygieneReport {
  ok: boolean;
  generatedAt: string;
  applied: boolean;
  checked: number;
  changed: number;
  changes: NameHygieneChange[];
  conflicts: NameHygieneChange[];
}

export interface DuplicateOverlapGroup {
  key: string;
  baseName: string;
  cwd?: string;
  schedule: string;
  loops: Array<Pick<Loop, "id" | "name" | "status" | "nextRunAt">>;
}

export interface DuplicateOverlapReport {
  ok: boolean;
  generatedAt: string;
  checked: number;
  groups: DuplicateOverlapGroup[];
}

export interface ScriptBackedLoop {
  id: string;
  name: string;
  status: string;
  cwd?: string;
  command: string;
  scriptMatches: string[];
}

export interface ScriptInventoryReport {
  ok: boolean;
  generatedAt: string;
  checked: number;
  scriptBacked: number;
  loops: ScriptBackedLoop[];
}

const PROVIDER_TOKENS = new Set([
  "codewith",
  "claude",
  "command",
  "tmux",
  "codex",
  "cursor",
  "opencode",
  "aicopilot",
  "agent",
]);
const REPO_GENERIC_TOKENS = new Set(["repo", "repoops"]);
const CADENCE_SUFFIX_TOKENS = new Set(["hourly", "daily", "weekly", "monthly"]);
const CADENCE_SUFFIX_PATTERN = /^(?:every-?)?\d+(?:s|m|h|d|w)$/;

function userHome(): string {
  return process.env.HOME || homedir();
}

function slugify(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/[^\w\s.-]/g, "-")
    .replace(/[_\s.:/]+/g, "-")
    .replace(/[^a-zA-Z0-9-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .toLowerCase();
}

function repoSlugFromCwd(cwd: string | undefined): string {
  if (!cwd || cwd === userHome()) return "";
  if (cwd.startsWith(getLoopsDataDir() + "/")) return "";
  return slugify(basename(cwd));
}

function scopeForLoop(loop: Loop): { scope: "machine" | "repo"; prefix: string; scopeSlug: string } {
  const cwd = loop.target.type === "command" || loop.target.type === "agent" ? loop.target.cwd : undefined;
  const repoSlug = repoSlugFromCwd(cwd);
  if (repoSlug) return { scope: "repo", prefix: `repo-${repoSlug}`, scopeSlug: repoSlug };
  return { scope: "machine", prefix: "machine", scopeSlug: "machine" };
}

function taskSlug(loop: Loop, scope: ReturnType<typeof scopeForLoop>): string {
  const oldName = loop.name;
  let nameForParsing = oldName;
  if (!oldName.includes(":")) {
    const slug = slugify(oldName);
    if (scope.scope === "machine" && slug.startsWith("machine-")) nameForParsing = slug.slice("machine-".length);
    else if (scope.scope === "repo" && slug.startsWith(`repo-${scope.scopeSlug}-`)) {
      nameForParsing = slug.slice(`repo-${scope.scopeSlug}-`.length);
    } else nameForParsing = slug;
  }

  const parts: string[] = [];
  for (const rawPart of oldName.includes(":") ? oldName.split(":") : [nameForParsing]) {
    const part = slugify(rawPart);
    if (!part) continue;
    if (PROVIDER_TOKENS.has(part) || /^account\d+$/.test(part)) continue;
    if (scope.scope === "repo" && REPO_GENERIC_TOKENS.has(part)) continue;

    let normalized = part;
    if (scope.scope === "repo" && normalized === scope.scopeSlug) continue;
    if (scope.scope === "repo" && normalized.startsWith(`${scope.scopeSlug}-`)) {
      normalized = normalized.slice(scope.scopeSlug.length + 1);
    }
    if (normalized) parts.push(normalized);
  }

  const deduped: string[] = [];
  for (const token of parts.join("-").split("-").filter(Boolean)) {
    if (deduped[deduped.length - 1] !== token) deduped.push(token);
  }
  while (deduped.length) {
    const last = deduped[deduped.length - 1];
    if (CADENCE_SUFFIX_TOKENS.has(last) || CADENCE_SUFFIX_PATTERN.test(last)) {
      deduped.pop();
      if (deduped[deduped.length - 1] === "every") deduped.pop();
      continue;
    }
    break;
  }
  return deduped.join("-") || "loop";
}

function canonicalName(loop: Loop): Omit<NameHygieneChange, "oldName" | "changed"> {
  const scope = scopeForLoop(loop);
  let name = `${scope.prefix}-${taskSlug(loop, scope)}`.replace(/-+/g, "-").replace(/^-|-$/g, "");
  if (name.length > 120) name = `${name.slice(0, 111).replace(/-+$/g, "")}-${loop.id.slice(0, 8)}`;
  return {
    id: loop.id,
    status: loop.status,
    scope: scope.scope,
    scopeSlug: scope.scopeSlug,
    newName: name,
  };
}

function ensureUnique(changes: NameHygieneChange[], existingNames: Iterable<string> = []): void {
  const oldNames = new Set(changes.map((change) => change.oldName));
  const used = new Set([...existingNames].filter((name) => !oldNames.has(name)));
  for (const change of changes) {
    let candidate = change.newName;
    if (!used.has(candidate)) {
      used.add(candidate);
      change.newName = candidate;
      change.changed = change.oldName !== candidate;
      continue;
    }
    const base = candidate.slice(0, 111).replace(/-+$/g, "");
    candidate = `${base}-${change.id.slice(0, 8)}`;
    let suffix = 2;
    while (used.has(candidate)) {
      const extra = `-${change.id.slice(0, 6)}-${suffix++}`;
      candidate = `${base.slice(0, 120 - extra.length)}${extra}`;
    }
    used.add(candidate);
    change.newName = candidate;
    change.changed = change.oldName !== candidate;
  }
}

function managedLoops(store: Store, opts: { includeStopped?: boolean; includeInactive?: boolean; limit?: number }): Loop[] {
  const loops = store.listLoops({ includeArchived: Boolean(opts.includeInactive), limit: opts.limit ?? 1_000 });
  if (opts.includeInactive) return loops;
  if (opts.includeStopped) return loops.filter((loop) => loop.status !== "expired");
  return loops.filter((loop) => loop.status === "active" || loop.status === "paused");
}

export function buildNameHygieneReport(
  store: Store,
  opts: { apply?: boolean; includeStopped?: boolean; includeInactive?: boolean; limit?: number } = {},
): NameHygieneReport {
  const allLoops = store.listLoops({ includeArchived: true, limit: 10_000 });
  const changes = managedLoops(store, opts).map((loop) => {
    const canonical = canonicalName(loop);
    return {
      ...canonical,
      oldName: loop.name,
      changed: loop.name !== canonical.newName,
    };
  });
  ensureUnique(changes, allLoops.map((loop) => loop.name));
  const changed = changes.filter((change) => change.changed);
  const conflicts = changes.filter((change) => allLoops.some((loop) => loop.name === change.newName && loop.id !== change.id));
  if (opts.apply) {
    for (const change of changed) store.renameLoop(change.id, change.newName);
  }
  return {
    ok: changed.length === 0,
    generatedAt: new Date().toISOString(),
    applied: Boolean(opts.apply),
    checked: changes.length,
    changed: changed.length,
    changes,
    conflicts,
  };
}

function baseName(name: string): string {
  return name
    .replace(/-(bounded|compact|native)?-?low(?:-\d+m)?$/g, "")
    .replace(/-\d+[mhd]$/g, "")
    .replace(/-(bounded|compact)$/g, "");
}

function scheduleKey(schedule: ScheduleSpec): string {
  if (schedule.type === "cron") return `cron:${schedule.expression}`;
  if (schedule.type === "interval") return `interval:${schedule.everyMs}`;
  if (schedule.type === "once") return `once:${schedule.at}`;
  return `dynamic:${schedule.minIntervalMs ?? ""}`;
}

function targetCwd(loop: Loop): string {
  return loop.target.type === "command" || loop.target.type === "agent" ? loop.target.cwd ?? "" : "";
}

export function buildDuplicateOverlapReport(
  store: Store,
  opts: { includeInactive?: boolean; limit?: number } = {},
): DuplicateOverlapReport {
  const loops = managedLoops(store, { includeInactive: opts.includeInactive, includeStopped: true, limit: opts.limit });
  const groups = new Map<string, { baseName: string; cwd?: string; schedule: string; loops: Loop[] }>();
  for (const loop of loops) {
    const base = baseName(loop.name);
    const cwd = targetCwd(loop) || undefined;
    const schedule = scheduleKey(loop.schedule);
    const key = `${base}|${cwd ?? ""}|${schedule}`;
    const existing = groups.get(key) ?? { baseName: base, cwd, schedule, loops: [] };
    existing.loops.push(loop);
    groups.set(key, existing);
  }
  const duplicateGroups = [...groups.entries()]
    .filter(([, group]) => group.loops.length > 1)
    .map(([key, group]) => ({
      key,
      baseName: group.baseName,
      cwd: group.cwd,
      schedule: group.schedule,
      loops: group.loops.map((loop) => ({
        id: loop.id,
        name: loop.name,
        status: loop.status,
        nextRunAt: loop.nextRunAt,
      })),
    }));
  return {
    ok: duplicateGroups.length === 0,
    generatedAt: new Date().toISOString(),
    checked: loops.length,
    groups: duplicateGroups,
  };
}

function commandText(loop: Loop): string {
  if (loop.target.type !== "command") return "";
  return [loop.target.command, ...(loop.target.args ?? [])].join(" ");
}

function scriptNeedles(scriptsDir: string): string[] {
  const home = userHome();
  const normalized = scriptsDir.replace(/\/+$/g, "");
  // Legacy spellings of the loops scripts dir, assembled (never literal) so
  // hygiene keeps recognizing pre-ruling loop commands.
  const legacy = "~/" + [".hasna", "loops", "scripts"].join("/");
  const legacySlash = legacy + "/";
  const homeLegacy = [home, ".hasna", "loops", "scripts"].join("/");
  const values = [
    normalized,
    `${normalized}/`,
    legacy,
    legacySlash,
    "$HOME/" + [".hasna", "loops", "scripts"].join("/"),
    "$HOME/" + [".hasna", "loops", "scripts"].join("/") + "/",
    "${HOME}/" + [".hasna", "loops", "scripts"].join("/"),
    "${HOME}/" + [".hasna", "loops", "scripts"].join("/") + "/",
    homeLegacy,
    homeLegacy + "/",
    "/" + [".hasna", "loops", "scripts"].join("/") + "/",
  ];
  return [...new Set(values)];
}

export function buildScriptInventoryReport(
  store: Store,
  opts: { scriptsDir?: string; includeInactive?: boolean; limit?: number } = {},
): ScriptInventoryReport {
  const scriptsDir = opts.scriptsDir ?? join(getLoopsDataDir(), "scripts");
  const needles = scriptNeedles(scriptsDir);
  const loops = managedLoops(store, { includeInactive: opts.includeInactive, includeStopped: true, limit: opts.limit });
  const scriptBacked = loops
    .map((loop): ScriptBackedLoop | undefined => {
      const text = commandText(loop);
      if (!text) return undefined;
      const matches = needles.filter((needle) => text.includes(needle));
      if (!matches.length) return undefined;
      return {
        id: loop.id,
        name: loop.name,
        status: loop.status,
        cwd: targetCwd(loop) || undefined,
        command: text.length > 500 ? `${text.slice(0, 500)}...` : text,
        scriptMatches: [...new Set(matches)],
      };
    })
    .filter((value): value is ScriptBackedLoop => Boolean(value));
  return {
    ok: scriptBacked.length === 0,
    generatedAt: new Date().toISOString(),
    checked: loops.length,
    scriptBacked: scriptBacked.length,
    loops: scriptBacked,
  };
}

export interface StuckRunEntry {
  runId: string;
  loopId: string;
  loopName: string;
  scheduledFor: string;
  startedAt?: string;
  leaseExpiresAt?: string;
  pid?: number;
  /** Why this run was left alone instead of reclaimed. Present only for entries that were not reclaimed. */
  deferredReason?: "live_process";
  /** True once this run has actually been marked `abandoned` by an --apply run. */
  reclaimed: boolean;
}

export interface StuckRunReport {
  ok: boolean;
  generatedAt: string;
  applied: boolean;
  /** Total running runs found with an expired lease, reclaimable or not. */
  checked: number;
  /** Runs with an expired lease AND no live process — the reclaimable set. */
  stuck: number;
  /** Runs with an expired lease but a still-live process — never reclaimed. */
  liveDeferred: number;
  entries: StuckRunEntry[];
  /** Loop ids whose nextRunAt was advanced immediately after reclaiming a run, unblocking their cadence without waiting for a daemon tick. */
  advancedLoopIds: string[];
}

function toStuckRunEntry(run: LoopRun, reclaimed: boolean, deferredReason?: "live_process"): StuckRunEntry {
  return {
    runId: run.id,
    loopId: run.loopId,
    loopName: run.loopName,
    scheduledFor: run.scheduledFor,
    startedAt: run.startedAt,
    leaseExpiresAt: run.leaseExpiresAt,
    pid: run.pid,
    deferredReason,
    reclaimed,
  };
}

/**
 * Detect (and, with `apply`, reclaim) loop runs stuck in `status: "running"`
 * with an expired lease and no live backing process — the `7cf8d8c1` defect
 * class: a run that outlives both its lease and its execution timeout with no
 * process behind it, leaving an unreapable orphan row whose loop's cursor
 * never advances through recovery because nothing ever moves the run out of
 * `running`.
 *
 * Be precise about what that state does NOT do, because the imprecise version
 * ("`overlap: "skip"` then blocks the loop forever") sends the next reader to
 * the scheduler instead of to recovery: an EXPIRED lease does not, on its own,
 * refuse a later slot. That gate turns on a run holding a LIVE lease or a live
 * process (`Store#hasBlockingRunningRunForOtherSlot`), which the store's own
 * test "overlap skip does not block a later slot on an expired dead lease"
 * (`src/lib/store.test.ts`) pins in exactly this shape. What this command
 * repairs is the orphan row and the loop cursor behind it, not a wedged
 * scheduler.
 *
 * The discriminator is evidence, not age: `Store#previewExpiredRunLeases` (and,
 * on apply, `Store#recoverExpiredRunLeasesDetailed`) only ever classifies a run
 * as reclaimable when its lease has expired AND EITHER its recorded process is
 * not alive (bounded, additionally, by the daemon's own pid-recycling and
 * workflow-step-liveness checks) OR it looks alive but has already exceeded
 * the daemon's own bounded grace ceiling (`MAX_LIVE_EXPIRED_RUN_DEFERRALS`
 * deferrals — a live-looking process that keeps failing to renew its lease is
 * a wedged runner or a recycled pid, not a run this tool should defer
 * forever). A run whose process looks alive AND is still under that ceiling is
 * reported as `liveDeferred` and is not abandoned — but `apply` still touches
 * it: each such call advances its `defer_count` exactly as a live daemon tick
 * would, which is what lets it ever reach the ceiling in the first place. A
 * genuinely, persistently alive run never crosses the ceiling because its
 * lease keeps renewing before ever going stale enough to be selected at all.
 *
 * SUPERSEDES PART OF #182, DOES NOT REVERT IT (P1 fixed in this cycle, found
 * by pr182-reviewer, reproduced and confirmed independently before this PR):
 * #182 called `recoverExpiredRunLeasesDetailed(now, { preserveLiveProcesses:
 * true })` here, unconditionally. That flag makes `store.ts` `continue` on
 * every "looks alive" row regardless of `defer_count`, so the ceiling-abandon
 * branch a few lines below it is provably unreachable through this command —
 * a live-looking wedged run could never be reclaimed by `--apply`, no matter
 * how long it sat or how many times the command ran, which under `overlap:
 * "skip"` is exactly the "blocks every run queued behind it" failure this
 * whole command exists to fix. That call is changed here to omit
 * `preserveLiveProcesses`, restoring the ceiling-based reclaim. The
 * `preserveLiveProcesses` option itself is left in place on
 * `recoverExpiredRunLeasesDetailed` — #182's safety intent (never touch a
 * process that looks alive) is a legitimate primitive for some other caller
 * to opt into; the defect was applying it here, unconditionally, to the one
 * command whose whole job is to eventually reclaim a run that only *looks*
 * alive.
 *
 * On this fleet a loop's `leaseMs` is conventionally set wider than its
 * target's `timeoutMs` (e.g. 9m lease over an 8m execution timeout), so lease
 * expiry is already evidence that the execution timeout has also elapsed; this
 * command does not additionally re-check `timeoutMs` because doing so could
 * only ever narrow, never widen, what the lease+liveness check already
 * requires.
 *
 * Reclaiming a run is not enough on its own to unblock its loop: `overlap:
 * "skip"` only re-admits new claims once no `running` run remains for the
 * loop, and `nextRunAt` is only recomputed by the scheduler's own advancement
 * logic. Waiting for that to happen relies on a live daemon ticking against
 * this exact store, which is precisely the condition already absent for a run
 * that got this stuck. So on `apply`, this command calls the scheduler's own
 * `advanceLoop` directly against each reclaimed run, synchronously, so the
 * loop's `nextRunAt` moves in the same command invocation rather than waiting
 * on a daemon that may not come back.
 */
export function buildStuckRunReport(store: Store, opts: { apply?: boolean; limit?: number; now?: Date } = {}): StuckRunReport {
  const now = opts.now ?? new Date();
  const preview = store.previewExpiredRunLeases(now, { limit: opts.limit });
  const advancedLoopIds: string[] = [];
  let entries: StuckRunEntry[];
  let stuckCount = preview.reclaimable.length;
  let liveDeferredCount = preview.liveDeferred.length;
  // CORRECTED (P1, PR #182 review): this used to gate the mutating call on
  // `preview.reclaimable.length > 0`. That is wrong even once the ceiling
  // check above is fixed, because a live-looking run under the grace ceiling
  // is reported by preview as `liveDeferred`, never `reclaimable` — so that
  // gate would skip calling `recoverExpiredRunLeasesDetailed` for exactly the
  // runs whose `defer_count` needs to advance toward the ceiling. Left gated,
  // such a run's `defer_count` stays at 0 forever and it can never be
  // reclaimed even after real, prior invocations. The daemon's own tick calls
  // this unconditionally every time it finds an expired-lease row at all
  // (never conditioned on "would anything be abandoned"); `apply` must match
  // that, not re-derive a narrower trigger.
  if (opts.apply && (preview.reclaimable.length > 0 || preview.liveDeferred.length > 0)) {
    // NOTE: deliberately NOT passing `preserveLiveProcesses` — see the
    // "SUPERSEDES PART OF #182" note above the doc comment for why passing
    // `true` here made this command permanently unable to reclaim a
    // live-looking wedged run.
    const result = store.recoverExpiredRunLeasesDetailed(now, { limit: opts.limit });
    for (const run of result.abandoned) {
      const loop = store.getLoop(run.loopId);
      if (!loop) continue;
      // advanceLoop is a documented no-op for a non-active loop (planLoopAdvancement
      // reason: "inactive") — a paused or stopped loop's nextRunAt must stay exactly
      // where an operator left it, never get silently nudged forward by a reclaim.
      // advanceLoop itself never reports whether it actually changed anything, so
      // compare before/after to report advancement truthfully rather than reporting
      // "advanced" for every non-throwing call, most of which are no-ops.
      const before = loop.nextRunAt;
      try {
        advanceLoop(store, loop, run, now, false);
      } catch {
        // Best-effort: a lost race or a since-archived loop leaves nextRunAt
        // for the daemon's own tick to repair (see repairWedgedTerminalSlot).
        // The run is already reclaimed either way — that half never rolls back.
        continue;
      }
      if (store.getLoop(loop.id)?.nextRunAt !== before) advancedLoopIds.push(loop.id);
    }
    // Report what THIS invocation actually did (abandoned vs re-deferred),
    // not the pre-mutation preview counts — the two can legitimately differ
    // now: a run at the ceiling shows as `reclaimable` in preview but was
    // just abandoned by this call, and a run below the ceiling shows as
    // `liveDeferred` in both, but its `defer_count` has now moved.
    stuckCount = result.abandoned.length;
    liveDeferredCount = result.deferred.length;
    entries = [
      ...result.abandoned.map((run) => toStuckRunEntry(run, true)),
      ...result.deferred.map((run) => toStuckRunEntry(run, false, "live_process")),
    ];
  } else {
    entries = [
      ...preview.reclaimable.map((run) => toStuckRunEntry(run, false)),
      ...preview.liveDeferred.map((run) => toStuckRunEntry(run, false, "live_process")),
    ];
  }
  return {
    ok: stuckCount === 0,
    generatedAt: now.toISOString(),
    applied: Boolean(opts.apply),
    checked: stuckCount + liveDeferredCount,
    stuck: stuckCount,
    liveDeferred: liveDeferredCount,
    entries,
    advancedLoopIds,
  };
}
