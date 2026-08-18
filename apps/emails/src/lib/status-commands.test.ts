// A suggested remedy is a claim about the system. Suggesting a command that
// refuses is the same defect class as reporting a count that was never measured:
// the payload asserts something untrue. `emails status` used to propose
// `emails provision status` and every JSON error proposed `emails doctor --json`,
// both of which refused in the API client backend.
//
// `emails doctor` no longer refuses — src/lib/doctor.ts reads its facts through
// the store seam — so the self-hosted examples below use `emails stats`, which
// still has no client-side aggregation over the delivery events table. Keeping a
// runnable command in these fixtures would make them vacuously green.

import { describe, expect, it } from "bun:test";
import {
  isCommandAvailableForBackend,
  keepAvailableCommands,
  SQLITE_REFUSED_COMMANDS,
  NEVER_AVAILABLE_COMMANDS,
  API_REFUSED_COMMANDS,
} from "./status-commands.js";

describe("backend-aware command availability", () => {
  it("rejects the commands that refuse in the API client", () => {
    expect(isCommandAvailableForBackend("emails stats --json", "api")).toBe(false);
    expect(isCommandAvailableForBackend("emails provision status", "api")).toBe(false);
    expect(isCommandAvailableForBackend("emails inbox watch --all-buckets", "api")).toBe(false);
    expect(isCommandAvailableForBackend("emails refresh", "api")).toBe(false);
  });

  it("keeps the self-hosted-only refusals available in local backend", () => {
    for (const command of ["emails stats --json", "emails pull", "emails monitor"]) {
      expect(isCommandAvailableForBackend(command, "sqlite")).toBe(true);
    }
  });

  // REGRESSION (2026-07-27). `emails refresh` is not a registered command in
  // ANY backend — running it exits with "error: unknown command 'refresh'". It used to
  // sit in API_REFUSED_COMMANDS alone, and this very file asserted it was
  // AVAILABLE in local backend, which is why `emails inbox status` kept printing
  // "Pull now: emails refresh" to local operators until one of them followed the
  // hint and hit the dead end. The real verb is `emails pull`.
  it("refuses `emails refresh` in every backend — it is not a command anywhere", () => {
    for (const backend of ["sqlite", "api"] as const) {
      expect(isCommandAvailableForBackend("emails refresh", backend), backend).toBe(false);
    }
    expect(NEVER_AVAILABLE_COMMANDS).toContain("emails refresh");
    // …and the replacement must be genuinely runnable where ingestion is local,
    // or this would be satisfied by suppressing the hint entirely.
    expect(isCommandAvailableForBackend("emails pull", "sqlite")).toBe(true);
    expect(isCommandAvailableForBackend("emails pull", "api")).toBe(false);
  });

  // The registry narrowed when the gratuitous refusals were deleted: a prefix that
  // covers a whole namespace must not keep blocking the subcommands of it that run.
  it("does not refuse the commands that were un-blocked in the API client", () => {
    for (const command of [
      "emails doctor --json",
      "emails export emails --format json",
      "emails export events --format json",
      "emails schedule list --json",
      "emails scheduled list --json",
      "emails schedule cancel abc123",
      "emails daemon status --json",
      "emails daemon restart --json",
      "emails logs tail --component scheduler",
      "emails inbox source list --json",
    ]) {
      expect(isCommandAvailableForBackend(command, "api"), command).toBe(true);
    }
    // …while the genuinely server-side neighbours in the same namespaces stay out.
    for (const command of [
      "emails doctor delivery ops@example.com",
      "emails schedule run",
      "emails scheduler",
      "emails inbox sync-s3 --bucket b",
    ]) {
      expect(isCommandAvailableForBackend(command, "api"), command).toBe(false);
    }
  });

  // `emails provision *` throws notImplementedAnywhere() in BOTH backends
  // (src/cli/commands/provision.ts). Listing it only under self-hosted left
  // `emails status` proposing it in local backend, where it refuses just as hard.
  it("rejects a never-implemented command in every backend, not just one", () => {
    for (const backend of ["sqlite", "api"] as const) {
      expect(isCommandAvailableForBackend("emails provision", backend)).toBe(false);
      expect(isCommandAvailableForBackend("emails provision status", backend)).toBe(false);
      expect(isCommandAvailableForBackend("emails provision domain example.com", backend)).toBe(false);
      expect(keepAvailableCommands(["emails provision status", "emails domain list --json"], backend))
        .toEqual(["emails domain list --json"]);
    }
  });

  it("matches on a word boundary, not a bare string prefix", () => {
    // `emails provision` must not swallow a hypothetical sibling command.
    expect(isCommandAvailableForBackend("emails provisioning-report", "api")).toBe(true);
    expect(isCommandAvailableForBackend("emails provisioning-report", "sqlite")).toBe(true);
    expect(isCommandAvailableForBackend("emails provision", "api")).toBe(false);
  });

  it("filters a suggestion list while preserving order", () => {
    const filtered = keepAvailableCommands(
      ["emails status --json", "emails stats --json", "emails provider list --json"],
      "api",
    );
    expect(filtered).toEqual(["emails status --json", "emails provider list --json"]);
  });

  it("keeps every registry non-empty and namespaced to this CLI", () => {
    expect(NEVER_AVAILABLE_COMMANDS.length).toBeGreaterThan(0);
    expect(API_REFUSED_COMMANDS.length).toBeGreaterThan(0);
    expect(SQLITE_REFUSED_COMMANDS.length).toBeGreaterThan(0);
    for (const command of [
      ...NEVER_AVAILABLE_COMMANDS,
      ...API_REFUSED_COMMANDS,
      ...SQLITE_REFUSED_COMMANDS,
    ]) {
      expect(command.startsWith("emails ")).toBe(true);
    }
    // A backend-independent refusal must live in ONE registry. Duplicating it into a
    // per-backend list is how it gets "fixed" in one backend and left broken in the other.
    for (const command of NEVER_AVAILABLE_COMMANDS) {
      expect(API_REFUSED_COMMANDS).not.toContain(command);
      expect(SQLITE_REFUSED_COMMANDS).not.toContain(command);
    }
  });
});

