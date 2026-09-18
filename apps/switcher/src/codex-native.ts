import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { constants } from "node:fs";
import { lstat, open, realpath } from "node:fs/promises";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { promisify } from "node:util";
import releases from "./codex-native-releases.json";
import { Fault } from "./domain";
import { assertNativeStateDirectory } from "./native-state";

for (const release of Object.values(releases)) Object.freeze(release);
Object.freeze(releases);

export type CodexNativeRelease = (typeof releases)[keyof typeof releases];
export type CodexNativeInstallation = { executable: string; guard: () => Promise<void> };
const execute = promisify(execFile);
const refusal = () => new Fault(422, "codex_native_unverified", "The accepted Codex auth-home installation is absent, incompatible or changed. Install the reviewed native release before launching; PATH binaries and mutable trust overrides are not accepted.");
const canonical = (path: string) => isAbsolute(path) && resolve(path) === path && !/[\x00-\x1f\x7f]/.test(path);

/** HOME is intentionally not an installation authority. Bun's homedir/userInfo
 * can follow that environment variable; query the OS account by numeric UID. */
export async function codexInstallationAccountHome(): Promise<string> {
  const uid = process.getuid?.();
  const utility = process.platform === "darwin" ? "/usr/bin/dscacheutil" : process.platform === "linux" ? "/usr/bin/getent" : undefined;
  if (uid === undefined || !utility) throw refusal();
  const path = await realpath(utility);
  const file = await lstat(path);
  if (!file.isFile() || file.uid !== 0 || (file.mode & 0o022) || !(file.mode & 0o111)) throw refusal();
  for (const first of new Set([dirname(path), dirname(utility)])) {
    for (let parent = first;; parent = dirname(parent)) {
      const entry = await lstat(parent);
      if (!entry.isDirectory() || entry.isSymbolicLink() || entry.uid !== 0 || (entry.mode & 0o022)) throw refusal();
      if (parent === dirname(parent)) break;
    }
  }
  const { stdout } = await execute(path, process.platform === "darwin" ? ["-q", "user", "-a", "uid", String(uid)] : ["passwd", String(uid)],
    { cwd: "/", env: { PATH: "/usr/bin:/bin", LANG: "C", LC_ALL: "C" }, timeout: 2000, maxBuffer: 8192 });
  let home: string | undefined;
  if (process.platform === "darwin") {
    const records = stdout.trim().split(/\n\s*\n/);
    if (records.length !== 1) throw refusal();
    const ids = records[0].split("\n").filter(line => line.startsWith("uid: "));
    const homes = records[0].split("\n").filter(line => line.startsWith("dir: "));
    if (ids.length !== 1 || ids[0] !== `uid: ${uid}` || homes.length !== 1) throw refusal();
    home = homes[0].slice(5);
  } else {
    const records = stdout.trimEnd().split("\n"), fields = records[0].split(":");
    if (records.length !== 1 || fields.length !== 7 || fields[2] !== String(uid)) throw refusal();
    home = fields[5];
  }
  if (!home || !canonical(home)) throw refusal();
  return home;
}

export async function codexDirectoryGuard(path: string, privateRoot = false): Promise<() => Promise<void>> {
  const identity = async () => {
    if (!canonical(path)) throw refusal();
    await assertNativeStateDirectory(path);
    const entry = await lstat(path, { bigint: true });
    if (privateRoot && (entry.mode & 0o077n)) throw refusal();
    return [entry.dev, entry.ino, entry.uid, entry.gid, entry.mode].join(":");
  };
  const before = await identity();
  return async () => { if (await identity() !== before) throw refusal(); };
}

/** Snapshot a bounded regular file without following links. Only small config
 * files may omit a digest; native release members always use package pins. */
export async function codexFileGuard(path: string, maximum: number, digest?: string, executable = false): Promise<() => Promise<void>> {
  const inspect = async () => {
    if (!canonical(path) || await realpath(path) !== path) throw refusal();
    await assertNativeStateDirectory(dirname(path));
    const entry = await lstat(path, { bigint: true });
    if (!entry.isFile() || entry.nlink !== 1n || ![0n, BigInt(process.getuid?.() ?? -1)].includes(entry.uid)
        || (entry.mode & 0o022n) || entry.size > BigInt(maximum) || executable && !(entry.mode & 0o111n)) throw refusal();
    return { entry, stamp: [entry.dev, entry.ino, entry.uid, entry.gid, entry.mode, entry.nlink, entry.size, entry.mtimeNs, entry.ctimeNs].join(":") };
  };
  const before = await inspect();
  const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const opened = await handle.stat({ bigint: true });
    if (opened.dev !== before.entry.dev || opened.ino !== before.entry.ino) throw refusal();
    const hash = createHash("sha256"), chunk = Buffer.alloc(64 * 1024);
    let bytes = 0;
    for (;;) {
      const { bytesRead } = await handle.read(chunk, 0, chunk.length, bytes);
      if (!bytesRead) break;
      bytes += bytesRead;
      if (bytes > maximum) throw refusal();
      hash.update(chunk.subarray(0, bytesRead));
    }
    if (BigInt(bytes) !== before.entry.size || digest !== undefined && hash.digest("hex") !== digest) throw refusal();
  } finally { await handle.close(); }
  const guard = async () => { if ((await inspect()).stamp !== before.stamp) throw refusal(); };
  await guard();
  return guard;
}

/** Consumer-local verification primitive. It never reads receipt bodies, starts
 * a binary or installs files. Only inspectCodexNative selects production pins. */
export async function verifyCodexInstallation(directory: string, release: CodexNativeRelease): Promise<CodexNativeInstallation> {
  const root = await codexDirectoryGuard(directory, true);
  const executable = join(directory, "codex-subscriptions-candidate");
  if (!Number.isSafeInteger(release.binaryBytes) || release.binaryBytes < 1 || release.binaryBytes > 2 * 1024 ** 3
      || ![release.binarySha256, release.patchManifestSha256, release.evidenceSha256].every(value => /^[a-f0-9]{64}$/.test(value))) throw refusal();
  const guards = [root,
    await codexFileGuard(executable, release.binaryBytes, release.binarySha256, true),
    await codexFileGuard(join(directory, "patch-manifest.json"), 1024 * 1024, release.patchManifestSha256),
    await codexFileGuard(join(directory, "release-evidence.json"), 1024 * 1024, release.evidenceSha256)];
  if ((await lstat(executable)).size !== release.binaryBytes) throw refusal();
  const guard = async () => { for (const check of guards) await check(); };
  await guard();
  return { executable, guard };
}

/** Read-only package authority. Neither an override path nor HOME can nominate
 * a new binary. A supplied executable must be the exact accepted installation. */
export async function inspectCodexNative(override?: string): Promise<CodexNativeInstallation> {
  try {
    const release = releases[`${process.platform}:${process.arch}` as keyof typeof releases];
    if (!release) throw refusal();
    const home = await codexInstallationAccountHome();
    const directory = join(home, ".hasna", "native", "codex", release.target, release.binarySha256);
    if (override !== undefined && override !== join(directory, "codex-subscriptions-candidate")) throw refusal();
    return await verifyCodexInstallation(directory, release);
  } catch { throw refusal(); }
}

/** Pin optional canonical config presence as well as its inode and contents. */
export async function codexConfigGuard(home: string): Promise<() => Promise<void>> {
  const path = join(home, "config.toml");
  try { return await codexFileGuard(path, 1024 * 1024); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    return async () => {
      try { await lstat(path); } catch (missing) { if ((missing as NodeJS.ErrnoException).code === "ENOENT") return; throw missing; }
      throw refusal();
    };
  }
}
