/**
 * Worktree sync primitives (hasna/apps#1689) — local-path tests only.
 *
 * Every test exercises the real git plumbing (fixture repos created with git
 * commands in temp dirs) and an in-memory fake of the S3 client, so nothing
 * here touches the network or a real bucket. The acceptance shape being pinned:
 * push on machine A, pull on machine B, identical tree including uncommitted
 * changes, with a manifest whose sha256 verifies.
 */
import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readlinkSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gzipSync } from "node:zlib";

import { computeWorktreePath, setClonesRootForTests, setWorktreeRootForTests } from "./worktrees.js";
import {
  REPOS_S3_BUCKET_ENV,
  WorktreeSyncError,
  WorktreeSyncRemote,
  listWorktreeVersions,
  packWorktreeSyncBundle,
  parseSyncRef,
  pullWorktree,
  pushWorktree,
  resolveWorktreeRemote,
  syncWorktree,
  unpackWorktreeSyncBundle,
  type S3ClientLike,
  type WorktreeSyncManifest,
} from "./worktree-sync.js";

setDefaultTimeout(60_000);

const tempDirs: string[] = [];
const originalMachineId = process.env["HASNA_MACHINE_ID"];

function tempRoot(label: string): string {
  const dir = join(tmpdir(), `repos-wt-sync-${label}-${Date.now()}-${Math.random().toString(16).slice(2)}`);
  mkdirSync(dir, { recursive: true });
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  setWorktreeRootForTests(null);
  setClonesRootForTests(null);
  if (originalMachineId === undefined) delete process.env["HASNA_MACHINE_ID"];
  else process.env["HASNA_MACHINE_ID"] = originalMachineId;
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function git(root: string, args: string[]): string {
  return execFileSync("git", args, { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
}

/** An in-memory S3 bucket: routing on input shape, exactly like the real commands. */
class FakeS3 implements S3ClientLike {
  readonly objects = new Map<string, Uint8Array>();
  /** After a put lands, called with (key, bytes). Tests use it to inject a phantom version. */
  onPut?: (key: string, bytes: Uint8Array) => void;

  async send(command: unknown): Promise<{ Body?: unknown; Contents?: Array<{ Key?: string }> }> {
    // The real SDK commands nest their payload under `.input`; the shape is
    // routed on fields, so both spellings are accepted.
    const nested = (command as { input?: unknown }).input;
    const input = (nested ?? command) as { Key?: string; Prefix?: string; Body?: unknown };
    if (input.Prefix !== undefined) {
      const contents = [...this.objects.keys()]
        .filter((key) => key.startsWith(input.Prefix!))
        .map((Key) => ({ Key }));
      return { Contents: contents };
    }
    if (input.Body !== undefined && input.Key !== undefined) {
      const bytes = new Uint8Array(input.Body as Uint8Array);
      this.objects.set(input.Key, bytes);
      this.onPut?.(input.Key, bytes);
      return {};
    }
    if (input.Key !== undefined) {
      const body = this.objects.get(input.Key);
      return { Body: body ? new Uint8Array(body) : undefined };
    }
    return {};
  }
}

function fakeRemote(overrides: { bucket?: string; client?: S3ClientLike; prefix?: string } = {}): WorktreeSyncRemote {
  return new WorktreeSyncRemote({ bucket: overrides.bucket ?? "test-bucket", client: overrides.client ?? new FakeS3(), prefix: overrides.prefix });
}

function concatBytes(views: Uint8Array[]): Uint8Array {
  const total = views.reduce((sum, view) => sum + view.byteLength, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const view of views) {
    out.set(view, offset);
    offset += view.byteLength;
  }
  return out;
}

/**
 * Assemble a bundle container from raw parts, mirroring the module's framing
 * (u32 index length + JSON index + u64-framed part bytes, gzip level 6).
 * Given parts keep their order. `packWorktreeSyncBundle` itself could never
 * emit the bundles this helper builds — a hostile writer can put anything in
 * a shared bucket, so the pull side must contain it.
 */
function buildBundle(parts: Array<{ path: string; bytes: Uint8Array; mode: number }>): {
  bytes: Uint8Array;
  sha256: string;
  unpackedByteSize: number;
} {
  const index = JSON.stringify(
    parts.map((part) => ({
      path: part.path,
      sha256: createHash("sha256").update(part.bytes).digest("hex"),
      size: part.bytes.byteLength,
      mode: part.mode,
    })),
  );
  const indexBytes = new TextEncoder().encode(index);
  const indexFrame = new Uint8Array(4);
  new DataView(indexFrame.buffer).setUint32(0, indexBytes.byteLength);
  const chunks: Uint8Array[] = [indexFrame, indexBytes];
  for (const part of parts) {
    const frame = new Uint8Array(8);
    new DataView(frame.buffer).setBigUint64(0, BigInt(part.bytes.byteLength));
    chunks.push(frame, part.bytes);
  }
  const payload = concatBytes(chunks);
  const bytes = gzipSync(payload, { level: 6 });
  return { bytes, sha256: createHash("sha256").update(bytes).digest("hex"), unpackedByteSize: payload.byteLength };
}

/**
 * A source repo with one commit, and (separately) a worktree on machine A for
 * it. `wt1` gets a dirty state: a modified tracked file + an untracked file.
 */
function makeMachineA(root: string): { src: string; wtPath: string } {
  const src = join(root, "src");
  mkdirSync(src, { recursive: true });
  git(src, ["init"]);
  git(src, ["config", "user.email", "a@test.local"]);
  git(src, ["config", "user.name", "Machine A"]);
  writeFileSync(join(src, "README.md"), "# demo\n");
  writeFileSync(join(src, "file.txt"), "line one\n");
  git(src, ["add", "README.md", "file.txt"]);
  git(src, ["commit", "-m", "initial"]);
  git(src, ["branch", "-M", "main"]);
  git(src, ["remote", "add", "origin", src]);

  setWorktreeRootForTests(join(root, "wtroot"));
  const wtPath = computeWorktreePath("demo", "wt1");
  mkdirSync(join(wtPath, ".."), { recursive: true });
  git(src, ["worktree", "add", "--quiet", "-b", "wt1", wtPath, "main"]);

  // Dirty state: uncommitted tracked change + untracked file.
  writeFileSync(join(wtPath, "file.txt"), "line one\nline two (uncommitted)\n");
  writeFileSync(join(wtPath, "note.txt"), "untracked note\n");
  return { src, wtPath };
}

/** Machine B: a fresh root and a fresh clone of A's source repo as parent. */
function makeMachineB(root: string, sourceRepo: string): { parent: string; wtPath: string } {
  const parent = join(root, "parent");
  setWorktreeRootForTests(join(root, "wtroot"));
  git(root, ["clone", "--quiet", sourceRepo, parent]);
  const wtPath = computeWorktreePath("demo", "wt1");
  return { parent, wtPath };
}

describe("packWorktreeSyncBundle", () => {
  test("is deterministic and round-trips through unpack with verified sha256s", () => {
    const root = tempRoot("determinism");
    const { wtPath } = makeMachineA(root);
    const first = packWorktreeSyncBundle(wtPath);
    const second = packWorktreeSyncBundle(wtPath);
    expect(second.sha256).toBe(first.sha256);
    expect(second.bytes).toEqual(first.bytes);
    expect(first.paths).toContain("worktree.patch");
    expect(first.paths).toContain("untracked/note.txt");

    const parts = unpackWorktreeSyncBundle(first.bytes);
    expect(parts.get("worktree.patch")).toBeDefined();
    const patchText = new TextDecoder().decode(parts.get("worktree.patch")!.bytes);
    expect(patchText).toContain("line two (uncommitted)");
    const untracked = parts.get("untracked/note.txt")!;
    expect(new TextDecoder().decode(untracked.bytes)).toBe("untracked note\n");
  });

  test("packs changed content to a different digest", () => {
    const root = tempRoot("changed");
    const { wtPath } = makeMachineA(root);
    const before = packWorktreeSyncBundle(wtPath);
    writeFileSync(join(wtPath, "file.txt"), "changed again\n");
    const after = packWorktreeSyncBundle(wtPath);
    expect(after.sha256).not.toBe(before.sha256);
  });

  test("never packs credential-shaped untracked files", () => {
    const root = tempRoot("credentials");
    const { wtPath } = makeMachineA(root);
    writeFileSync(join(wtPath, ".env"), "API_KEY=secret\n");
    writeFileSync(join(wtPath, ".env.example"), "API_KEY=\n");
    mkdirSync(join(wtPath, "config"), { recursive: true });
    writeFileSync(join(wtPath, "config/local.pem"), "-----BEGIN PRIVATE KEY-----\n");
    const bundle = packWorktreeSyncBundle(wtPath);
    const paths = bundle.paths;
    expect(paths.some((path) => path.endsWith("/.env") || path === "untracked/.env")).toBe(false);
    expect(paths.some((path) => path.endsWith("/.env.example"))).toBe(false);
    expect(paths.some((path) => path.endsWith("local.pem"))).toBe(false);
    // Non-credential untracked content still travels.
    expect(paths).toContain("untracked/note.txt");
  });

  test("fails closed (REMOTE_FAILED) when git plumbing errors — never a silent partial bundle", () => {
    // A directory that is not a git checkout makes `git diff` exit non-zero:
    // pre-fix pack treated any error as "no output" and returned an empty
    // bundle, so a push would 'succeed' while dropping all uncommitted state.
    const root = tempRoot("git-error");
    writeFileSync(join(root, "file.txt"), "not a git checkout\n");
    try {
      packWorktreeSyncBundle(root);
      expect.unreachable("pack must fail closed when git plumbing errors");
    } catch (error) {
      expect(error).toBeInstanceOf(WorktreeSyncError);
      expect((error as WorktreeSyncError).code).toBe("REMOTE_FAILED");
      expect((error as WorktreeSyncError).details.git_stderr).toBeTruthy();
    }
  });

  test("fails closed (REMOTE_FAILED) when the uncommitted diff exceeds runGit's 64 MB stdout cap", () => {
    // runGit caps stdout at 64 MB; a worktree whose binary diff exceeds the
    // cap used to fail silently (ok:false) and the patch part was dropped
    // while the push reported success. The pack must refuse instead.
    const root = tempRoot("oversize");
    const { wtPath } = makeMachineA(root);
    git(wtPath, ["add", "-A"]);
    git(wtPath, ["commit", "-m", "baseline"]);
    git(wtPath, ["status", "--porcelain"]); // sanity: the worktree is clean

    // 70 MiB of deterministic, incompressible content — git's binary patch
    // output for a fully-changed file exceeds the 64 MB maxBuffer (two
    // unrelated random blobs leave git's delta nothing to copy).
    const bigPath = join(wtPath, "big.bin");
    const big = Buffer.alloc(70 * 1024 * 1024);
    let state = 0x2545f491;
    for (let i = 0; i < big.length; i += 1) {
      state ^= state << 13;
      state ^= state >>> 17;
      state ^= state << 5;
      big[i] = state & 0xff;
    }
    writeFileSync(bigPath, big);
    git(wtPath, ["add", "big.bin"]);
    git(wtPath, ["commit", "-m", "big file"]);
    // Replace the content with a different random stream: the binary diff now
    // carries ~70 MB of literal data, far over the 64 MB stdout cap.
    state = 0xa5a5f3c1;
    for (let i = 0; i < big.length; i += 1) {
      state ^= state << 13;
      state ^= state >>> 17;
      state ^= state << 5;
      big[i] = state & 0xff;
    }
    writeFileSync(bigPath, big);

    try {
      packWorktreeSyncBundle(wtPath);
      expect.unreachable("pack must fail closed when the diff output is dropped by the stdout cap");
    } catch (error) {
      expect(error).toBeInstanceOf(WorktreeSyncError);
      expect((error as WorktreeSyncError).code).toBe("REMOTE_FAILED");
      expect((error as WorktreeSyncError).details.git_stderr).toMatch(/maxBuffer|exceeded|truncat|buffer/i);
    }
  });
});

describe("push and versions", () => {
  test("push publishes an immutable version and versions lists newest first", async () => {
    const root = tempRoot("push");
    const { wtPath } = makeMachineA(root);
    const remote = fakeRemote();
    const first = await pushWorktree("demo", "wt1", { remote, version: "2026-01-01T00:00:00.000Z" });
    expect(first.bundle_sha256).toMatch(/^[0-9a-f]{64}$/);

    writeFileSync(join(wtPath, "file.txt"), "line one\nline two v2\n");
    const second = await pushWorktree("demo", "wt1", { remote, version: "2026-02-01T00:00:00.000Z" });
    expect(second.version).not.toBe(first.version);

    const versions = await listWorktreeVersions("demo", "wt1", { remote });
    expect(versions.versions.map((entry) => entry.version)).toEqual([
      "2026-02-01T00:00:00.000Z",
      "2026-01-01T00:00:00.000Z",
    ]);
  });

  test("fails closed (REMOTE_NOT_CONFIGURED) when no bucket is configured", async () => {
    const root = tempRoot("nobucket");
    const { wtPath } = makeMachineA(root);
    const remote = new WorktreeSyncRemote({ client: new FakeS3() }); // bucket absent
    expect(remote.usesS3).toBe(false);
    await expect(pushWorktree("demo", "wt1", { remote })).rejects.toMatchObject({
      code: "REMOTE_NOT_CONFIGURED",
    });
  });
});

describe("remote configuration", () => {
  test("a configured bucket alone makes the remote usable — the real S3 client is lazy, never eager", () => {
    // Regression pin: production call sites construct the remote from
    // resolveWorktreeRemote() with NO injected client, so pre-fix `usesS3`
    // was always false and every verb died REMOTE_NOT_CONFIGURED even with
    // REPOS_S3_BUCKET set — the dynamic-import client branch was unreachable
    // outside tests. A bucket-only remote must be usable: the real client is
    // constructed lazily on first use from the recorded region.
    const remote = new WorktreeSyncRemote({ bucket: "test-bucket", region: "eu-west-1" });
    expect(remote.usesS3).toBe(true);
    expect(new WorktreeSyncRemote({ bucket: "test-bucket" }).usesS3).toBe(true);
    expect(new WorktreeSyncRemote().usesS3).toBe(false);
  });

  test("resolveWorktreeRemote carries the bucket and region from the environment", () => {
    expect(resolveWorktreeRemote({ [REPOS_S3_BUCKET_ENV]: "b" })).toEqual({
      bucket: "b",
      region: "us-east-1",
    });
    expect(resolveWorktreeRemote({ [REPOS_S3_BUCKET_ENV]: "b", AWS_REGION: "eu-west-1" })).toEqual({
      bucket: "b",
      region: "eu-west-1",
    });
    // No bucket → the fail-closed shape: nothing is configured, even when a
    // region is set (a region without a bucket must not half-configure).
    expect(resolveWorktreeRemote({ AWS_REGION: "eu-west-1" })).toEqual({});
    expect(resolveWorktreeRemote({})).toEqual({});
  });
});

describe("pull materialises a foreign worktree", () => {
  test("push on machine A, pull on machine B: identical tree with uncommitted changes", async () => {
    const machineA = tempRoot("machine-a");
    const { src } = makeMachineA(machineA);
    const remote = fakeRemote();
    process.env["HASNA_MACHINE_ID"] = "machine-a";

    const pushed = await pushWorktree("demo", "wt1", { remote });
    expect(pushed.version).toBeTruthy();

    // Machine B: its own root and its own clone of the source repo.
    const machineB = tempRoot("machine-b");
    const { parent, wtPath } = makeMachineB(machineB, src);
    process.env["HASNA_MACHINE_ID"] = "machine-b";

    const pulled = await pullWorktree("demo", "wt1", { remote, parentCheckout: parent, version: pushed.version });
    expect(pulled.path).toBe(wtPath);
    expect(pulled.branch).toBe("wt1");
    expect(pulled.patch_applied).toBe(true);
    expect(pulled.untracked_restored).toBe(1);

    // The tree is identical: tracked change applied, untracked file restored.
    expect(readFileSync(join(wtPath, "file.txt"), "utf8")).toBe("line one\nline two (uncommitted)\n");
    expect(readFileSync(join(wtPath, "note.txt"), "utf8")).toBe("untracked note\n");
    const status = git(wtPath, ["status", "--porcelain"]);
    expect(status).toContain("M file.txt");
    expect(status).toContain("?? note.txt");

    // The manifest carries the source machine's provenance.
    const manifest = await remote.fetchManifest("demo", "wt1", pulled.version);
    expect(manifest?.machine_id).toBe("machine-a");
    expect(manifest?.worktree_name).toBe("wt1");
  });

  test("refuses a bundle whose sha256 does not verify", async () => {
    const machineA = tempRoot("tamper-a");
    const { src, wtPath } = makeMachineA(machineA);
    const s3 = new FakeS3();
    const remote = fakeRemote({ client: s3 });
    const pushed = await pushWorktree("demo", "wt1", { remote });

    const bundleKey = [...s3.objects.keys()].find((key) => key.endsWith("/bundle.tar.gz"))!;
    const tampered = new Uint8Array(s3.objects.get(bundleKey)!);
    tampered[tampered.length - 1] ^= 0xff; // flip one byte: the digest must no longer hold
    s3.objects.set(bundleKey, tampered);

    const machineB = tempRoot("tamper-b");
    const { parent } = makeMachineB(machineB, src);
    process.env["HASNA_MACHINE_ID"] = "machine-b";
    await expect(
      pullWorktree("demo", "wt1", { remote, parentCheckout: parent, version: pushed.version }),
    ).rejects.toMatchObject({ code: "BUNDLE_VERIFICATION_FAILED" });
  });

  test("pull off a specific version", async () => {
    const root = tempRoot("pin");
    const { wtPath, src } = makeMachineA(root);
    const remote = fakeRemote();
    const v1 = await pushWorktree("demo", "wt1", { remote, version: "2026-01-01T00:00:00.000Z" });
    writeFileSync(join(wtPath, "file.txt"), "v2 content\n");
    await pushWorktree("demo", "wt1", { remote, version: "2026-02-01T00:00:00.000Z" });

    const machineB = tempRoot("pin-b");
    const { parent, wtPath: wtB } = makeMachineB(machineB, src);
    const pulled = await pullWorktree("demo", "wt1", { remote, parentCheckout: parent, version: v1.version });
    expect(pulled.version).toBe("2026-01-01T00:00:00.000Z");
    expect(readFileSync(join(wtB, "file.txt"), "utf8")).toBe("line one\nline two (uncommitted)\n");
  });
});

describe("byte fidelity through pack and pull", () => {
  test("restores non-UTF8 bytes inside changed lines of text files byte-exactly (the patch is never decoded as UTF-8)", async () => {
    const machineA = tempRoot("latin-a");
    const { src, wtPath } = makeMachineA(machineA);
    // Legacy-encoded text: byte 0xE9 (latin-1 "é") with no NUL anywhere, so
    // git treats the file as TEXT and the diff output carries the raw byte in
    // context around the changed line. Decoding that output as UTF-8 would
    // corrupt 0xE9 to U+FFFD (EF BF BD) in the stored patch — and on pull the
    // corruption would land in the file.
    const original = Buffer.from("café on the first line\nsecond line\nthird line\n", "latin1");
    const modified = Buffer.from("café on the first line\nsecond line CHANGED\nthird line\n", "latin1");
    writeFileSync(join(wtPath, "legacy.txt"), original);
    git(wtPath, ["add", "legacy.txt"]);
    git(wtPath, ["commit", "-m", "legacy-encoded text"]);
    writeFileSync(join(wtPath, "legacy.txt"), modified);

    const remote = fakeRemote();
    const pushed = await pushWorktree("demo", "wt1", { remote });

    const machineB = tempRoot("latin-b");
    const { parent, wtPath: wtB } = makeMachineB(machineB, src);
    const pulled = await pullWorktree("demo", "wt1", { remote, parentCheckout: parent, version: pushed.version });
    expect(pulled.patch_applied).toBe(true);
    const restored = readFileSync(join(wtB, "legacy.txt"));
    expect(restored).toEqual(modified);
    expect(restored.includes(0xe9)).toBe(true);
    expect(restored.includes(0xef)).toBe(false); // no U+FFFD (EF BF BD) corruption
  });

  test("round-trips untracked filenames with leading or trailing whitespace byte-exactly", async () => {
    const machineA = tempRoot("space-a");
    const { src, wtPath } = makeMachineA(machineA);
    // Names that a lossy trim of the -z listing would corrupt when they land
    // on the first or last entry of the listing (" note.txt" sorts first).
    writeFileSync(join(wtPath, " note.txt"), "leading space\n");
    writeFileSync(join(wtPath, "note.txt "), "trailing space\n");
    const remote = fakeRemote();
    const pushed = await pushWorktree("demo", "wt1", { remote });

    const machineB = tempRoot("space-b");
    const { parent, wtPath: wtB } = makeMachineB(machineB, src);
    const pulled = await pullWorktree("demo", "wt1", { remote, parentCheckout: parent, version: pushed.version });
    expect(pulled.untracked_restored).toBe(3);
    expect(readFileSync(join(wtB, " note.txt"), "utf8")).toBe("leading space\n");
    expect(readFileSync(join(wtB, "note.txt "), "utf8")).toBe("trailing space\n");
  });
});

describe("pull refuses hostile bundles that would escape the worktree", () => {
  test("untracked parts whose path crosses a symlink planted by the bundle's own patch are refused — nothing is written outside the worktree", async () => {
    const machineA = tempRoot("hostile-a");
    const { src } = makeMachineA(machineA);
    const s3 = new FakeS3();
    const remote = fakeRemote({ client: s3 });
    // A legitimate push first: its manifest carries a head/base machine B's
    // parent clone can reach. The published objects are then REPLACED with
    // hostile bytes — in the design every station pushes to the same bucket,
    // so bundle and manifest bytes are fully writer-controlled.
    const pushed = await pushWorktree("demo", "wt1", { remote });
    const bundleKey = remote.fileKeyFor("demo", "wt1", pushed.version, "bundle.tar.gz");
    const manifestKey = remote.fileKeyFor("demo", "wt1", pushed.version, "manifest.json");

    const machineB = tempRoot("hostile-b");
    const { parent, wtPath } = makeMachineB(machineB, src);
    const escapeDir = join(machineB, "escaped-outside");
    mkdirSync(escapeDir, { recursive: true });

    // The hostile patch materialises a symlink `sub` -> escapeDir (git apply
    // creates symlinks from mode-120000 patches); the untracked part
    // `sub/pwn.txt` then resolves THROUGH that symlink, out of the worktree,
    // if the restore loop writes without lstat'ing path components.
    const patchText =
      "diff --git a/sub b/sub\n" +
      "new file mode 120000\n" +
      `index 0000000..${createHash("sha1").update(Buffer.from(escapeDir)).digest("hex")}\n` +
      "--- /dev/null\n" +
      "+++ b/sub\n" +
      "@@ -0,0 +1 @@\n" +
      `+${escapeDir}\n` +
      "\\ No newline at end of file";
    // Order matters: the escaping write is listed FIRST, so a regression writes
    // the escape file before it could crash on the `untracked/sub` part.
    const hostile = buildBundle([
      { path: "worktree.patch", bytes: new TextEncoder().encode(patchText), mode: 0 },
      { path: "untracked/sub/pwn.txt", bytes: new TextEncoder().encode("pwned\n"), mode: 0o644 },
      { path: "untracked/sub", bytes: new TextEncoder().encode("through-the-link\n"), mode: 0o644 },
      { path: "untracked/safe.txt", bytes: new TextEncoder().encode("fine\n"), mode: 0o644 },
    ]);
    s3.objects.set(bundleKey, hostile.bytes);
    const manifest = JSON.parse(new TextDecoder().decode(s3.objects.get(manifestKey)!)) as WorktreeSyncManifest;
    manifest.bundle_sha256 = hostile.sha256;
    manifest.bundle_byte_size = hostile.bytes.byteLength;
    manifest.unpacked_byte_size = hostile.unpackedByteSize;
    manifest.includes = { patch: true, untracked: 3, stash: 0 };
    s3.objects.set(manifestKey, new TextEncoder().encode(JSON.stringify(manifest)));

    const pulled = await pullWorktree("demo", "wt1", { remote, parentCheckout: parent, version: pushed.version });
    // The patch applied (the symlink exists), but neither untracked part that
    // crosses it was written: no file escaped, and the write AT the symlink
    // itself was refused rather than crashing the pull.
    expect(pulled.patch_applied).toBe(true);
    expect(readlinkSync(join(wtPath, "sub"))).toBe(escapeDir);
    expect(pulled.untracked_restored).toBe(1);
    expect(existsSync(join(escapeDir, "pwn.txt"))).toBe(false);
    expect(readFileSync(join(wtPath, "safe.txt"), "utf8")).toBe("fine\n");
  });
});

describe("sync", () => {
  test("pushes and reports no conflict when nothing appeared in between", async () => {
    const root = tempRoot("sync-ok");
    const { wtPath } = makeMachineA(root);
    const remote = fakeRemote();
    const result = await syncWorktree("demo", "wt1", { remote });
    expect(result.conflict).toBe(false);
    expect(result.pushed_version).toBe(result.remote_latest);
  });

  test("reports a conflict result when a newer version appears after our push — the refusal rides the result, and the sync CLI raises SYNC_CONFLICT from it", async () => {
    const root = tempRoot("sync-conflict");
    const { wtPath } = makeMachineA(root);
    const s3 = new FakeS3();
    const remote = fakeRemote({ client: s3 });

    const result = await syncWorktree("demo", "wt1", { remote });
    expect(result.conflict).toBe(false);

    // A foreign version lands on the remote (simulating another station
    // pushing while we were about to sync again): sync must refuse, never
    // overwrite.
    const foreign: WorktreeSyncManifest = await remote.fetchManifest("demo", "wt1", result.pushed_version).then((manifest) => manifest!);
    const foreignBytes = s3.objects.get(remote.fileKeyFor("demo", "wt1", result.pushed_version, "bundle.tar.gz"))!;
    const phantom = { ...foreign, version: "9999-12-31T00:00:00.000Z", machine_id: "other-station" };
    s3.objects.set(
      remote.fileKeyFor("demo", "wt1", phantom.version, "bundle.tar.gz"),
      new Uint8Array(foreignBytes),
    );
    s3.objects.set(
      remote.fileKeyFor("demo", "wt1", phantom.version, "manifest.json"),
      new TextEncoder().encode(JSON.stringify(phantom)),
    );

    const second = await syncWorktree("demo", "wt1", { remote });
    expect(second.conflict).toBe(true);
    expect(second.conflict_detail).toContain("9999-12-31");
    // The phantom version is still the newest — nothing was overwritten.
    const versions = await listWorktreeVersions("demo", "wt1", { remote });
    expect(versions.versions[0]!.version).toBe("9999-12-31T00:00:00.000Z");
  });
});

describe("parseSyncRef", () => {
  test("accepts repo/name and repo/name@version, refuses paths and bare names", () => {
    expect(parseSyncRef("demo/wt1")).toEqual({ repoName: "demo", worktreeName: "wt1" });
    expect(parseSyncRef("demo/wt1@2026-01-01T00:00:00.000Z")).toEqual({
      repoName: "demo",
      worktreeName: "wt1",
      version: "2026-01-01T00:00:00.000Z",
    });
    for (const bad of ["/abs/path", "wt1", "a/b/c", "demo/wt1@", "..", "demo/../x"]) {
      expect(() => parseSyncRef(bad)).toThrow(WorktreeSyncError);
    }
  });
});