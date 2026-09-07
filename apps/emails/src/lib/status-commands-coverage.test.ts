// CLASS-LEVEL guard: the refusal registry is checked against the CLI, not itself.
//
// THE DEFECT THIS GUARDS. src/lib/status-commands.ts documented its source of
// truth as `grep -n 'serverOnly(' src/cli/commands/*.remote.ts`. That glob is
// wrong twice over: `serverOnly()` is also defined and called in the SHARED
// modules src/cli/commands/domain.ts and src/cli/commands/address.ts, and their
// helper throws UNCONDITIONALLY — there is no mode in which those commands run.
// Fifteen refusals were missing from the registry, so `emails status` against a
// server holding a failed domain emitted
//
//   next_actions[0].command = "emails domain status --json"
//
// (the deleted HTTP-arm status module's domainFixCommands -> agent-context.ts
// buildNextActions), and `isCommandAvailableInMode` waved it through. Running it
// throws "emails domain status is not available in the self-hosted client" — the
// exact "remedy that refuses" defect the registry was introduced to remove.
//
// WHY THE EXISTING TESTS COULD NOT CATCH IT. agent-context.local.test.ts asserted
// `isCommandAvailableInMode(action.command, "local") === true` — the payload
// validated against the same registry that filtered it, so a command missing from
// the registry passes while it throws. A guard whose oracle is the thing under
// test proves nothing. This file's oracle is the CLI source.
//
// Precedent for source-scanning tests here: src/lib/status-fabrication-scan.test.ts,
// src/server/self-hosted/list-order.test.ts, src/no-cloud-boundary.test.ts.

import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  NEVER_AVAILABLE_COMMANDS,
  SELF_HOSTED_REFUSED_COMMANDS,
  isCommandAvailableInMode,
} from "./status-commands.js";

const COMMANDS_DIR = join(import.meta.dir, "..", "cli", "commands");

import { scanCliRefusals as scanRefusals, scanCliRefusalSource, REFUSAL_HELPERS } from "../test-support/cli-refusals.js";

function covered(command: string, prefixes: readonly string[]): boolean {
  return prefixes.some((prefix) => command === prefix || command.startsWith(`${prefix} `));
}

