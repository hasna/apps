import { createHash } from "node:crypto";
import { mkdirSync, renameSync, rmdirSync, rmSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";

function shortHash(value: string): string {
  return createHash("sha256").update(value).digest("hex").slice(0, 12);
}

export function safeRunPathSlug(value: string | undefined, fallback: string): string {
  const raw = value?.trim() || fallback;
  const slug = raw
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 72);
  return slug || fallback;
}

export function workflowRunSubjectKey(kind: string | undefined, rawSubjectRef: string | undefined): string {
  const raw = rawSubjectRef?.trim() || "subject";
  const kindSlug = safeRunPathSlug(kind, "subject").slice(0, 24);
  const subjectSlug = safeRunPathSlug(raw, "subject").slice(0, 48);
  return `${kindSlug}-${subjectSlug}-${shortHash(`${kindSlug}\n${raw}`)}`;
}

export function workflowRunProjectSlug(projectKey: string | undefined): string {
  if (!projectKey?.trim()) return "global";
  return safeRunPathSlug(projectKey.startsWith("/") ? basename(projectKey) : projectKey, "project");
}

export interface WorkflowRunManifestArgs {
  loopsDataDir: string;
  workflowRunId: string;
  workflowId: string;
  workflowName: string;
  invocationId?: string;
  workItemId?: string;
  projectKey?: string;
  subjectKind?: string;
  rawSubjectRef?: string;
  payload: Record<string, unknown>;
}

export interface StagedWorkflowRunManifest {
  /** Final manifest.json location, valid only after {@link commitWorkflowRunManifest}. */
  manifestPath: string;
  /** Temp file holding the staged manifest content. */
  tmpPath: string;
}

/**
 * Write the manifest to `manifest.json.tmp` so callers can stage the
 * filesystem side effect before opening a database transaction and promote it
 * with {@link commitWorkflowRunManifest} only after COMMIT succeeds.
 */
export function stageWorkflowRunManifest(args: WorkflowRunManifestArgs): StagedWorkflowRunManifest {
  const projectSlug = workflowRunProjectSlug(args.projectKey);
  const subjectKey = workflowRunSubjectKey(args.subjectKind, args.rawSubjectRef);
  const dir = join(args.loopsDataDir, "runs", projectSlug, subjectKey, args.workflowRunId);
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const manifestPath = join(dir, "manifest.json");
  const tmpPath = `${manifestPath}.tmp`;
  writeFileSync(
    tmpPath,
    JSON.stringify(
      {
        version: 1,
        workflowRunId: args.workflowRunId,
        workflowId: args.workflowId,
        workflowName: args.workflowName,
        invocationId: args.invocationId,
        workItemId: args.workItemId,
        projectSlug,
        subjectKey,
        requiredReading: [],
        createdAt: new Date().toISOString(),
        ...args.payload,
      },
      null,
      2,
    ),
    { mode: 0o600 },
  );
  return { manifestPath, tmpPath };
}

export function commitWorkflowRunManifest(staged: StagedWorkflowRunManifest): string {
  renameSync(staged.tmpPath, staged.manifestPath);
  return staged.manifestPath;
}

export function discardWorkflowRunManifest(staged: StagedWorkflowRunManifest): void {
  rmSync(staged.tmpPath, { force: true });
  // stageWorkflowRunManifest already created runs/<project>/<subject>/<runId>/
  // for a run id that never got a DB row (idempotency race loser, rollback),
  // so remove the now-empty per-run directory too. Plain rmdir only succeeds
  // on empty directories, so any artifacts already written there survive. The
  // shared subject/project parents are left alone: removing them would race a
  // concurrent stage for the same subject between its mkdir and write.
  try {
    rmdirSync(dirname(staged.manifestPath));
  } catch {
    /* not empty or already gone */
  }
}

export function writeWorkflowRunManifest(args: WorkflowRunManifestArgs): string {
  return commitWorkflowRunManifest(stageWorkflowRunManifest(args));
}
