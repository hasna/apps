import { mkdirSync, mkdtempSync, readdirSync, rmdirSync, unlinkSync } from "node:fs";
import { join, resolve } from "node:path";
import { z } from "zod";
import { TrashApi, type RemoteEntry } from "./client.js";
import { canonicalJson, digestSchema, idSchema, labelSchema, parseInput } from "./api/domain.js";
import { receiptSchema, ownedDirectory, syncDirectory } from "./journal.js";
import { inspectAncestors } from "./lib/inspect.js";
import { downloadCapsule } from "./transfers.js";

const backupReceiptSchema = z.object({ id: labelSchema, destination: labelSchema, artifactSha256: digestSchema, verifiedAt: z.string().datetime(), held: z.literal(true), restoreVerified: z.literal(true) }).strict();
export type BackupReceipt = z.infer<typeof backupReceiptSchema>;
export type BackupWorkerApi = Pick<TrashApi, "get" | "claimBackup" | "completeBackup" | "failBackup">;
export interface BackupSink {
  /** Idempotent on entry.id + artifact.sha256. Persist and hold the import before returning; verify a real restore. */
  accept(input: { entry: RemoteEntry; capsule: string }): Promise<BackupReceipt>;
}
export class BackupJobError extends Error {
  constructor(readonly entryId: string) { super("Backup handoff did not complete. Trash protection remains active unless a verified receipt is already recorded; inspect the worker before retrying."); this.name = "BackupJobError"; }
}

/** Worker scope is distinct from station deletion scope; provider details stay inside the private Backup adapter. */
export async function processBackupJob(id: string, options: { api: BackupWorkerApi; sink: BackupSink; workRoot: string; transferFetch?: (url: string, init?: RequestInit) => Promise<Response> }): Promise<RemoteEntry> {
  parseInput(idSchema, id);
  const entry = await options.api.get(id);
  if (entry.id !== id) throw new BackupJobError(id);
  if (entry.backup === "verified") return entry;
  if (!["requested", "failed", "running"].includes(entry.backup)) throw new BackupJobError(id);
  const root = resolve(options.workRoot);
  // Existing symlink ancestry is rejected before and after creating our owned work root.
  const unsafe = inspectAncestors(root);
  if (unsafe.length) throw new BackupJobError(id);
  mkdirSync(root, { recursive: true, mode: 0o700 }); ownedDirectory(root);
  if (readdirSync(root).length >= 100) throw new BackupJobError(id);
  const grant = await options.api.claimBackup(entry.id, entry.version);
  let directory: string | undefined;
  try {
    if (grant.entry.id !== entry.id || canonicalJson(grant.entry.artifact) !== canonicalJson(entry.artifact)) throw new BackupJobError(id);
    parseInput(idSchema, grant.job.id);
    if (Date.parse(grant.job.until) <= Date.now()) throw new BackupJobError(id);
    directory = mkdtempSync(join(root, "job-")); ownedDirectory(directory); syncDirectory(root);
    const capsule = join(directory, "payload.capsule");
    const receipt = parseInput(receiptSchema, { kind: entry.kind, mode: entry.mode, sizeBytes: entry.sizeBytes, sha256: entry.sha256, artifact: entry.artifact });
    await downloadCapsule(grant.transfer, capsule, receipt, options.transferFetch);
    const backupReceipt = parseInput(backupReceiptSchema, await options.sink.accept({ entry: grant.entry, capsule }));
    if (backupReceipt.artifactSha256 !== entry.artifact.sha256 || Date.parse(backupReceipt.verifiedAt) > Date.now() + 60_000) throw new BackupJobError(id);
    const current = await options.api.get(id);
    const completed = await options.api.completeBackup(id, current.version, grant.job.id, backupReceipt, `${id}:${grant.job.id}:complete`);
    if (completed.id !== id || completed.backup !== "verified" || completed.backupReceipt?.artifactSha256 !== entry.artifact.sha256) throw new BackupJobError(id);
    unlinkSync(capsule); rmdirSync(directory); syncDirectory(root);
    return completed;
  } catch {
    try {
      const current = await options.api.get(id);
      // A successful commit with a lost response is success, never downgrade it to failed.
      if (current.backup === "verified" && current.backupReceipt?.artifactSha256 === entry.artifact.sha256) return current;
      if (current.backup === "running") await options.api.failBackup(id, current.version, grant.job.id, `${id}:${grant.job.id}:fail`);
    } catch { /* The server-side requested/running/failed states all retain the Trash copy. */ }
    throw new BackupJobError(id);
  }
}
