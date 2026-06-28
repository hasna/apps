import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";

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

export function writeWorkflowRunManifest(args: {
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
}): string {
  const projectSlug = workflowRunProjectSlug(args.projectKey);
  const subjectKey = workflowRunSubjectKey(args.subjectKind, args.rawSubjectRef);
  const dir = join(args.loopsDataDir, "runs", projectSlug, subjectKey, args.workflowRunId);
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const manifestPath = join(dir, "manifest.json");
  writeFileSync(
    manifestPath,
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
  return manifestPath;
}
