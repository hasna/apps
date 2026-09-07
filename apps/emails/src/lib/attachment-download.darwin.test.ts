import { afterEach, describe, expect, it } from "bun:test";
import { chmodSync, existsSync, fstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, renameSync, rmSync, statSync, symlinkSync, unlinkSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { attachmentDownloadTestBoundary, decodeAttachmentPayload, writeAttachmentFile } from "./attachment-download.js";

const directories: string[] = [];
afterEach(() => { for (const path of directories.splice(0)) rmSync(path, { recursive: true, force: true }); });
const directory = () => {
  const path = realpathSync(mkdtempSync(join(tmpdir(), "emails-darwin-attachment-")));
  directories.push(path);
  return path;
};
const payload = (filename = "../invoice.txt") => {
  const content = decodeAttachmentPayload({ attachment: { filename, content_type: "text/plain", size: 5, content_base64: "aGVsbG8=" } }, 0);
  if (content.state !== "available") throw new Error("fixture unavailable");
  return content;
};

describe.skipIf(process.platform !== "darwin")("Darwin attachment downloads", () => {
  it("uses the public writer to create a private, complete, collision-free file", async () => {
    const dir = directory();
    writeFileSync(join(dir, "invoice.txt"), "existing");
    const saved = await writeAttachmentFile(payload(), dir);
    expect(saved.path).toBe(join(dir, "invoice-1.txt"));
    expect(readFileSync(saved.path, "utf8")).toBe("hello");
    expect(readFileSync(join(dir, "invoice.txt"), "utf8")).toBe("existing");
    expect(statSync(saved.path).mode & 0o777).toBe(0o600);
    expect(readdirSync(dir).sort()).toEqual(["invoice-1.txt", "invoice.txt"]);
  });

  it("creates missing private directories and refuses a nonprivate destination", async () => {
    const dir = directory();
    const destination = join(dir, "Downloads", "nested");
    await writeAttachmentFile(payload(), destination);
    expect(statSync(destination).mode & 0o777).toBe(0o700);
    expect(statSync(join(dir, "Downloads")).mode & 0o777).toBe(0o700);
    chmodSync(destination, 0o750);
    await expect(writeAttachmentFile(payload(), destination)).rejects.toThrow(/private|permission/);
  });

  it("rejects symlink destinations and keeps bytes out of a swapped directory", async () => {
    const parent = directory();
    const target = directory();
    const attacker = directory();
    const link = join(parent, "linked");
    symlinkSync(target, link);
    await expect(writeAttachmentFile(payload(), link)).rejects.toThrow(/directory|symlink/);
    const displaced = target + "-displaced";
    directories.push(displaced);
    await expect(attachmentDownloadTestBoundary.writeAttachmentFile(payload(), target, {
      beforeDescriptorWrite() { renameSync(target, displaced); symlinkSync(attacker, target); },
    })).rejects.toThrow(/directory.*changed|symlink/);
    expect(readdirSync(attacker)).toEqual([]);
    expect(readdirSync(displaced)).toEqual([]);
  });

  it("does not publish a replaced temporary inode or remove the foreign replacement", async () => {
    const dir = directory();
    let replacement = "";
    await expect(attachmentDownloadTestBoundary.writeAttachmentFile(payload(), dir, {
      beforeTemporaryPublish(path) { replacement = path; unlinkSync(path); writeFileSync(path, "foreign", { mode: 0o600 }); },
    })).rejects.toThrow(/inode.*changed/);
    expect(readFileSync(replacement, "utf8")).toBe("foreign");
    expect(existsSync(join(dir, "invoice.txt"))).toBe(false);
  });

  it("rejects replaced final bytes and preserves the foreign final inode", async () => {
    const dir = directory();
    let replacement = "";
    await expect(attachmentDownloadTestBoundary.writeAttachmentFile(payload(), dir, {
      afterCandidatePublish(path) { replacement = path; unlinkSync(path); writeFileSync(path, "foreign", { mode: 0o600 }); },
    })).rejects.toThrow(/inode.*changed/);
    expect(readFileSync(replacement, "utf8")).toBe("foreign");
    expect(readdirSync(dir)).toEqual(["invoice.txt"]);
  });

  it("publishes only complete content with private native creation under ordinary umasks", async () => {
    const previous = process.umask();
    try {
      for (const mask of [0o022, 0o077]) {
        process.umask(mask);
        const dir = directory();
        await attachmentDownloadTestBoundary.writeAttachmentFile(payload(), dir, {
          beforeTemporaryPublish(path) {
            expect(statSync(path).mode & 0o777).toBe(0o600);
            expect(readFileSync(path, "utf8")).toBe("hello");
            expect(existsSync(join(dir, "invoice.txt"))).toBe(false);
          },
          afterCandidatePublish(path) {
            expect(readFileSync(path, "utf8")).toBe("hello");
            expect(statSync(path).nlink).toBe(2);
          },
        });
        expect(readdirSync(dir)).toEqual(["invoice.txt"]);
      }
    } finally { process.umask(previous); }
  });

  it("does not overwrite an existing symlink or follow it to its target", async () => {
    const dir = directory();
    const victim = join(directory(), "victim.txt");
    writeFileSync(victim, "untouched");
    symlinkSync(victim, join(dir, "invoice.txt"));
    const saved = await writeAttachmentFile(payload(), dir);
    expect(saved.path).toBe(join(dir, "invoice-1.txt"));
    expect(readFileSync(victim, "utf8")).toBe("untouched");
  });

  it("rejects same-inode content mutation before or after publication", async () => {
    for (const hook of ["beforeTemporaryPublish", "afterCandidatePublish"] as const) {
      const dir = directory();
      await expect(attachmentDownloadTestBoundary.writeAttachmentFile(payload(), dir, {
        [hook](path: string) { writeFileSync(path, "other"); },
      })).rejects.toThrow(/digest.*changed/);
      expect(readdirSync(dir)).toEqual([]);
    }
  });

  it("cleans up through its original directory descriptor after an ancestor rebind", async () => {
    const parent = directory();
    const trusted = join(parent, "trusted");
    const output = join(trusted, "output");
    const displaced = join(parent, "displaced");
    const attacker = directory();
    mkdirSync(output, { recursive: true, mode: 0o700 });
    await expect(attachmentDownloadTestBoundary.writeAttachmentFile(payload(), output, {
      afterCandidatePublish() { renameSync(trusted, displaced); symlinkSync(attacker, trusted); },
    })).rejects.toThrow(/directory.*changed|ancestor.*changed/);
    expect(readdirSync(attacker)).toEqual([]);
    expect(readdirSync(join(displaced, "output"))).toEqual([]);
  });

  it("rejects untrusted directory and ancestor ownership", async () => {
    const dir = directory();
    const foreignUid = process.geteuid() + 1;
    await expect(attachmentDownloadTestBoundary.writeAttachmentFile(payload(), dir, {
      outputDirectoryOwnerUid: () => foreignUid,
    })).rejects.toThrow(/owned by the effective user/);
    await expect(attachmentDownloadTestBoundary.writeAttachmentFile(payload(), dir, {
      ancestorOwnerUid: () => foreignUid,
    })).rejects.toThrow(/ancestor.*trusted owner/);
    expect(readdirSync(dir)).toEqual([]);
  });

  it("closes the directory descriptor if the native boundary cannot be used", async () => {
    const dir = directory();
    let descriptor: number | undefined;
    await expect(attachmentDownloadTestBoundary.writeAttachmentFile(payload(), dir, {
      resolveStableDirectory(fd) { descriptor = fd; throw new Error("native boundary unavailable"); },
    })).rejects.toThrow(/native boundary unavailable/);
    expect(descriptor).toBeDefined();
    expect(() => fstatSync(descriptor!)).toThrow();
    expect(readdirSync(dir)).toEqual([]);
  });

  it("accepts Downloads-style deny ACLs and refuses ACL grants despite private POSIX mode", async () => {
    const dir = directory();
    execFileSync("/bin/chmod", ["+a", "everyone deny delete", dir]);
    try {
      await writeAttachmentFile(payload(), dir);
      execFileSync("/bin/chmod", ["+a", "everyone allow add_file", dir]);
      expect(statSync(dir).mode & 0o777).toBe(0o700);
      await expect(writeAttachmentFile(payload(), dir)).rejects.toThrow(/ACL granting access/);
      expect(readdirSync(dir)).toEqual(["invoice.txt"]);
    } finally { execFileSync("/bin/chmod", ["-N", dir]); }
  });

  it("refuses an ACL grant on an otherwise trusted ancestor", async () => {
    const parent = directory();
    const dir = join(parent, "output");
    mkdirSync(dir, { mode: 0o700 });
    execFileSync("/bin/chmod", ["+a", "everyone allow delete_child", parent]);
    await expect(writeAttachmentFile(payload(), dir)).rejects.toThrow(/ACL granting access/);
    expect(readdirSync(dir)).toEqual([]);
  });
});