describe("refusal registry covers every CLI refusal call site", () => {
  const refusals = scanRefusals();

  it("proves every refusal helper and partition using the live source parser", () => {
    for (const helper of REFUSAL_HELPERS) for (const [file, shared] of [["fixture.ts", true], ["fixture.remote.ts", false], ["fixture.local.ts", false]] as const) {
      expect(scanCliRefusalSource(`${helper}("emails fixture unavailable");`, file)).toEqual([{command:"emails fixture unavailable",file,shared,helper}]);
    }
    expect(scanCliRefusalSource("function serverOnly(command: string) {}", "fixture.ts")).toEqual([]);
  });

  // The check that survives every count reaching zero. Both directions are asserted:
  // a regex that stopped matching would silently empty the scan, and one widened
  // until it matches anything would flag unrelated code.
  it("proves the refusal scan still fires, independently of repo content", () => {
    const matches = (source: string): string[] =>
      scanCliRefusalSource(source, "fixture.ts").map(item => item.command);

    for (const hit of [
      'serverOnly("emails schedule run");',
      'notImplementedAnywhere("emails provision");',
      '  try { serverOnly( "emails batch" ); } catch (e) { handleError(e); }',
    ]) {
      expect(matches(hit).length, hit).toBeGreaterThan(0);
    }
    for (const miss of [
      "function serverOnly(command: string): never {",
      "notImplementedAnywhere(command);",
      "// serverOnly is described in prose here",
    ]) {
      expect(matches(miss).filter((c) => c.startsWith("emails ")), miss).toEqual([]);
    }
    // The partition rule: only `*.remote.ts` / `*.local.ts` are mode-specific.
    for (const [file, shared] of [
      ["misc.remote.ts", false], ["misc.local.ts", false], ["domain.ts", true], ["provision.ts", true],
    ] as const) {
      expect(scanCliRefusalSource('serverOnly("emails fixture");', file)[0]?.shared, file).toBe(shared);
    }
  });

  // The scan's BLIND SPOT, stated so it cannot be mistaken for coverage: `:57` drops
  // any literal that does not start with `emails `, and flag-conditional refusals are
  // inline `handleError(new Error(...))` calls with no literal at all. Neither can
  // ever appear in `refusals`, so neither is protected by the assertions below.
  // src/lib/status-commands.test.ts pins those by name instead.
  it("declares what the scan cannot see", () => {
    const inbox = readFileSync(join(COMMANDS_DIR, "inbox.remote.ts"), "utf8");
    expect(inbox).not.toContain('serverOnly("listen")');
    expect(inbox).toContain("startApiSmtpListener(Number(opts.port), opts.provider)");
    expect(isCommandAvailableInMode("emails inbox listen", "self_hosted")).toBe(true);
    for (const operation of ["sync-s3", "watch"]) {
      expect(inbox).not.toContain(`serverOnly("${operation}")`);
      expect(inbox).toContain(`.action(ingestAction("${operation}"))`);
      expect(isCommandAvailableInMode(`emails inbox ${operation}`, "self_hosted")).toBe(true);
    }
    expect(inbox).not.toContain('serverOnly("setup-realtime")');
    expect(isCommandAvailableInMode("emails inbox setup-realtime example.com", "self_hosted")).toBe(true);
    // `inbox unread-count --by-address` USED to be a flag-conditional refusal here;
    // it is now served by the /v1 endpoint, so the refusal literal must be gone and
    // the flag form must never appear on any refusal-derived suggestion list.
    expect(inbox).not.toContain("`inbox unread-count --by-address` is not available");
    expect(refusals.map((r) => r.command)).not.toContain("emails inbox unread-count --by-address");
  });

  // The regression, named. These are the call sites the `*.remote.ts` glob missed.
  //
  // `emails domain check` was on this list until it was WIRED UP: its whole
  // implementation already shipped in src/lib/dns-check.ts and no command reached
  // it. It is asserted absent below rather than quietly dropped, so the day
  // someone re-refuses it this test says so.
  it("sees the shared-module refusals the original grep could not", () => {
    const shared = refusals.filter((r) => r.shared).map((r) => r.command);
    expect(shared).not.toContain("emails domain status");
    expect(shared).not.toContain("emails domain verify");
    expect(shared).not.toContain("emails address provision");
    expect(shared).not.toContain("emails provision domain");
    expect(isCommandAvailableInMode("emails address provision ops@example.com", "self_hosted")).toBe(true);
    expect(isCommandAvailableInMode("emails provision address ops@example.com", "self_hosted")).toBe(true);
  });

  it("no longer counts the DNS commands that were wired to their libraries", () => {
    const shared = refusals.filter((r) => r.shared).map((r) => r.command);
    for (const wired of [
      "emails domain check",
      "emails domains check",
      "emails domain dns",
      "emails domains dns",
    ]) {
      expect(shared, `${wired} refuses again — is that intended?`).not.toContain(wired);
      // And the registry must not still be suppressing them from every
      // suggestion path: the coverage check above only fails in one direction.
      for (const mode of ["local", "self_hosted"] as const) {
        expect(isCommandAvailableInMode(`${wired} example.com`, mode), `${wired} in ${mode}`).toBe(true);
      }
    }
  });

  it("registers every unconditional refusal in NEVER_AVAILABLE_COMMANDS", () => {
    const missing = refusals
      .filter((r) => r.shared && !covered(r.command, NEVER_AVAILABLE_COMMANDS))
      .map((r) => `${r.file}: ${r.command}`);
    expect(missing, "these commands throw in EVERY mode but the registry does not "
      + "know, so status/next_actions/fix_commands can still propose them — add a "
      + "prefix to NEVER_AVAILABLE_COMMANDS:\n" + missing.join("\n")).toEqual([]);
  });

  it("registers every self-hosted-only refusal in SELF_HOSTED_REFUSED_COMMANDS", () => {
    const missing = refusals
      .filter((r) => !r.shared)
      .filter((r) => !covered(r.command, SELF_HOSTED_REFUSED_COMMANDS)
        && !covered(r.command, NEVER_AVAILABLE_COMMANDS))
      .map((r) => `${r.file}: ${r.command}`);
    expect(missing, "these commands refuse in self_hosted mode but the registry "
      + "does not know:\n" + missing.join("\n")).toEqual([]);
  });

  // The registry exists to be consulted, so assert the consulted ANSWER, not just
  // list membership: a covered prefix that isCommandAvailableInMode disagrees with
  // would be a silent hole.
  it("answers `unavailable` for every scanned refusal, in the mode that refuses", () => {
    const wrong: string[] = [];
    for (const refusal of refusals) {
      if (refusal.shared) {
        for (const mode of ["local", "self_hosted"] as const) {
          if (isCommandAvailableInMode(refusal.command, mode)) {
            wrong.push(`${refusal.command} reported available in ${mode} (${refusal.file})`);
          }
        }
      } else if (isCommandAvailableInMode(refusal.command, "self_hosted")) {
        wrong.push(`${refusal.command} reported available in self_hosted (${refusal.file})`);
      }
    }
    expect(wrong).toEqual([]);
  });

  // Counter-control: the registry must not refuse the commands the payload leans
  // on as remedies, or "never propose a refusal" would be satisfied by proposing
  // nothing at all.
  it("still reports the real remedies as available in both modes", () => {
    for (const command of [
      "emails domain list --json",
      "emails address list --json",
      "emails address add ops@example.com --provider p1",
      "emails provider list --json",
      "emails status --json",
      "emails inbox sync-status --json",
    ]) {
      expect(isCommandAvailableInMode(command, "local"), command).toBe(true);
      expect(isCommandAvailableInMode(command, "self_hosted"), command).toBe(true);
    }
  });
});