// Flag-conditional refusals: the base command runs, one flag form throws, and the
// throw is an inline `handleError(new Error(...))` with no `serverOnly("emails ...")`
// literal. src/lib/status-commands-coverage.test.ts derives its expectations from
// those literals, so it is STRUCTURALLY blind to these — they are pinned here by name
// instead, in both directions, so neither half can drift.
describe("flag-conditional refusals the coverage scan cannot see", () => {
  it("refuses the flag form while keeping the base command available", () => {
    for (const [base, refusedFlagForm] of [
      ["emails inbox clear", "emails inbox clear --provider p1"],
    ] as const) {
      expect(isCommandAvailableForBackend(base, "api"), base).toBe(true);
      expect(isCommandAvailableForBackend(refusedFlagForm, "api"), refusedFlagForm).toBe(false);
    }
    // Extra flags after the refused one must not smuggle it back in.
    expect(isCommandAvailableForBackend("emails inbox clear --provider p1 --limit 10", "api")).toBe(false);
    // Local backend serves both from SQL, so both stay available there.
    expect(isCommandAvailableForBackend("emails inbox clear --provider p1", "sqlite")).toBe(true);
  });

  // The mirror-image half: `inbox unread-count --by-address` used to refuse in
  // self-hosted and now RUNS there (server-side rollup over the /v1 endpoint),
  // so it must stay OUT of the flag-conditional refusal list — listing a
  // command that runs suppresses a real remedy from every suggestion path.
  it("serves unread-count --by-address in both backends", () => {
    expect(isCommandAvailableForBackend("emails inbox unread-count --by-address", "api")).toBe(true);
    expect(isCommandAvailableForBackend("emails inbox unread-count --by-address --limit 10", "api")).toBe(true);
    expect(isCommandAvailableForBackend("emails inbox unread-count --by-address", "sqlite")).toBe(true);
  });

  // The mirror-image defect: listing a command that RUNS suppresses a real remedy.
  // `emails send --to-group` used to refuse and now works (client-side group fan-out),
  // so it must be absent from every refusal list.
  it("does not refuse a flag form that was since implemented", () => {
    for (const backend of ["sqlite", "api"] as const) {
      expect(isCommandAvailableForBackend("emails send --to-group ops --subject s", backend), backend).toBe(true);
    }
    expect(API_REFUSED_COMMANDS).not.toContain("emails send --to-group");
  });
});
