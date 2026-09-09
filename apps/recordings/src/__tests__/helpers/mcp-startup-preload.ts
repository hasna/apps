/** Loaded before the REAL MCP entry, preserving import.meta.main and real stdio. */
import { mock } from "bun:test";
import * as childProcess from "node:child_process";
import { lstatSync, realpathSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { tmpdir } from "node:os";
import { fixtureKeychainResult } from "./credential-command-fixture";

const home = process.env.HOME ?? "", info = lstatSync(home);
if (!info.isDirectory() || info.isSymbolicLink() || realpathSync(home) !== home ||
    info.uid !== process.getuid?.() || (info.mode & 0o777) !== 0o700 ||
    !basename(home).startsWith("recordings-mcp-") || !home.startsWith(`${realpathSync(tmpdir())}/`)) {
  throw new Error("MCP fixture requires an owned canonical private HOME");
}
const args = process.argv.slice(2);
const probe = args.join(" ") === "--fixture-boundary-probe";
if (realpathSync(process.argv[1]!) !== realpathSync(join(import.meta.dir, "../../mcp/index.ts")) ||
    (!probe && !["", "--stdio", "--version", "-V", "--help", "-h"].includes(args.join(" ")))) throw new Error("MCP fixture entry or arguments are not allowlisted");
const receipt = { platform: process.platform, denied: 0, listeners: 0, leases: 0 };
process.on("exit", () => writeFileSync(join(home, "mcp-boundary.json"), JSON.stringify(receipt), { mode: 0o600 }));
const refuse = () => { receipt.denied++; throw new Error("MCP fixture blocked host access"); };
const spawnSync = (command: string, parameters: string[] = []) => {
  const keychain = fixtureKeychainResult(command, parameters, home);
  if (keychain) return keychain;
  // Only our own local-store lease. No process enumeration or installed app identity.
  if (command === "/bin/ps" && JSON.stringify(parameters) === JSON.stringify(["-o", "lstart=", "-p", String(process.pid)])) {
    receipt.leases++;
    return { status: 0, stdout: "Mon Jan  1 00:00:00 2024\n", stderr: "", error: undefined };
  }
  return refuse();
};
mock.module("node:child_process", () => ({ ...childProcess, spawnSync, spawn: refuse,
  exec: refuse, execSync: refuse, execFile: refuse, execFileSync: refuse, fork: refuse }));
Bun.spawn = refuse as typeof Bun.spawn;
Bun.spawnSync = refuse as typeof Bun.spawnSync;
Bun.serve = (() => { receipt.listeners++; return refuse(); }) as typeof Bun.serve;
globalThis.fetch = Object.assign(async () => refuse(), { preconnect: refuse });
if (probe) {
  const guarded = await import("node:child_process");
  for (const attempt of [() => guarded.spawn("/usr/bin/open", []),
    () => guarded.spawnSync("/usr/bin/security", ["--help"]),
    () => guarded.spawnSync("/usr/bin/security", ["find-generic-password", "-a", "foreign", "-s", "hasna.credentials.recordings.api-key", "-w"]),
    () => guarded.spawnSync("/usr/bin/security", ["add-generic-password", "-a", "recordings-fixture", "-s", "hasna.credentials.recordings.api-key", "-w"]),
    () => guarded.exec("open"), () => guarded.execSync("open"),
    () => guarded.execFile("/usr/bin/defaults"), () => guarded.execFileSync("/usr/bin/defaults"),
    () => guarded.fork("/usr/bin/open"), () => Bun.spawn(["rec"]),
    () => Bun.spawnSync(["rec"]), () => Bun.serve({ port: 0, fetch: () => new Response() }),
    () => fetch("https://fixture.invalid"), () => fetch.preconnect("https://fixture.invalid")]) {
    try { await attempt(); } catch {}
  }
  process.exit(0);
}
