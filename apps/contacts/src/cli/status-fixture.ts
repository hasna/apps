/** Test-only subprocess launcher. No production entry point imports this file. */
import { spawnSync } from "node:child_process";
import { chmodSync, lstatSync, mkdirSync, mkdtempSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";

export type StatusFixtureMode = "unconfigured" | "failure" | "success";
export const fixtureStation = "contacts-status-fixture";
export const envFixtureKey = "status-fixture-key";
export const diskFixtureKey = "disk-key-not-a-real-secret";

export function statusFixtureEnv(): Record<string, string> {
  const home = realpathSync(mkdtempSync(join(tmpdir(), "contacts-status-")));
  chmodSync(home, 0o700);
  mkdirSync(join(home, "tmp"), { mode: 0o700 });
  mkdirSync(join(home, "bin"), { mode: 0o700 });
  // Allowlist instead of copying ambient credentials, config roots, preloads,
  // proxies or runtime options. A station name alone does NOT disable Keychain.
  return {
    HOME: home, HASNA_HOME: home, HASNA_STATION: fixtureStation,
    TMPDIR: join(home, "tmp"), PATH: join(home, "bin"), NO_COLOR: "1",
  };
}

export function statusFixtureCommand(home: string, command: string[]): string[] {
  const info = lstatSync(home);
  if (!info.isDirectory() || info.isSymbolicLink() || realpathSync(home) !== home ||
      info.uid !== process.getuid?.() || (info.mode & 0o777) !== 0o700 ||
      !basename(home).startsWith("contacts-status-") || !home.startsWith(`${realpathSync(tmpdir())}/`)) {
    throw new Error("Contacts status fixture requires an owned canonical private temporary HOME");
  }
  if (command[0] !== process.execPath) throw new Error("Contacts fixture only launches the current Bun executable");
  if (process.platform !== "darwin") return command;
  // The only executable allowed is this Bun. The preload supplies the exact
  // Keychain-absent response; a missed interception cannot run host tools.
  const profile = `(version 1)
(allow default)
(deny network*)
(deny signal)
(allow signal (target same-sandbox))
(deny process-exec (require-not (literal ${JSON.stringify(process.execPath)})))
(deny file-write* (require-all (regex #"^/") (require-not (require-any (subpath ${JSON.stringify(home)}) (literal "/dev/null")))))
(deny file-read* (subpath "/Applications") (subpath "/Library/Keychains")
  (subpath "/Library/Application Support/com.apple.TCC")
  (regex #"^/Users/[^/]+/Library/(Keychains|Preferences|Application Support/com.apple.TCC)(/|$)")
  (regex #"^/Users/[^/]+/\\.hasna(/|$)"))`;
  return ["/usr/bin/sandbox-exec", "-p", profile, ...command];
}

export function runStatusFixture(args: string[], env: Record<string, string>, mode: StatusFixtureMode = "unconfigured") {
  const command = statusFixtureCommand(env.HOME!, [process.execPath, "--preload",
    join(import.meta.dir, "status-domain.preload.ts"), join(import.meta.dir, "index.tsx"), ...args]);
  const result = spawnSync(command[0]!, command.slice(1), {
    env: { ...env, CONTACTS_STATUS_FIXTURE_MODE: mode }, cwd: env.HOME,
    encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout: 2500,
    killSignal: "SIGKILL", maxBuffer: 128 * 1024,
  });
  if (result.error || result.signal) {
    throw new Error(`Contacts status fixture child did not finish: ${(result.error as NodeJS.ErrnoException | undefined)?.code ?? result.signal}`);
  }
  return { ...result, exitCode: result.status };
}
