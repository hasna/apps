import { createHash, randomUUID } from "node:crypto";
import { closeSync, constants, fchmodSync, fstatSync, fsyncSync, openSync, readSync, writeSync, type Stats } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { attachmentDownloadValidation as validation, type AttachmentWriteHooks, type AvailableAttachmentContent, type SavedAttachment } from "./attachment-download.js";

import { darwinOps, type NativeOps } from "./darwin-private-filesystem.js";
const O_CLOEXEC = 0x01000000;

const same = validation.sameFileIdentity;
const fileFlags = constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK;

function statEntry(ops: NativeOps, directoryFd: number, name: string): Stats {
  const fd = ops.open(directoryFd, name, fileFlags);
  try { return fstatSync(fd); } finally { closeSync(fd); }
}

function removeOwnedEntry(ops: NativeOps, directoryFd: number, name: string, identity: Stats): void {
  try {
    const current = statEntry(ops, directoryFd, name);
    if (current.isFile() && same(current, identity)) ops.unlink(directoryFd, name);
  } catch (error) {
    if (!["ENOENT", "ELOOP", "ENOTDIR"].includes((error as NodeJS.ErrnoException).code ?? "")) throw error;
  }
}

function digest(fd: number, size: number): string {
  const hash = createHash("sha256");
  const chunk = Buffer.allocUnsafe(Math.min(64 * 1024, Math.max(1, size)));
  let offset = 0;
  while (offset < size) {
    const count = readSync(fd, chunk, 0, Math.min(chunk.length, size - offset), offset);
    if (!count) break;
    hash.update(chunk.subarray(0, count));
    offset += count;
  }
  if (offset !== size || readSync(fd, Buffer.alloc(1), 0, 1, offset) !== 0) throw new Error("attachment size changed during validation");
  return hash.digest("hex");
}

async function assertDirectory(directory: string, fd: number, identity: Stats, uid: number, ops: NativeOps, hooks: AttachmentWriteHooks): Promise<void> {
  await validation.assertTrustedOutputPath(directory, identity, uid, hooks.outputDirectoryOwnerUid?.(), hooks.ancestorOwnerUid);
  ops.assertPrivateAcl(fd);
  let path = dirname(directory);
  while (true) {
    const parent = openSync(path, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW | O_CLOEXEC);
    try { ops.assertPrivateAcl(parent); } finally { closeSync(parent); }
    const next = dirname(path);
    if (next === path) break;
    path = next;
  }
  await validation.assertTrustedOutputPath(directory, identity, uid, hooks.outputDirectoryOwnerUid?.(), hooks.ancestorOwnerUid);
}

/** @internal Darwin backend for the shared public attachment write boundary. */
export async function writeDarwinAttachmentFile(content: AvailableAttachmentContent, outputDir: string, hooks: AttachmentWriteHooks): Promise<SavedAttachment> {
  if (content.state !== "available") throw new Error("only available attachment content can be written");
  if (!outputDir.trim()) throw new Error("attachment output directory is required");
  const directory = resolve(outputDir);
  const leaf = validation.safeFilename(content.filename, content.index);
  const uid = process.geteuid?.();
  if (!Number.isSafeInteger(uid) || uid! < 0) throw new Error("secure attachment writes require a valid effective user id");
  const ops = await darwinOps();
  let created: string | undefined;
  try {
    created = await validation.createPrivateDirectoryChain(directory, uid!, hooks.ancestorOwnerUid);
    const directoryFd = openSync(directory, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW | O_CLOEXEC);
    const temporaryName = `.attachment-${randomUUID()}.tmp`;
    let temporaryIdentity: Stats | undefined;
    let publishedName: string | undefined;
    let succeeded = false;
    try {
      // Preserve the existing deterministic failure seam without treating its
      // result as a path: Darwin operations stay anchored to directoryFd.
      hooks.resolveStableDirectory?.(directoryFd);
      const opened = fstatSync(directoryFd);
      await assertDirectory(directory, directoryFd, opened, uid!, ops, hooks);
      await hooks.beforeDescriptorWrite?.();
      const initialMode = 0o600 & ~process.umask();
      const fd = ops.open(directoryFd, temporaryName, constants.O_RDWR | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
      try {
        temporaryIdentity = fstatSync(fd);
        if (!temporaryIdentity.isFile() || (temporaryIdentity.mode & 0o7777) !== initialMode || temporaryIdentity.uid !== uid) throw new Error("temporary attachment is not a private regular file");
        let offset = 0;
        while (offset < content.data.byteLength) {
          const written = writeSync(fd, content.data, offset, content.data.byteLength - offset, offset);
          if (!written) throw new Error("attachment write was incomplete");
          offset += written;
        }
        fchmodSync(fd, 0o600);
        fsyncSync(fd);
        const written = fstatSync(fd);
        if (!same(written, temporaryIdentity) || written.size !== content.bytes || (written.mode & 0o777) !== 0o600) throw new Error("temporary attachment changed before publication");
        await hooks.beforeTemporaryPublish?.(join(directory, temporaryName));
        if (digest(fd, content.bytes) !== content.sha256) throw new Error("temporary attachment digest changed before publication");
        const entry = statEntry(ops, directoryFd, temporaryName);
        if (!entry.isFile() || !same(entry, temporaryIdentity) || entry.size !== content.bytes) throw new Error("temporary attachment inode changed before publication");
        for (let attempt = 0; attempt < 10_000; attempt++) {
          const candidate = validation.collisionName(leaf, attempt);
          try { ops.link(directoryFd, temporaryName, candidate); }
          catch (error) { if ((error as NodeJS.ErrnoException).code === "EEXIST") continue; throw error; }
          publishedName = candidate;
          await hooks.afterCandidatePublish?.(join(directory, candidate));
          const publishedFd = ops.open(directoryFd, candidate, fileFlags);
          try {
            const published = fstatSync(publishedFd);
            if (!published.isFile() || !same(published, temporaryIdentity) || published.size !== content.bytes || (published.mode & 0o777) !== 0o600) throw new Error("published attachment inode changed during validation");
            if (digest(publishedFd, content.bytes) !== content.sha256) throw new Error("published attachment digest changed during validation");
            const final = statEntry(ops, directoryFd, candidate);
            if (!final.isFile() || !same(final, published) || final.size !== content.bytes) throw new Error("published attachment inode changed during validation");
          } finally { closeSync(publishedFd); }
          break;
        }
        if (!publishedName) throw new Error("could not allocate a collision-free attachment path");
        await assertDirectory(directory, directoryFd, opened, uid!, ops, hooks);
        succeeded = true;
        return { index: content.index, filename: content.filename, content_type: content.content_type, bytes: content.bytes, sha256: content.sha256, path: join(directory, publishedName) };
      } finally { closeSync(fd); }
    } finally {
      try {
        if (temporaryIdentity) {
          try {
            if (!succeeded && publishedName) removeOwnedEntry(ops, directoryFd, publishedName, temporaryIdentity);
          } finally { removeOwnedEntry(ops, directoryFd, temporaryName, temporaryIdentity); }
        }
      } finally { closeSync(directoryFd); }
    }
  } catch (error) {
    if (created) await validation.removeCreatedDirectoryChain(directory, created);
    throw error;
  }
}
