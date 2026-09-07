/** Test-only native boundary. The real contracts resolver still decides every tier. */
import { appendFileSync } from "node:fs";
import { join } from "node:path";

export const fixtureStation = "recordings-fixture";
export function fixtureKeychainResult(command: string, args: readonly string[], home: string) {
  if (command !== "/usr/bin/security" || args.length !== 6 ||
      args[0] !== "find-generic-password" || args[1] !== "-a" ||
      args[2] !== fixtureStation || args[3] !== "-s" || args[5] !== "-w" ||
      !["hasna.credentials.recordings.api-key", "hasna.credentials.recordings.api-url"].includes(args[4]!)) return undefined;
  const mode = process.env.RECORDINGS_TEST_KEYCHAIN_MODE ?? "absent";
  if (mode !== "absent" && mode !== "locked") throw new Error("Unknown fixture Keychain outcome");
  // Names and outcome only, never a credential or command stdout.
  appendFileSync(join(home, "keychain-fixture.jsonl"), JSON.stringify({ service: args[4], mode }) + "\n", { mode: 0o600 });
  return { status: mode === "absent" ? 44 : 36, stdout: "",
    stderr: mode === "absent" ? "The specified item could not be found in the keychain." : "User interaction is not allowed.", error: undefined };
}
