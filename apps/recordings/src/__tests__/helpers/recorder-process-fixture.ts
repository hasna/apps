/** Preloaded only by the confined recorder test runner. */
import { mock } from "bun:test";
import * as childProcess from "node:child_process";
const refuse = () => { throw new Error("recorder fixture blocked host process execution"); };
mock.module("node:child_process", () => ({ ...childProcess,
  spawn: refuse, exec: refuse, execSync: refuse, execFile: refuse, execFileSync: refuse, fork: refuse,
  spawnSync: (command: string, args: string[]) => {
    if (command === "/bin/ps" && args.join(" ") === `-o lstart= -p ${process.pid}`) {
      return { status: 0, stdout: "Mon Sep 7 12:00:00 2026", stderr: "" };
    }
    return refuse();
  },
}));
Bun.spawn = refuse as typeof Bun.spawn;
Bun.spawnSync = refuse as typeof Bun.spawnSync;
globalThis.fetch = Object.assign(async () => refuse(), { preconnect: refuse });
