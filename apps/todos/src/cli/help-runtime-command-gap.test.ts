import { describe, expect, test } from "bun:test";
import { Command } from "commander";
import { createCliManual, generateCompletionScript } from "../lib/cli-help.js";
import {
  applyTodosCliHelpVisibility,
  getUnavailableTodosCliRemoteMetadataCommand,
  getTodosCliCommandCapabilityMatrix,
  isTodosCliCommandVisibleForRoute,
} from "./stage-a.js";

// Remote metadata intentionally describes the authority-served surface.
// Explicitly admitted workstation redaction invocations select a separate
// local route. Local-only commands stay out of `todos --help`, `todos manual`,
// and completions rendered for the remote authority.

// Ported to the /v1 route by the local-only capability removal (2026-08-18):
// their command modules carry a complete cloud branch, so they are now
// authority-served and advertised on the remote route.
const PORTED_TO_REMOTE_COMMANDS = [
  "ready", "blocked", "overdue", "sla", "priorities", "today", "yesterday",
  "week", "burndown", "stale", "summary", "report", "sprint", "log",
];

// Still refused on the /v1 route: no server-side surface today (or machine-local
// by nature). They stay out of the remote catalog until their own port lands.
const STILL_LOCAL_ONLY_COMMANDS = [
  "org", "machines", "context", "search", "export", "board", "runs",
  "knowledge", "risks", "roadmaps", "reviews", "findings", "views", "calendar",
  "events", "usage", "backup", "scale", "audit-ledger", "policies",
  "extensions", "api-keys", "verify-providers",
];

function buildProgramFromMatrix(): Command {
  const program = new Command();
  for (const name of getTodosCliCommandCapabilityMatrix().keys()) {
    // `help` is reserved and auto-managed by commander.
    if (name === "help") continue;
    program.command(name);
  }
  return program;
}

describe("remote help/runtime command gap", () => {
  test("remote manual advertises only authority-served commands", () => {
    const matrix = getTodosCliCommandCapabilityMatrix();
    const manual = createCliManual(buildProgramFromMatrix(), {
      isCommandVisible: (command) => isTodosCliCommandVisibleForRoute(command, "remote-http"),
      localOnly: false,
    });
    const advertised = manual.commands.map((entry) => entry.path[0] ?? "");

    // No advertised command may be one Stage A routes to local state.
    const leaked = advertised.filter((name) => matrix.get(name) === "local-only");
    expect(leaked).toEqual([]);

    // Every command the repro flagged that is STILL local-only is gone from the
    // advertised catalog; the ported-to-remote commands are now advertised.
    for (const name of STILL_LOCAL_ONLY_COMMANDS) {
      expect(advertised).not.toContain(name);
    }
    for (const name of PORTED_TO_REMOTE_COMMANDS) {
      expect(advertised).toContain(name);
    }

    // Remote-executable commands remain advertised.
    for (const name of ["status", "list", "add", "show", "start", "done", "fail"]) {
      expect(advertised).toContain(name);
    }
    expect(advertised).not.toContain("block");
    expect(manual.local_only).toBe(false);
  });

  test("remote manual examples drop commands that select local state", () => {
    const manual = createCliManual(buildProgramFromMatrix(), {
      isCommandVisible: (command) => isTodosCliCommandVisibleForRoute(command, "remote-http"),
      localOnly: false,
    });
    // `todos ready` was ported to the /v1 route (2026-08-18), so its example is
    // now a correct remote example; the still-local-only `usage report` stays
    // out of the remote manual.
    expect(manual.examples.some((example) => example.startsWith("todos ready"))).toBe(true);
    expect(manual.examples.some((example) => example.startsWith("todos usage report"))).toBe(false);
    // A remote-executable example survives so the section is not empty.
    expect(manual.examples.some((example) => example.startsWith("todos add"))).toBe(true);
  });

  test("local manual still advertises the full command catalog", () => {
    const manual = createCliManual(buildProgramFromMatrix());
    const advertised = new Set(manual.commands.map((entry) => entry.path[0] ?? ""));
    for (const name of ["ready", "usage", "burndown", "status", "list"]) {
      expect(advertised.has(name)).toBe(true);
    }
    expect(manual.local_only).toBe(true);
    // The default (local) example set is preserved verbatim.
    expect(manual.examples.some((example) => example.startsWith("todos ready"))).toBe(true);
  });

  test("applyTodosCliHelpVisibility hides local-only commands from --help in a remote route", () => {
    const remoteProgram = buildProgramFromMatrix();
    applyTodosCliHelpVisibility(remoteProgram, "remote-http");
    const remoteHelp = remoteProgram.helpInformation();
    // Ported to the /v1 route (2026-08-18): authority-served, so visible.
    expect(remoteHelp).toMatch(/\bburndown\b/);
    expect(remoteHelp).not.toMatch(/\bverify-providers\b/);
    expect(remoteHelp).toMatch(/\bstatus\b/);

    const localProgram = buildProgramFromMatrix();
    applyTodosCliHelpVisibility(localProgram, "local");
    expect(localProgram.helpInformation()).toMatch(/\bburndown\b/);
  });

  test("named remote metadata follows version-gated capabilities", () => {
    expect(getUnavailableTodosCliRemoteMetadataCommand(
      "remote-http",
      new Set(),
      ["stale-lock-handoff", "--help"],
    )).toBe("stale-lock-handoff");
    expect(getUnavailableTodosCliRemoteMetadataCommand(
      "remote-http",
      new Set(["stale-lock-handoff"]),
      ["help", "stale-lock-handoff"],
    )).toBeNull();
  });

  test("remote shell completions only suggest authority-served commands", () => {
    const program = buildProgramFromMatrix();
    const remote = generateCompletionScript(program, "bash", (command) =>
      isTodosCliCommandVisibleForRoute(command, "remote-http"),
    );
    // Ported to the /v1 route (2026-08-18): authority-served, so suggested.
    expect(remote).toMatch(/\bburndown\b/);
    expect(remote).not.toMatch(/\bverify-providers\b/);
    expect(remote).toMatch(/\bstatus\b/);
    // Default (local) completions still suggest the full catalog.
    const local = generateCompletionScript(program, "bash");
    expect(local).toMatch(/\bburndown\b/);
  });

  test("visibility predicate keeps diagnostic and remote owners while omitting local-only", () => {
    expect(isTodosCliCommandVisibleForRoute("status", "remote-http")).toBe(true); // remote-http
    expect(isTodosCliCommandVisibleForRoute("manual", "remote-http")).toBe(true); // diagnostic
    expect(isTodosCliCommandVisibleForRoute("fail", "remote-http")).toBe(true); // remote-http
    // Ported to the /v1 route (2026-08-18): remote-http owner, visible.
    expect(isTodosCliCommandVisibleForRoute("burndown", "remote-http")).toBe(true);
    expect(isTodosCliCommandVisibleForRoute("burndown", "local")).toBe(true); // local route shows all
    // Still local-only (no server-side surface): hidden on the remote route.
    expect(isTodosCliCommandVisibleForRoute("verify-providers", "remote-http")).toBe(false);
    expect(isTodosCliCommandVisibleForRoute("stale-lock-handoff", "remote-http")).toBe(false);
    expect(isTodosCliCommandVisibleForRoute(
      "stale-lock-handoff",
      "remote-http",
      new Set(["stale-lock-handoff"]),
    )).toBe(true);
    // Unknown/optional families self-gate at runtime and stay visible.
    expect(isTodosCliCommandVisibleForRoute("not-a-real-command", "remote-http")).toBe(true);
  });
});
