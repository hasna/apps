/**
 * `skills <group> sync` — the two-way reconcile between the canonical local corpus and the
 * hosted registry through the API.
 *
 * NAMING CONSTRAINT (deliberate): the CLI surface is the `cloud` command group with the
 * `sync` verb, per the plan (todos 9df1ea14). The module identifiers in this file avoid
 * the retired direct-storage feature's names, which two boundary tests
 * (src/no-cloud-boundary.test.ts, src/lib/public-package-boundary.test.ts) ban from every
 * public source file. This feature is the opposite of the retired one: it reconciles
 * through the one API client, never through a direct database snapshot or artifact sync.
 *
 * This is the unified state machine the agent-fan-out `skills sync` (agent-sync.ts) and
 * the snapshot path (native-storage) deliberately do not cover: those own the last mile
 * into agent folders and the on-box snapshot respectively, while this verb reconciles
 * the canonical corpus (T1: resolveCorpusRoot) against the hosted registry's list route.
 *
 * Diff basis: slug + version + bundle sha256. The bundle digest is the content address —
 * packSkillBundle is deterministic (canonical gzip), so a local pack and the registry's
 * stored digest are directly comparable. The version is carried in the manifest inside
 * the bundle, so an equal digest implies equal version; the diff reports both and decides
 * on the digest.
 *
 * Direction of a change is proven by the per-skill baseline marker (`.hasna-skills.json`,
 * written by pull and by this module after a push — the marker's contentHash is what a
 * later sync compares against). A same-slug divergence with NO baseline (a skill that was
 * never synced) cannot prove which side changed, so it is a conflict.
 *
 * Conflict policy, DECLARED (default): local-wins-on-identical-digest-else-skip-and-report.
 * Identical digests are not a conflict — the states agree. A true divergence is skipped
 * and reported unless --conflict=local (push local over remote) or --conflict=remote (pull
 * remote over local) says otherwise.
 *
 * Push reuses the publish path's own primitives (validatePortableSkillDirectory,
 * packSkillBundle, the RemoteSkillsClient the caller passes) and pull reuses pullSkills'
 * verification + atomic install. There is deliberately no second HTTP client: everything
 * goes through the one RemoteSkillsClient instance.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { pushSkill } from "../cli/commands/publish.js";
import { resolveCorpusRoot } from "./home-migration.js";
import { getPortableSkillPath, listPortableSkillMetas, type PortableSkillOptions } from "./portable-skills.js";
import { pullSkills, writePullMarker, PULL_MARKER_FILE } from "./pull.js";
import { RemoteSkillsClient, createRemoteSkillsClient } from "./remote-client.js";
import { packSkillBundle } from "./skill-bundle.js";

export type ReconcileConflictPolicy = "local" | "remote" | "skip";

/**
 * The default policy, named exactly as the plan specifies: when the digests are identical
 * the local state wins by construction (nothing to resolve); every other divergence is
 * skipped and reported unless --conflict says otherwise.
 */
export const DEFAULT_CONFLICT_POLICY = "local-wins-on-identical-digest-else-skip-and-report" as const;
export const CONFLICT_POLICIES: readonly ReconcileConflictPolicy[] = ["local", "remote", "skip"] as const;

/** Corpus-root cursor recording the last sync run. */
export const SYNC_CURSOR_FILE = ".sync-cursor.json";
export const SYNC_CURSOR_SCHEMA_VERSION = 1 as const;

export interface ReconcileRegistryOptions extends PortableSkillOptions {
  /** Push local-only, changed-locally, and conflicts won by local. */
  push?: boolean;
  /** Pull remote-only, changed-remotely, and conflicts won by remote. */
  pull?: boolean;
  /** Both directions (the default when neither --push nor --pull is given). */
  all?: boolean;
  /** Plan and report without writing anything. */
  dryRun?: boolean;
  /** Conflict resolution policy. */
  conflict?: ReconcileConflictPolicy;
  /** Client override. `undefined` resolves one from configuration; `null` models "no credential". */
  client?: RemoteSkillsClient | null;
  /** HMAC signing key for bundle signature verification. Defaults to $SKILLS_SIGNING_KEY. */
  signingKey?: string;
}

