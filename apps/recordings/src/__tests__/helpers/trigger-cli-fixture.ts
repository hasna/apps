/** Test entry point only; never imported by a production CLI or published. */
import { mock } from "bun:test";
import * as childProcess from "node:child_process";
import * as fs from "node:fs";
import { basename, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { fixtureKeychainResult } from "./credential-command-fixture";

const args = process.argv.slice(2);
const pinningProbe = args.length === 1 && args[0] === "--verify-darwin-pinning";
const allowedCommands = [
  ["check"], ["--json", "check"], ["--json", "app", "status"],
  ["shortcut", "--fn", "on"],
];
if (!pinningProbe && !allowedCommands.some((command) => JSON.stringify(command) === JSON.stringify(args))) {
  throw new Error("trigger fixture command is not allowlisted");
}
const home = process.env.HOME ?? "";
const details = fs.lstatSync(home);
if (fs.realpathSync(home) !== home || !details.isDirectory() || details.isSymbolicLink() || details.uid !== process.getuid?.() ||
    (details.mode & 0o777) !== 0o700 ||
    !basename(home).startsWith("recordings-trigger-") ||
    !fs.realpathSync(home).startsWith(`${fs.realpathSync(tmpdir())}/`)) {
  throw new Error("trigger fixture requires an owned private temporary HOME");
}

// Production pins macOS tools and MUST ignore override environment variables.
// Intercept the pinned tool at the process boundary on Darwin; do not bypass
// its production branches. Only the explicit unsupported-host case uses Linux.
// A future platform regression must fail
// before it could run real defaults, launch an app, capture audio or reset TCC.
Object.defineProperty(process, "platform", {
  value: pinningProbe ? "darwin" : process.env.RECORDINGS_TEST_DEFAULTS_EXECUTABLE ? process.platform : "linux",
});
const allowedExecutables = new Set<string>();
for (const key of ["RECORDINGS_TEST_DEFAULTS_EXECUTABLE", "RECORDINGS_TEST_PS_EXECUTABLE"]) {
  const path = process.env[key];
  if (!path) continue;
  const file = fs.lstatSync(path);
  if (!file.isFile() || file.isSymbolicLink() || resolve(path) !== join(home, basename(path)) ||
      file.uid !== details.uid || (file.mode & 0o022) !== 0) {
    throw new Error("trigger fixture executable must be an owned file in its HOME");
  }
  allowedExecutables.add(path);
}
const rejectProcess = () => { throw new Error("trigger fixture blocked a non-fixture process"); };
const realSpawnSync = childProcess.spawnSync;
const realExistsSync = fs.existsSync;
const realStatSync = fs.statSync;
const guardedSpawnSync = (...parameters: Parameters<typeof childProcess.spawnSync>) => {
  const keychain = !pinningProbe ? fixtureKeychainResult(parameters[0], (parameters[1] ?? []) as string[], home) : undefined;
  if (keychain) return keychain;
  if (!pinningProbe) {
    if (parameters[0] === "/usr/bin/defaults") parameters[0] = process.env.RECORDINGS_TEST_DEFAULTS_EXECUTABLE ?? "";
    if (parameters[0] === "/bin/ps") parameters[0] = process.env.RECORDINGS_TEST_PS_EXECUTABLE ?? "";
  }
  if (!allowedExecutables.has(parameters[0])) return rejectProcess();
  return realSpawnSync(...parameters);
};
mock.module("node:child_process", () => ({
  ...childProcess,
  spawnSync: guardedSpawnSync,
  spawn: rejectProcess, exec: rejectProcess, execSync: rejectProcess,
  execFile: rejectProcess, execFileSync: rejectProcess, fork: rejectProcess,
}));
// Installed bundles and permission databases belong only to the fixture HOME.
mock.module("node:fs", () => ({
  ...fs,
  existsSync: (path: fs.PathLike) => !String(path).startsWith("/Applications/") && realExistsSync(path),
  statSync: (...parameters: Parameters<typeof fs.statSync>) => {
    if (String(parameters[0]).startsWith("/Library/Application Support/com.apple.TCC/")) {
      throw Object.assign(new Error("fixture has no system TCC database"), { code: "ENOENT" });
    }
    return realStatSync(...parameters);
  },
}));
Bun.spawn = ((command: string[]) => {
  if (JSON.stringify(command) !== JSON.stringify(["which", "rec"])) return rejectProcess();
  return { exited: Promise.resolve(0), exitCode: 0 };
}) as typeof Bun.spawn;
const spawnSync = Bun.spawnSync.bind(Bun);
Bun.spawnSync = ((...parameters: Parameters<typeof Bun.spawnSync>) => {
  const first: unknown = parameters[0];
  const command = Array.isArray(first) ? first : (first as { cmd?: unknown[] }).cmd;
  if (!command || !allowedExecutables.has(String(command[0]))) return rejectProcess();
  return spawnSync(...parameters);
}) as typeof Bun.spawnSync;
const rejectNetwork = () => { throw new Error("trigger fixture blocked network access"); };
globalThis.fetch = Object.assign(async () => rejectNetwork(), { preconnect: rejectNetwork });
process.env.HASNA_RECORDINGS_LOCAL = "1";

if (pinningProbe) {
  const { TRIGGER_DEFAULTS_EXECUTABLE, readTriggerState } = await import("../../cli/macos-shortcut.js");
  let blocked = false;
  try { readTriggerState(); } catch (error) {
    blocked = error instanceof Error && error.message === "trigger fixture blocked a non-fixture process";
  }
  const guarded = await import("node:child_process");
  const attempts: Record<string, () => unknown> = {
    spawn: () => guarded.spawn("/usr/bin/defaults", ["read", "com.hasna.recordings", "useFnKey"]),
    spawnSync: () => guarded.spawnSync("/usr/bin/defaults", ["read", "com.hasna.recordings", "useFnKey"]),
    exec: () => guarded.exec("/usr/bin/defaults read com.hasna.recordings useFnKey"),
    execSync: () => guarded.execSync("/usr/bin/defaults read com.hasna.recordings useFnKey"),
    execFile: () => guarded.execFile("/usr/bin/defaults", ["read", "com.hasna.recordings", "useFnKey"]),
    execFileSync: () => guarded.execFileSync("/usr/bin/defaults", ["read", "com.hasna.recordings", "useFnKey"]),
    fork: () => guarded.fork("/usr/bin/defaults"),
    bunSpawn: () => Bun.spawn(["/usr/bin/defaults", "read", "com.hasna.recordings", "useFnKey"]),
    bunSpawnSync: () => Bun.spawnSync(["/usr/bin/defaults", "read", "com.hasna.recordings", "useFnKey"]),
  };
  const denied: string[] = [];
  for (const [name, attempt] of Object.entries(attempts)) {
    try { attempt(); } catch (error) {
      if (error instanceof Error && error.message === "trigger fixture blocked a non-fixture process") denied.push(name);
    }
  }
  console.log(JSON.stringify({ defaults: TRIGGER_DEFAULTS_EXECUTABLE, blocked, denied }));
} else {
  await import("../../cli/index.js");
}
