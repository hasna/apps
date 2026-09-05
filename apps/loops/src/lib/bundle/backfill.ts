/**
 * The revision-1 backfill for legacy bundled loops (hasna/apps#1724 §11 P3).
 *
 * A loop that predates bundles is a row with no version history: nothing in
 * `loop_revisions` names it, and — for command and agent loops — no object
 * anywhere holds its definition. `POST /v1/loops/{id}/versions` closes that
 * gap one loop at a time from a client-supplied bundle; the one-shot
 * `loops-serve backfill-revisions` job closes it for every existing loop at
 * once, from the rows themselves.
 *
 * For every loop that can be named and has no revision yet, the job appends
 * revision 1 exactly the way the push route would:
 *
 *   1. project the row to `loop.json` (`loopToDefinition`),
 *   2. pack it as a one-file bundle (`loop.json`, mode 0600),
 *   3. write the archive + manifest + `latest.json` through the artifact
 *      storage, and
 *   4. record the ledger row with `createLoopRevision` — the same append-only
 *      insert the push route uses, allocating version 1 under the row lock.
 *
 * Naming follows the bundle-name contract, never an invention: a loop that
 * already has a `bundle_name` keeps it; otherwise the loop's `name` is used
 * when it satisfies `assertBundleName` and no OTHER loop in the tenant already
 * holds it. Unnameable loops are skipped and reported, never guessed.
 *
 * Idempotence and resumability fall out of the ledger: a loop that already has
 * any revision is skipped, so rerunning the job after a crash (or after a
 * partial `--limit` run) is a no-op for everything it already backfilled. The
 * job is written against the storage CONTRACT rather than raw SQL so the
 * SQLite store and the hosted Postgres control plane run the same code.
 *
 * Prompt policy matches the push route: an agent prompt is carried in the
 * bundle (it is the only round trip), `carriesPrompt` is derived server-side,
 * and anything that fails the credential scan is refused — a skipped loop,
 * never a published secret.
 */
import type { Loop, LoopTarget } from "../../types.js";
import type { LoopStorageContract } from "../storage/contract.js";
import { BundleArtifactStorage } from "./artifact-storage.js";
import {
  definitionCarriesPrompt,
  loopToDefinition,
  serializeDefinition,
  buildManifest,
} from "./local.js";
import { assertBundleName, BundleIntegrityError, LOOP_JSON_FILE, MODE_DATA, sha256Hex } from "./manifest.js";
import { assertNoCredentials, manifestFilesFor, ownBytes, writeTar, type BundleEntry } from "./pack.js";

/** The zstd level the push path packs with; a backfilled archive should be byte-identical in kind. */
const BACKFILL_ZSTD_LEVEL = 10;

/** Processing cohorts, ordered by the P3 plan: hygiene-flagged script-backed loops first. */
export type RevisionBackfillCohort = "scriptBacked" | "command" | "agent" | "workflow";

/** The P3 processing order. The script-backed cohort is the portability-priority set. */
export const REVISION_BACKFILL_COHORT_ORDER: readonly RevisionBackfillCohort[] = [
  "scriptBacked",
  "command",
  "agent",
  "workflow",
];

/**
 * Literal spellings of the legacy station-local scripts directory
 * (`~/.hasna/loops/scripts`) that `loops hygiene scripts` flags. The hygiene
 * report builds the same list from the local home; this is the stable,
 * home-independent subset a server-side job can match — `$HOME` and the real
 * expanded home are all text in the command string, so a loop referencing the
 * legacy directory is un-portable regardless of whose home it names.
 */
const LEGACY_SCRIPTS_NEEDLES: readonly string[] = [
  "~/.hasna/loops/scripts",
  "$HOME/.hasna/loops/scripts",
  "${HOME}/.hasna/loops/scripts",
  "<home>/.hasna/loops/scripts",
  // Subsumes the trailing-slash spelling AND any real expanded home: the home
  // directory itself is unknown server-side, but however it is spelled the
  // legacy directory always surfaces as a path containing this substring.
  "/.hasna/loops/scripts",
];

/**
 * Which backfill cohort a loop belongs to.
 *
 * `undefined` means the loop's target cannot be bundled at all and the loop is
 * skipped as unclassifiable rather than guessed at.
 */
export function classifyRevisionBackfillCohort(loop: Loop): RevisionBackfillCohort | undefined {
  const target = loop.target as LoopTarget | undefined;
  if (!target || typeof target !== "object") return undefined;
  if (target.type === "agent") return "agent";
  if (target.type === "workflow") return "workflow";
  if (target.type !== "command") return undefined;
  const text = [target.command, ...(target.args ?? [])]
    .filter((part): part is string => typeof part === "string")
    .join("\n");
  return LEGACY_SCRIPTS_NEEDLES.some((needle) => text.includes(needle)) ? "scriptBacked" : "command";
}

