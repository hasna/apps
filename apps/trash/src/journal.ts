import { constants, closeSync, fstatSync, fsyncSync, lstatSync, mkdirSync, openSync, opendirSync, readFileSync, readdirSync, renameSync, rmdirSync, unlinkSync, writeSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { agentSchema, artifactSchema, captureSchema, digestSchema, idSchema, parseInput, retentionSchema } from "./api/domain.js";
import { inspectAncestors } from "./lib/inspect.js";
import { withFileLock } from "./lib/lock.js";
import { isErrno } from "./lib/fsx.js";

export const receiptSchema = z.object({
  kind: z.enum(["file", "dir", "symlink"]), mode: z.number().int().min(0).max(0o777),
  sizeBytes: z.number().int().min(0).max(2_147_483_648), sha256: digestSchema, artifact: artifactSchema,
}).strict();
const operationSchema = z.object({
  schema: z.literal(1), id: idSchema, entryId: idSchema, stationId: idSchema,
  kind: z.enum(["capture", "restore"]),
  phase: z.enum(["snapshotting", "captured", "moving", "staged", "committing", "committed", "downloading", "restoring", "restored"]),
  path: z.string().min(2).max(4096).refine((path) => !path.includes("\0") && path === resolve(path)),
  createdAt: z.string().datetime(), attempt: z.number().int().min(0).max(10),
  input: captureSchema.optional(), receipt: receiptSchema.optional(),
  captureOptions: z.object({ agent: agentSchema, retentionDays: retentionSchema }).strict().optional(),
  identity: z.object({ device: z.string().regex(/^\d{1,30}$/), inode: z.string().regex(/^\d{1,30}$/) }).strict().optional(),
  leaseId: idSchema.optional(),
  preservedPaths: z.array(z.string().min(2).max(4096)).max(10).optional(),
}).strict();
export type Operation = z.infer<typeof operationSchema>;

export function syncDirectory(path: string) {
  const fd = openSync(path, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
  try { fsyncSync(fd); } finally { closeSync(fd); }
}

export function ownedDirectory(path: string) {
  if (inspectAncestors(path).length) throw new Error("Unsafe journal ancestry.");
  const info = lstatSync(path);
  if (!info.isDirectory() || info.isSymbolicLink() || (info.mode & 0o077) !== 0 || (process.getuid && info.uid !== process.getuid())) throw new Error("The operation directory must be owned by this user with mode 0700.");
}

function createParents(path: string) {
  try {
    const info = lstatSync(path);
    if (!info.isDirectory() || info.isSymbolicLink()) throw new Error("Unsafe journal parent.");
  } catch (error) {
    if (!isErrno(error, "ENOENT")) throw error;
    createParents(dirname(path));
    try { mkdirSync(path, { mode: 0o700 }); } catch (error) { if (!isErrno(error, "EEXIST")) throw error; }
    syncDirectory(dirname(path));
  }
}

/** A filesystem transaction journal, not a local copy of the hosted Trash index. */
export class OperationJournal {
  readonly root: string;
  constructor(root: string) { this.root = resolve(root); }
  directory(id: string) { return join(this.root, parseInput(idSchema, id)); }
  capsule(id: string, attempt: number) {
    if (!Number.isInteger(attempt) || attempt < 0 || attempt > 10) throw new Error("Invalid download attempt.");
    return join(this.directory(id), `payload-${attempt}.capsule`);
  }
  create(value: Operation): Operation {
    const operation = parseInput(operationSchema, value);
    createParents(this.root); ownedDirectory(this.root);
    mkdirSync(this.directory(operation.id), { mode: 0o700 }); syncDirectory(this.root);
    this.write(operation); return operation;
  }
  read(id: string): Operation {
    const directory = this.directory(id); ownedDirectory(directory);
    const fd = openSync(join(directory, "record.json"), constants.O_RDONLY | constants.O_NOFOLLOW);
    try {
      const info = fstatSync(fd);
      if (!info.isFile() || info.size > 64 * 1024 || (info.mode & 0o077) !== 0 || (process.getuid && info.uid !== process.getuid())) throw new Error("Unsafe operation record.");
      const operation = parseInput(operationSchema, JSON.parse(readFileSync(fd, "utf8")));
      if (operation.id !== id) throw new Error("Operation identity mismatch.");
      return operation;
    } finally { closeSync(fd); }
  }
  write(value: Operation): Operation {
    const operation = parseInput(operationSchema, value); const directory = this.directory(operation.id);
    ownedDirectory(directory);
    const tmp = join(directory, `.record-${randomUUID()}.tmp`);
    const fd = openSync(tmp, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
    try {
      const bytes = Buffer.from(JSON.stringify(operation)); let offset = 0;
      while (offset < bytes.length) { const size = writeSync(fd, bytes, offset, bytes.length - offset); if (!size) throw new Error("Journal write failed."); offset += size; }
      fsyncSync(fd);
    } finally { closeSync(fd); }
    renameSync(tmp, join(directory, "record.json")); syncDirectory(directory);
    return operation;
  }
  async lock<T>(id: string, action: () => Promise<T>) {
    ownedDirectory(this.root); ownedDirectory(this.directory(id));
    const locks = join(this.root, ".locks"); createParents(locks); ownedDirectory(locks);
    return withFileLock("hosted operation", join(locks, `${id}.lock`), action);
  }
  pending(limit = 20) {
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw new Error("Pending operation limit must be 1–100.");
    try { ownedDirectory(this.root); } catch (error) { if (isErrno(error, "ENOENT")) return []; throw error; }
    const result: Array<{ id: string; entryId?: string; kind?: Operation["kind"]; phase: string; path?: string }> = [];
    const directory = opendirSync(this.root);
    try {
      while (result.length < limit) {
        const item = directory.readSync(); if (!item) break;
        if (!idSchema.safeParse(item.name).success) continue;
        try { const op = this.read(item.name); result.push({ id: op.id, entryId: op.entryId, kind: op.kind, phase: op.phase, path: op.path }); }
        catch { result.push({ id: item.name, phase: "unreadable" }); }
      }
    } finally { directory.closeSync(); }
    return result;
  }
  complete(id: string) {
    this.read(id); const directory = this.directory(id); const names = readdirSync(directory);
    if (names.some((name) => name !== "record.json" && !/^payload-(?:[0-9]|10)\.capsule$/.test(name) && !/^\.record-[a-f0-9-]{36}\.tmp$/.test(name))) throw new Error("Unexpected files in the operation directory; preserve them for inspection.");
    for (const name of names) if (name !== "record.json") unlinkSync(join(directory, name));
    unlinkSync(join(directory, "record.json")); rmdirSync(directory); syncDirectory(this.root);
  }
}