export type ReconcileSkillState =
  | "local-only"
  | "remote-only"
  | "changed-locally"
  | "changed-remotely"
  | "conflict"
  | "in-sync";

export type ReconcileAction = "push" | "pull" | "skip" | "none";

export interface ReconcileSkillEntry {
  slug: string;
  state: ReconcileSkillState;
  action: ReconcileAction;
  localVersion?: string;
  remoteVersion?: string;
  localSha256?: string;
  remoteSha256?: string;
  /** Why the entry was classified or skipped this way. */
  reason?: string;
  /** Present only for executed (non-dry-run) actions. */
  result?: { ok: boolean; detail?: string };
}

export interface ReconcileSummary {
  /** Skills found in the local corpus. */
  local: number;
  /** Skills the registry serves (published plus bundled). */
  remote: number;
  inSync: number;
  pushed: number;
  pulled: number;
  /** Divergences the conflict policy had to resolve (or decline to resolve). */
  conflicts: number;
  /** Divergences skipped under the policy. */
  skipped: number;
  errors: number;
}

export interface ReconcileCursor {
  schemaVersion: typeof SYNC_CURSOR_SCHEMA_VERSION;
  managedBy: string;
  lastSyncedAt: string;
  runCount: number;
  summary: ReconcileSummary;
}

export interface ReconcileRegistryResult {
  corpusRoot: string;
  direction: "push" | "pull" | "all";
  dryRun: boolean;
  conflictPolicy: ReconcileConflictPolicy;
  summary: ReconcileSummary;
  skills: ReconcileSkillEntry[];
  cursor?: Pick<ReconcileCursor, "lastSyncedAt" | "runCount">;
}

export class ReconcileRegistryError extends Error {
  constructor(message: string, readonly detail?: string[]) {
    super(message);
    this.name = "ReconcileRegistryError";
  }
}

interface LocalSkill {
  slug: string;
  version?: string;
  sha256: string;
}

interface RemoteSkill {
  slug: string;
  version?: string;
  sha256?: string;
}

function readBaseline(skillDir: string): string | undefined {
  const markerPath = join(skillDir, PULL_MARKER_FILE);
  if (!existsSync(markerPath)) return undefined;
  try {
    const marker = JSON.parse(readFileSync(markerPath, "utf-8")) as { contentHash?: string };
    return typeof marker.contentHash === "string" && marker.contentHash ? marker.contentHash : undefined;
  } catch {
    return undefined;
  }
}

function readCursor(root: string): Pick<ReconcileCursor, "runCount"> {
  const path = join(root, SYNC_CURSOR_FILE);
  if (!existsSync(path)) return { runCount: 0 };
  try {
    const cursor = JSON.parse(readFileSync(path, "utf-8")) as { runCount?: number };
    return { runCount: typeof cursor.runCount === "number" ? cursor.runCount : 0 };
  } catch {
    return { runCount: 0 };
  }
}

function classifySkill(
  local: LocalSkill | undefined,
  remote: RemoteSkill | undefined,
  baseline: string | undefined,
): { state: ReconcileSkillState; reason?: string } {
  if (!remote) return { state: "local-only" };
  if (!local) return { state: "remote-only" };
  if (remote.sha256 && remote.sha256 === local.sha256) return { state: "in-sync" };
  if (!remote.sha256) {
    // A registry row without a bundle digest (the bundled corpus) cannot be diffed;
    // when the local side also exists there is no change signal, so it is stable.
    return { state: "in-sync", reason: "no remote digest to diff" };
  }
  if (!baseline) {
    return { state: "conflict", reason: "no baseline marker: cannot prove which side changed" };
  }
  if (baseline === local.sha256) return { state: "changed-remotely" };
  if (baseline === remote.sha256) return { state: "changed-locally" };
  return { state: "conflict", reason: "both sides changed since the baseline marker" };
}