function cohortRank(cohort: RevisionBackfillCohort | undefined): number {
  if (cohort === undefined) return Number.MAX_SAFE_INTEGER;
  return REVISION_BACKFILL_COHORT_ORDER.indexOf(cohort);
}

/** Why a loop was not (or not yet) backfilled. */
export type RevisionBackfillSkipReason =
  | "archived"
  | "alreadyBackfilled"
  | "nameUnsafe"
  | "nameTaken"
  | "containsSecret"
  | "unclassifiable";

export interface RevisionBackfillAttempt {
  loopId: string;
  loopName: string;
  cohort?: RevisionBackfillCohort;
  outcome: "created" | "wouldCreate" | "skipped";
  skipReason?: RevisionBackfillSkipReason;
  bundleName?: string;
  version?: number;
  bundleDigest?: string;
  archiveSha256?: string;
  carriesPrompt?: boolean;
  detail?: string;
}

export interface RevisionBackfillContext {
  storage: LoopStorageContract;
  artifacts: BundleArtifactStorage;
  /** Structural S3/local key segment; the sqlite store has no tenant, tests pass a label. */
  tenantId: string;
  /** True: classify, name and digest, but write nothing anywhere. */
  dryRun: boolean;
  author: string;
  reason: string;
  sourceStation?: string;
  sourceAgent?: string;
  now?: () => Date;
}

export interface RevisionBackfillResult {
  attempts: RevisionBackfillAttempt[];
  created: number;
  wouldCreate: number;
  skipped: Record<string, number>;
}

function emptyResult(): RevisionBackfillResult {
  return { attempts: [], created: 0, wouldCreate: 0, skipped: {} };
}

function recordSkipped(result: RevisionBackfillResult, attempt: RevisionBackfillAttempt): void {
  const reason = attempt.skipReason ?? "unknown";
  result.skipped[reason] = (result.skipped[reason] ?? 0) + 1;
}

/**
 * Every non-archived loop in the tenant, in P3 processing order.
 *
 * `listLoops` already excludes archived loops by default; an archived loop
 * keeps whatever history it has and is not a backfill candidate.
 */
export async function collectRevisionBackfillCandidates(storage: LoopStorageContract): Promise<Loop[]> {
  const all: Loop[] = [];
  const pageSize = 200;
  for (let offset = 0; ; offset += pageSize) {
    const page = await storage.listLoops({ limit: pageSize, offset });
    all.push(...page);
    if (page.length < pageSize) break;
  }
  return all.sort((a, b) => {
    const byCohort = cohortRank(classifyRevisionBackfillCohort(a)) - cohortRank(classifyRevisionBackfillCohort(b));
    if (byCohort !== 0) return byCohort;
    const byName = a.name < b.name ? -1 : a.name > b.name ? 1 : 0;
    if (byName !== 0) return byName;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });
}

function skipped(loop: Loop, cohort: RevisionBackfillCohort | undefined, reason: RevisionBackfillSkipReason, detail?: string): RevisionBackfillAttempt {
  return {
    loopId: loop.id,
    loopName: loop.name,
    ...(cohort === undefined ? {} : { cohort }),
    outcome: "skipped",
    skipReason: reason,
    ...(detail === undefined ? {} : { detail }),
  };
}

/**
 * Backfill ONE loop: revision 1 with its current definition.
 *
 * Every skip is decided BEFORE anything is written, so a skip can never be
 * rolled back out from under an earlier attempt in the same transaction. Any
 * error after the first write is unexpected and propagates — the caller's
 * transaction boundary decides whether earlier attempts in the same batch
 * survive it.
 */
