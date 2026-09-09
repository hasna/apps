import { realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fixtureStation } from "./credential-command-fixture";
import { signingFixtureCommand } from "./signing-fixture";

/** A fresh environment, not a scrubbed copy of credentials, preload options or selectors. */
export function startupFixtureEnv(home: string, extra: Record<string, string> = {}) {
  return { HOME: home, HASNA_HOME: join(home, ".hasna"), HASNA_STATION: fixtureStation,
    TMPDIR: realpathSync(tmpdir()), PATH: "/usr/bin:/bin", NO_COLOR: "1", ...extra };
}

/** Bound output and the owned child lifetime. A timeout is always a test error. */
export async function runStartupFixture(home: string, command: string[], env: Record<string, string>, input = "", boundMs = 15_000) {
  const child = Bun.spawn(signingFixtureCommand(home, command), {
    cwd: home, env, detached: true, stdin: "pipe", stdout: "pipe", stderr: "pipe",
  });
  const kill = () => {
    if (child.exitCode === null) {
      try { process.kill(process.platform === "win32" ? child.pid : -child.pid, "SIGKILL"); } catch {}
    }
  };
  let timedOut = false;
  const timer = setTimeout(() => { timedOut = true; kill(); }, boundMs);
  const read = async (stream: ReadableStream<Uint8Array>) => {
    const reader = stream.getReader(), chunks: Uint8Array[] = [];
    let size = 0;
    for (;;) {
      const { value, done } = await reader.read();
      if (done) return Buffer.concat(chunks).toString();
      size += value.byteLength;
      if (size > 64 * 1024) { kill(); throw new Error("Startup fixture output exceeded 64 KiB"); }
      chunks.push(value);
    }
  };
  try {
    if (input) child.stdin.write(input);
    child.stdin.end();
    const [exitCode, stdout, stderr] = await Promise.all([child.exited, read(child.stdout), read(child.stderr)]);
    if (timedOut) throw new Error("Startup fixture timed out");
    return { exitCode, stdout, stderr };
  } finally {
    clearTimeout(timer); kill(); await child.exited;
  }
}