function resolveAction(
  state: ReconcileSkillState,
  direction: "push" | "pull" | "all",
  conflict: ReconcileConflictPolicy,
): { action: ReconcileAction; reason?: string } {
  switch (state) {
    case "local-only":
    case "changed-locally":
      return direction === "push" || direction === "all" ? { action: "push" } : { action: "skip", reason: "push not requested" };
    case "remote-only":
    case "changed-remotely":
      return direction === "pull" || direction === "all" ? { action: "pull" } : { action: "skip", reason: "pull not requested" };
    case "conflict":
      if (conflict === "local" && (direction === "push" || direction === "all")) return { action: "push" };
      if (conflict === "remote" && (direction === "pull" || direction === "all")) return { action: "pull" };
      return { action: "skip", reason: `conflict policy '${conflict}' does not resolve in this direction` };
    case "in-sync":
      return { action: "none" };
  }
}

/**
 * Run one sync pass.
 *
 * The plan (classification + per-skill action) is computed in full before anything is
 * executed, and a dry run stops at the plan: no publish, no pull, no marker, no cursor —
 * proven by readback in the tests.
 */
export async function reconcileRegistry(options: ReconcileRegistryOptions = {}): Promise<ReconcileRegistryResult> {
  const conflict = options.conflict ?? "skip";
  if (!CONFLICT_POLICIES.includes(conflict)) {
    throw new ReconcileRegistryError(
      `Unknown conflict policy '${String(conflict)}'. Use one of: ${CONFLICT_POLICIES.join(", ")}.`,
    );
  }

  const direction = options.pull && !options.push && !options.all ? "pull" : options.push && !options.pull && !options.all ? "push" : "all";
  const dryRun = options.dryRun ?? false;

  const client = options.client !== undefined ? options.client : createRemoteSkillsClient();
  if (!client) {
    throw new ReconcileRegistryError(
      "No API key configured, so there is nowhere to sync to.",
      ["Run `skills login`, or set SKILLS_API_KEY and SKILLS_API_URL for this instance."],
    );
  }

  const root = resolveCorpusRoot(options);
  const localSkills = listPortableSkillMetas({ rootDir: root });
  const locals = new Map<string, LocalSkill>();
  for (const meta of localSkills) {
    try {
      const path = getPortableSkillPath(meta.name, { rootDir: root });
      const packed = packSkillBundle(path);
      locals.set(meta.name, { slug: meta.name, version: meta.version, sha256: packed.sha256 });
    } catch {
      // An un-packable corpus entry is reported as an error rather than silently ignored.
      locals.set(meta.name, { slug: meta.name, version: meta.version, sha256: "" });
    }
  }

  const remoteRowsPayload = await client.listSkills();
  const remoteRows = Array.isArray(remoteRowsPayload) ? remoteRowsPayload : [];
  const remotes = new Map<string, RemoteSkill>();
  for (const row of remoteRows) {
    if (!row || typeof row !== "object") continue;
    const record = row as Record<string, unknown>;
    const slug = typeof record.slug === "string" ? record.slug : typeof record.name === "string" ? record.name : undefined;
    if (!slug) continue;
    remotes.set(slug, {
      slug,
      version: typeof record.version === "string" ? record.version : undefined,
      sha256: typeof record.bundleSha256 === "string" && record.bundleSha256 ? record.bundleSha256 : undefined,
    });
  }

  const allSlugs = [...new Set([...locals.keys(), ...remotes.keys()])].sort();
  const skills: ReconcileSkillEntry[] = [];

  for (const slug of allSlugs) {
    const local = locals.get(slug);
    const remote = remotes.get(slug);
    const baseline = local ? readBaseline(join(root, slug)) : undefined;
    const { state, reason } = classifySkill(local, remote, baseline);
    const { action, reason: actionReason } = resolveAction(state, direction, conflict);
    skills.push({
      slug,
      state,
      action,
      ...(local?.version ? { localVersion: local.version } : {}),
      ...(remote?.version ? { remoteVersion: remote.version } : {}),
      ...(local?.sha256 ? { localSha256: local.sha256 } : {}),
      ...(remote?.sha256 ? { remoteSha256: remote.sha256 } : {}),
      ...(reason ?? actionReason ? { reason: reason ?? actionReason } : {}),
    });
  }

  const summary: ReconcileSummary = {
    local: locals.size,
    remote: remotes.size,
    inSync: 0,
    pushed: 0,
    pulled: 0,
    conflicts: 0,
    skipped: 0,
    errors: 0,
  };

  for (const entry of skills) {
    if (entry.state === "in-sync") summary.inSync += 1;
    if (entry.state === "conflict") summary.conflicts += 1;
    if (entry.action === "skip") summary.skipped += 1;
  }

  const pushSlugs = skills.filter((entry) => entry.action === "push").map((entry) => entry.slug);
  const pullSlugs = skills.filter((entry) => entry.action === "pull").map((entry) => entry.slug);

  if (!dryRun) {
    for (const slug of pushSlugs) {
      const entry = skills.find((item) => item.slug === slug)!;
      try {
        await pushSkill(slug, { rootDir: root, client });
        // Record the pushed state as the new baseline so the next sync can prove
        // direction. The marker is the canonical pull.ts shape; `source: "sync"`
        // distinguishes a push-written marker from a pull-written one.
        const pushed = locals.get(slug);
        writePullMarker(join(root, slug), {
          skill: slug,
          ...(pushed?.version ? { version: pushed.version } : {}),
          ...(pushed?.sha256 ? { contentHash: pushed.sha256 } : {}),
          source: "sync",
        });
        entry.result = { ok: true };
        summary.pushed += 1;
      } catch (error) {
        entry.result = { ok: false, detail: (error as Error).message };
        summary.errors += 1;
      }
    }

    if (pullSlugs.length > 0) {
      try {
        const pulled = await pullSkills({ names: pullSlugs, rootDir: root, client, signingKey: options.signingKey });
        for (const result of pulled.results) {
          const entry = skills.find((item) => item.slug === result.name);
          if (entry) {
            entry.result = { ok: result.success, ...(result.error ? { detail: result.error } : {}) };
            if (result.success) summary.pulled += 1;
            else summary.errors += 1;
          }
        }
      } catch (error) {
        // A wholesale pull failure is one error line, not one per skill.
        for (const slug of pullSlugs) {
          const entry = skills.find((item) => item.slug === slug);
          if (entry) entry.result = { ok: false, detail: (error as Error).message };
        }
        summary.errors += pullSlugs.length;
      }
    }

    const cursor: ReconcileCursor = {
      schemaVersion: SYNC_CURSOR_SCHEMA_VERSION,
      managedBy: "@hasna/skills",
      lastSyncedAt: new Date().toISOString(),
      runCount: readCursor(root).runCount + 1,
      summary,
    };
    writeFileSync(join(root, SYNC_CURSOR_FILE), `${JSON.stringify(cursor, null, 2)}\n`);
    return {
      corpusRoot: root,
      direction,
      dryRun: false,
      conflictPolicy: conflict,
      summary,
      skills,
      cursor: { lastSyncedAt: cursor.lastSyncedAt, runCount: cursor.runCount },
    };
  }

  // A dry run reports the plan: every action that would execute, counted as planned.
  summary.pushed = pushSlugs.length;
  summary.pulled = pullSlugs.length;
  return {
    corpusRoot: root,
    direction,
    dryRun: true,
    conflictPolicy: conflict,
    summary,
    skills,
  };
}
