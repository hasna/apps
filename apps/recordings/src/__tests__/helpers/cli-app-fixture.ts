/** Test-only CLI process boundary; never imported by production. */
import { mock } from "bun:test";
import * as fs from "node:fs";
import * as childProcess from "node:child_process";
import { basename } from "node:path";
import { tmpdir } from "node:os";
const home = process.env.HOME ?? "";
const info = fs.lstatSync(home);
if (!info.isDirectory() || info.isSymbolicLink() || fs.realpathSync(home) !== home ||
    info.uid !== process.getuid?.() || (info.mode & 0o777) !== 0o700 ||
    !basename(home).startsWith("recordings-cli-") || !home.startsWith(`${fs.realpathSync(tmpdir())}/`)) {
  throw new Error("CLI fixture requires an owned canonical private HOME");
}
const args = process.argv.slice(2);
const probe = args.join(" ") === "--fixture-boundary-probe";
if (!probe && ![
  "--json app status", "app status", "app status --verbose", "--json app permissions",
  "app --help", "app snapshot --help", "--json check",
].includes(args.join(" "))) throw new Error("CLI fixture command is not allowlisted");
const refuse = () => { throw new Error("CLI fixture blocked a non-fixture process"); };
const spawnSync = (command: string, parameters: string[] = []) => {
  if (command === "/usr/bin/defaults" && parameters.length === 3 &&
      parameters[0] === "read" && parameters[1] === "com.hasna.recordings" &&
      ["useFnKey", "KeyboardShortcuts_toggleRecording"].includes(parameters[2]!)) {
    return { status: 1, stdout: "", stderr: "fixture preference is absent", error: undefined };
  }
  if (command === "/bin/ps" && parameters.join(" ") === "-Awwo comm=") {
    return { status: 0, stdout: args.join(" ") === "--json check" ? `${home}/Applications/Hasna Recordings.app/Contents/MacOS/Recordings\n` : "", stderr: "", error: undefined };
  }
  if (command === "/usr/bin/codesign" && parameters.slice(0, 3).join(" ") === "-d -r- --verbose=4" &&
      parameters.length === 4 && parameters[3]?.startsWith(`${home}/`)) {
    return { status: 1, stdout: "", stderr: "fixture bundle is unsigned", error: undefined };
  }
  return refuse();
};
mock.module("node:child_process", () => ({ ...childProcess, spawnSync, spawn: refuse,
  exec: refuse, execSync: refuse, execFile: refuse, execFileSync: refuse, fork: refuse }));
const realExists = fs.existsSync, realStat = fs.statSync;
mock.module("node:fs", () => ({ ...fs,
  existsSync: (path: fs.PathLike) => !String(path).startsWith("/Applications/") && realExists(path),
  statSync: (...params: Parameters<typeof fs.statSync>) => {
    if (String(params[0]).startsWith("/Library/Application Support/com.apple.TCC/")) {
      throw Object.assign(new Error("fixture has no system TCC database"), { code: "ENOENT" });
    }
    return realStat(...params);
  },
}));
Bun.spawn = ((command: string[]) => {
  if (args.join(" ") === "--json check" && command.join(" ") === "which rec") return { exited: Promise.resolve(0), exitCode: 0 };
  return refuse();
}) as typeof Bun.spawn;
Bun.spawnSync = refuse as typeof Bun.spawnSync;
globalThis.fetch = Object.assign(async () => refuse(), { preconnect: refuse });
if (probe) {
  const guarded = await import("node:child_process");
  const attempts = [() => guarded.spawn("/usr/bin/open", []), () => guarded.spawnSync("/usr/bin/codesign", ["--help"]),
    () => guarded.exec("open"), () => guarded.execSync("open"), () => guarded.execFile("/usr/bin/open"),
    () => guarded.execFileSync("/usr/bin/open"), () => guarded.fork("/usr/bin/open"),
    () => Bun.spawn(["rec"]), () => Bun.spawnSync(["/usr/bin/defaults"])];
  let blocked = 0;
  for (const attempt of attempts) { try { attempt(); } catch (error) { if (String(error).includes("CLI fixture blocked")) blocked++; } }
  console.log(JSON.stringify({ blocked, platform: process.platform }));
} else await import("../../cli/index.js");
