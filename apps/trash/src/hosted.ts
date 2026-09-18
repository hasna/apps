import { lstatSync, mkdirSync, readdirSync, renameSync, rmdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { TrashApi, type RemoteEntry, type TrashApiOptions } from "./client.js";
import { canonicalJson, captureSchema, idSchema, parseInput, retentionSchema, stationSchema, type Station } from "./api/domain.js";
import { createCapsule, discardStagedPayload, inspectCapsule, restoreCapsule, snapshotIdentity, type CapsuleReceipt } from "./capsule.js";
import { detectAgent, detectStation, type StationIdentity } from "./identity.js";
import { OperationJournal, ownedDirectory, receiptSchema, syncDirectory, type Operation } from "./journal.js";
import { checkProtectedPath, inspectAncestors } from "./lib/inspect.js";
import { isErrno, lstatOrNull } from "./lib/fsx.js";
import { getHomeDir } from "./paths.js";
import { downloadCapsule, uploadCapsule } from "./transfers.js";

export type HostedApi = Pick<TrashApi, "status" | "registerStation" | "get" | "reserve" | "upload" | "verify" | "commit" | "recovery" | "restored">;
export type HostedOptions = TrashApiOptions & {
  api?: HostedApi; operationRoot?: string; station?: () => StationIdentity;
  transferFetch?: (url: string, init?: RequestInit) => Promise<Response>;
  /** Fault injection for transaction boundary proofs. Production callers omit this. */
  checkpoint?: (point: string, operation: Operation) => void | Promise<void>;
};
export type RestoreOutcome = { entry: RemoteEntry; path: string; preservedPaths?: string[] };

export class HostedOperationError extends Error {
  constructor(readonly code: string, readonly operationId: string, readonly entryId: string) {
    super(`Trash operation ${operationId} needs recovery. Inspect its pending record before retrying; captured and partial files are preserved.`);
    this.name = "HostedOperationError";
  }
}
function identity(path: string) {
  const info = lstatSync(path, { bigint: true }); return { device: info.dev.toString(), inode: info.ino.toString() };
}
function sameIdentity(path: string, expected: Operation["identity"]) {
  return expected && canonicalJson(identity(path)) === canonicalJson(expected);
}
function receipt(entry: RemoteEntry): CapsuleReceipt {
  return parseInput(receiptSchema, { kind: entry.kind, mode: entry.mode, sizeBytes: entry.sizeBytes, sha256: entry.sha256, artifact: entry.artifact });
}
function matches(path: string, expected: CapsuleReceipt) {
  const actual = snapshotIdentity(path);
  return canonicalJson(actual) === canonicalJson({ kind: expected.kind, mode: expected.mode, sizeBytes: expected.sizeBytes, sha256: expected.sha256 });
}

/** Hosted metadata remains authoritative; this class journals only unfinished filesystem operations. */
export class HostedTrash {
  readonly api: HostedApi;
  readonly journal: OperationJournal;
  private readonly env: NodeJS.ProcessEnv;
  private readonly home: string;
  constructor(private readonly options: HostedOptions = {}) {
    this.env = options.env ?? process.env; this.home = getHomeDir(this.env);
    this.api = options.api ?? new TrashApi(options);
    this.journal = new OperationJournal(options.operationRoot ?? join(this.env.HASNA_HOME ?? join(this.home, ".hasna"), "trash", "operations"));
  }
  pending(limit = 20) { return this.journal.pending(limit); }
  private path(given: string) {
    if (!given || given.includes("\0")) throw new Error("Supply a filesystem path.");
    const path = resolve(given);
    if (checkProtectedPath(path, { home: this.home, extraRoots: [this.journal.root] }) || path.split("/").some((part) => /^\.hasna-trash-[a-f0-9-]{36}$/.test(part))) throw new Error("Trash refuses protected or managed operation paths.");
    if (inspectAncestors(path).length) throw new Error("Trash refuses paths with missing, inaccessible or symlinked ancestors.");
    return path;
  }
  async setup(): Promise<Station> {
    const detected = parseInput(stationSchema, (this.options.station ?? (() => detectStation({ env: this.env })))());
    const status = await this.api.status();
    if (status.station && status.station.name !== detected.name) throw new Error("The detected station does not match the configured Trash credential.");
    return this.api.registerStation(detected);
  }
  private async station(): Promise<Station> {
    const detected = parseInput(stationSchema, (this.options.station ?? (() => detectStation({ env: this.env })))());
    const status = await this.api.status();
    const station = status.station ?? await this.api.registerStation(detected);
    if (station.name !== detected.name) throw new Error("The detected station does not match the configured Trash credential.");
    parseInput(idSchema, station.id); return station;
  }
  private async checkpoint(point: string, operation: Operation) { await this.options.checkpoint?.(point, structuredClone(operation)); }
  private staging(operation: Operation) { return join(dirname(operation.path), `.hasna-trash-${operation.id}`); }
  private assertEntry(operation: Operation, entry: RemoteEntry) {
    if (entry.id !== operation.entryId || !Number.isSafeInteger(entry.version) || entry.version < 1 ||
      (operation.kind === "capture" && (entry.stationId !== operation.stationId || entry.originalPath !== operation.path)) ||
      !operation.receipt || canonicalJson(receipt(entry)) !== canonicalJson(operation.receipt)) throw new Error("Hosted capture metadata does not match this operation.");
  }
  private async locked<T>(operation: Operation, action: (current: Operation) => Promise<T>): Promise<T> {
    try { return await this.journal.lock(operation.id, async () => action(this.journal.read(operation.id))); }
    catch (error) {
      if (error instanceof HostedOperationError) throw error;
      throw new HostedOperationError("operation_interrupted", operation.id, operation.entryId);
    }
  }
  async put(given: string, options: { retentionDays?: number | null; agent?: string } = {}): Promise<RemoteEntry> {
    const path = this.path(given); const station = await this.station();
    const retentionDays = parseInput(retentionSchema, options.retentionDays === undefined ? 90 : options.retentionDays);
    const id = randomUUID();
    const operation = this.journal.create({ schema: 1, id, entryId: id, kind: "capture", phase: "snapshotting", stationId: station.id, path,
      identity: identity(path), createdAt: new Date().toISOString(), attempt: 0,
      captureOptions: { retentionDays, agent: detectAgent(this.env, options.agent) } });
    return this.locked(operation, (current) => this.capture(current));
  }
  private async capture(initial: Operation): Promise<RemoteEntry> {
    let operation = initial;
    const save = (fields: Partial<Operation>) => { operation = this.journal.write({ ...operation, ...fields }); };
    if (operation.phase === "snapshotting") {
      if (!sameIdentity(operation.path, operation.identity) || !operation.captureOptions) throw new Error("The source identity changed.");
      let captured: CapsuleReceipt | undefined;
      const existing = this.journal.capsule(operation.id, operation.attempt);
      if (lstatOrNull(existing)) {
        try { captured = inspectCapsule(existing); }
        catch { save({ attempt: operation.attempt + 1 }); }
      }
      captured ??= createCapsule(operation.path, this.journal.capsule(operation.id, operation.attempt));
      syncDirectory(this.journal.directory(operation.id));
      const input = parseInput(captureSchema, { ...captured, id: operation.entryId, stationId: operation.stationId, originalPath: operation.path,
        agent: operation.captureOptions.agent, retentionDays: operation.captureOptions.retentionDays });
      save({ phase: "captured", receipt: captured, input });
      await this.checkpoint("afterSnapshot", operation);
    }
    if (!operation.input || !operation.receipt) throw new Error("The capture intent is incomplete.");
    const capsule = this.journal.capsule(operation.id, operation.attempt);
    await this.api.reserve(operation.input, `${operation.id}:reserve`);
    let entry = await this.api.get(operation.entryId); this.assertEntry(operation, entry);
    if (entry.state === "uploading") {
      const upload = await this.api.upload(entry.id, entry.version);
      this.assertEntry(operation, upload.entry);
      await uploadCapsule(upload.transfer, capsule, operation.receipt, this.options.transferFetch);
      entry = await this.api.verify(entry.id, entry.version, `${operation.id}:verify:${entry.version}`);
      this.assertEntry(operation, entry);
    }
    const stage = this.staging(operation); const payload = join(stage, "payload");
    if (operation.phase === "captured") {
      if (entry.state !== "ready") throw new Error("Remote capture is not ready for source removal.");
      await this.checkpoint("beforeStage", operation);
      this.path(operation.path);
      if (!sameIdentity(operation.path, operation.identity) || !matches(operation.path, operation.receipt)) throw new Error("The source changed during upload; leave its new bytes untouched.");
      try { mkdirSync(stage, { mode: 0o700 }); }
      catch (error) { if (!isErrno(error, "EEXIST")) throw error; }
      ownedDirectory(stage);
      if (readdirSync(stage).length) throw new Error("The staging destination is occupied.");
      syncDirectory(dirname(stage)); save({ phase: "moving" });
    }
    if (operation.phase === "moving") {
      ownedDirectory(stage);
      if (!lstatOrNull(payload)) {
        this.path(operation.path);
        if (!sameIdentity(operation.path, operation.identity) || !matches(operation.path, operation.receipt)) throw new Error("The source changed before staging.");
        renameSync(operation.path, payload); syncDirectory(stage); syncDirectory(dirname(stage));
      }
      if (!sameIdentity(payload, operation.identity) || !matches(payload, operation.receipt)) throw new Error("Staged contents changed; preserve them for recovery.");
      save({ phase: "staged" }); await this.checkpoint("afterStage", operation);
    }
    if (operation.phase === "staged" || operation.phase === "committing") {
      ownedDirectory(stage);
      if (!sameIdentity(payload, operation.identity) || !matches(payload, operation.receipt)) throw new Error("Staged contents changed; preserve them for recovery.");
      entry = await this.api.get(operation.entryId); this.assertEntry(operation, entry);
      if (entry.state === "ready") {
        save({ phase: "committing" });
        entry = await this.api.commit(entry.id, entry.version, `${operation.id}:commit:${entry.version}`); this.assertEntry(operation, entry);
      }
      if (entry.state !== "trashed") throw new Error("The capture commit was not confirmed.");
      save({ phase: "committed" }); await this.checkpoint("afterCommit", operation);
    }
    if (operation.phase !== "committed") throw new Error("Unsupported capture recovery phase.");
    entry = await this.api.get(operation.entryId); this.assertEntry(operation, entry);
    if (!["trashed", "restored"].includes(entry.state)) throw new Error("Remote recovery must remain available before staging cleanup.");
    // A fresh idempotency key forces an actual exact-version recheck, not an old success receipt.
    entry = await this.api.verify(entry.id, entry.version); this.assertEntry(operation, entry);
    if (lstatOrNull(stage)) {
      ownedDirectory(stage);
      if (lstatOrNull(payload) && !sameIdentity(payload, operation.identity)) throw new Error("The staging identity changed.");
      discardStagedPayload(capsule, payload, operation.receipt);
      rmdirSync(stage); syncDirectory(dirname(stage));
    }
    this.journal.complete(operation.id); return entry;
  }
  async restore(id: string, options: { to?: string } = {}): Promise<RestoreOutcome> {
    parseInput(idSchema, id); const station = await this.station(); const entry = await this.api.get(id);
    if (entry.stationId !== station.id && !options.to) throw new Error("Cross-station restore requires an explicit destination.");
    const path = this.path(options.to ?? entry.originalPath);
    if (lstatOrNull(path)) throw new Error("The restore destination is occupied.");
    const operation = this.journal.create({ schema: 1, id: randomUUID(), entryId: id, stationId: station.id, kind: "restore", phase: "downloading",
      path, createdAt: new Date().toISOString(), receipt: receipt(entry), attempt: 0 });
    return this.locked(operation, (current) => this.restoreOperation(current));
  }
  private async restoreOperation(initial: Operation): Promise<RestoreOutcome> {
    let operation = initial;
    const save = (fields: Partial<Operation>) => { operation = this.journal.write({ ...operation, ...fields }); };
    if (!operation.receipt) throw new Error("Recovery receipt is missing.");
    let entry = await this.api.get(operation.entryId); this.assertEntry(operation, entry);
    this.path(operation.path);
    if (operation.phase === "restoring" || operation.phase === "restored") {
      if (lstatOrNull(operation.path) && !matches(operation.path, operation.receipt)) throw new HostedOperationError("partial_restore", operation.id, operation.entryId);
      if (operation.phase === "restored" && !lstatOrNull(operation.path)) throw new Error("The completed restore destination is missing.");
    }
    if (operation.phase === "restored" || (operation.phase === "restoring" && lstatOrNull(operation.path) && entry.state === "restored")) {
      this.journal.complete(operation.id); return { entry, path: operation.path, preservedPaths: operation.preservedPaths };
    }
    const grant = await this.api.recovery(entry.id, entry.version, entry.stationId !== operation.stationId);
    this.assertEntry(operation, grant.entry); entry = grant.entry;
    save({ leaseId: grant.lease.id });
    let capsule = this.journal.capsule(operation.id, operation.attempt);
    if (lstatOrNull(capsule)) {
      let valid = false;
      try { valid = canonicalJson(inspectCapsule(capsule)) === canonicalJson(operation.receipt); } catch { /* Keep the failed partial capsule. */ }
      if (!valid) { save({ attempt: operation.attempt + 1 }); capsule = this.journal.capsule(operation.id, operation.attempt); }
    }
    if (!lstatOrNull(capsule)) await downloadCapsule(grant.transfer, capsule, operation.receipt, this.options.transferFetch);
    syncDirectory(this.journal.directory(operation.id));
    if (operation.phase === "downloading") {
      if (lstatOrNull(operation.path)) throw new Error("The restore destination became occupied.");
      save({ phase: "restoring" });
    }
    if (!lstatOrNull(operation.path)) restoreCapsule(capsule, operation.path, operation.receipt);
    if (!matches(operation.path, operation.receipt)) throw new HostedOperationError("partial_restore", operation.id, operation.entryId);
    await this.checkpoint("afterRestore", operation);
    entry = await this.api.get(operation.entryId); this.assertEntry(operation, entry);
    entry = await this.api.restored(entry.id, entry.version, operation.leaseId!, operation.receipt.sha256, `${operation.id}:restored:${entry.version}`);
    this.assertEntry(operation, entry);
    if (entry.state !== "restored") throw new Error("Hosted restore completion was not confirmed.");
    save({ phase: "restored" }); this.journal.complete(operation.id);
    return { entry, path: operation.path, preservedPaths: operation.preservedPaths };
  }
  async recover(id: string, options: { to?: string } = {}): Promise<RemoteEntry | RestoreOutcome> {
    const operation = this.journal.read(id); const station = await this.station();
    if (station.id !== operation.stationId) throw new Error("This filesystem operation belongs to another station.");
    return this.locked(operation, async (current) => {
      if (options.to) {
        if (current.kind !== "restore") throw new Error("Only restore operations accept a new destination.");
        const path = this.path(options.to); if (lstatOrNull(path)) throw new Error("The recovery destination is occupied.");
        current = this.journal.write({ ...current, path, phase: "downloading", preservedPaths: [...(current.preservedPaths ?? []), current.path] });
      }
      return current.kind === "capture" ? this.capture(current) : this.restoreOperation(current);
    });
  }
}