export async function attemptRevisionBackfill(loop: Loop, ctx: RevisionBackfillContext): Promise<RevisionBackfillAttempt> {
  // The caller hands over a snapshot from candidate collection; the row may
  // have moved since (renamed, archived, bundle_name assigned by a push).
  // Decide on the CURRENT row so no decision is made against stale state.
  const current = (await ctx.storage.getLoop(loop.id)) ?? loop;
  const cohort = classifyRevisionBackfillCohort(current);
  if (cohort === undefined) return skipped(current, undefined, "unclassifiable");
  if (current.archivedAt) return skipped(current, cohort, "archived");
  // Idempotence: a loop with ANY revision is not a legacy loop any more.
  if (await ctx.storage.latestLoopRevision(current.id)) return skipped(current, cohort, "alreadyBackfilled");

  const explicitName = current.bundleName?.trim() || "";
  const rawName = explicitName || current.name;
  let bundleName: string;
  try {
    bundleName = assertBundleName(rawName);
  } catch (error) {
    return skipped(
      current,
      cohort,
      "nameUnsafe",
      error instanceof Error ? error.message : `'${rawName}' is not a valid bundle name`,
    );
  }
  if (!explicitName) {
    const holder = await ctx.storage.findLoopByBundleName(bundleName);
    if (holder && holder.id !== current.id) {
      return skipped(current, cohort, "nameTaken", `bundle name '${bundleName}' already belongs to loop ${holder.id}`);
    }
  }

  const definition = loopToDefinition(current);
  const carriesPrompt = definitionCarriesPrompt(definition);
  const loopBytes = new TextEncoder().encode(serializeDefinition(definition));
  const entries: BundleEntry[] = [{ path: LOOP_JSON_FILE, bytes: ownBytes(loopBytes), mode: MODE_DATA }];
  try {
    // The same scan the push route runs server-side: an immutable object is
    // what everyone else will read, so a row whose definition looks like a
    // credential is skipped and reported, never published.
    assertNoCredentials(entries);
  } catch (error) {
    if (error instanceof BundleIntegrityError && error.code === "BUNDLE_CONTAINS_SECRET") {
      return skipped(current, cohort, "containsSecret", "loop definition looks like it contains credential material");
    }
    throw error;
  }

  const files = manifestFilesFor(entries);
  const archive = ownBytes(Bun.zstdCompressSync(writeTar(entries), { level: BACKFILL_ZSTD_LEVEL }));
  const archiveSha256 = sha256Hex(archive);
  const now = ctx.now ?? (() => new Date());
  const manifest = buildManifest({
    name: bundleName,
    loopId: current.id,
    version: 1,
    files,
    archiveSha256,
    carriesPrompt,
    reason: ctx.reason,
    station: ctx.sourceStation,
    agent: ctx.sourceAgent,
    now: now(),
  });

  if (ctx.dryRun) {
    return {
      loopId: current.id,
      loopName: current.name,
      cohort,
      outcome: "wouldCreate",
      bundleName,
      bundleDigest: manifest.bundleDigest,
      archiveSha256,
      carriesPrompt,
    };
  }

  const revision = await ctx.storage.createLoopRevision(
    {
      loopId: current.id,
      bundleName,
      bundleDigest: manifest.bundleDigest,
      archiveSha256,
      archiveBytes: archive.byteLength,
      storageKind: ctx.artifacts.storageKind,
      // Recorded BEFORE the object exists, and built from the version the
      // insert actually allocated — the same order the push route uses, so a
      // crash leaves a diagnosable row, never an unreferenced object.
      storageKeyFor: (version) => ctx.artifacts.placement(ctx.tenantId, bundleName, version).storageKey,
      manifest: { ...manifest, carriesPrompt },
      loopJson: definition,
      carriesPrompt,
      author: ctx.author,
      sourceStation: ctx.sourceStation,
      sourceAgent: ctx.sourceAgent,
      reason: ctx.reason,
    },
    { now: now() },
  );
  // The legacy contract is "revision 1 or nothing": this loop had no revision
  // a moment ago (guarded above), so anything but 1 means a concurrent push
  // raced us between the guard and the insert. Appending version 2 from a
  // stale row would pollute the history the push just started; the caller's
  // transaction boundary rolls the whole batch back and the rerun skips the
  // loop, because the push's revision 1 is now visible.
  if (revision.version !== 1) {
    throw new Error(
      `backfill race: concurrent push allocated ${current.id}@${revision.version} before the backfill could; batch rolled back, rerun to skip`,
    );
  }

  await ctx.artifacts.putVersion(ctx.tenantId, bundleName, revision.version, archive, {
    ...manifest,
    carriesPrompt,
    version: revision.version,
  });
  await ctx.artifacts.putLatest(ctx.tenantId, bundleName, {
    version: revision.version,
    bundleDigest: revision.bundleDigest,
    archiveSha256: revision.archiveSha256,
    updatedAt: now().toISOString(),
  });

  return {
    loopId: current.id,
    loopName: current.name,
    cohort,
    outcome: "created",
    bundleName,
    version: revision.version,
    bundleDigest: revision.bundleDigest,
    archiveSha256,
    carriesPrompt,
  };
}

/**
 * Attempt a full pass over a pre-collected candidate list, in order.
 *
 * The caller decides how many loops share one transaction (the hosted job
 * passes one batch per tenant-scoped transaction) and when to stop (the
 * `--limit` accounting lives in the caller, which counts `created` +
 * `wouldCreate` the way a dry run reports a real one).
 */
export async function runRevisionBackfill(ctx: RevisionBackfillContext, loops: readonly Loop[]): Promise<RevisionBackfillResult> {
  const result = emptyResult();
  for (const loop of loops) {
    const attempt = await attemptRevisionBackfill(loop, ctx);
    result.attempts.push(attempt);
    if (attempt.outcome === "created") result.created += 1;
    else if (attempt.outcome === "wouldCreate") result.wouldCreate += 1;
    else recordSkipped(result, attempt);
  }
  return result;
}
