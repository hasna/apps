import { describe, expect, test } from "bun:test";
import { Command } from "commander";
import { createCliManual, generateCompletionScript } from "../lib/cli-help.js";
import {
  applyTodosCliHelpVisibility,
  getTodosCliCommandCapabilityMatrix,
  isTodosCliCommandVisibleForRoute,
} from "./stage-a.js";

// Regression coverage for the "help-runtime-command-gap" bug: in a remote
// authority route the CLI fails closed on local-only commands
// (REMOTE_COMMAND_UNSUPPORTED), so the advertised surface (`todos --help` and
// `todos manual`) must not list commands it cannot execute.

const NAMED_REPRO_COMMANDS = [
  "ready", "blocked", "overdue", "sla", "priorities", "today", "yesterday",
  "week", "burndown", "stale", "summary", "report", "sprint", "log",
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
  test("remote manual advertises only remote-executable commands", () => {
    const matrix = getTodosCliCommandCapabilityMatrix();
    const manual = createCliManual(buildProgramFromMatrix(), {
      isCommandVisible: (command) => isTodosCliCommandVisibleForRoute(command, "remote-http"),
      localOnly: false,
    });
    const advertised = manual.commands.map((entry) => entry.path[0] ?? "");

    // No advertised command may be one Stage A rejects in a remote route.
    const leaked = advertised.filter((name) => matrix.get(name) === "local-only");
    expect(leaked).toEqual([]);

    // Every command the repro flagged is gone from the advertised catalog.
    for (const name of NAMED_REPRO_COMMANDS) {
      expect(advertised).not.toContain(name);
    }

    // Remote-executable commands remain advertised.
    for (const name of ["status", "list", "add", "show", "start", "done"]) {
      expect(advertised).toContain(name);
    }
    expect(manual.local_only).toBe(false);
  });

  test("remote manual examples drop commands the CLI would reject", () => {
    const manual = createCliManual(buildProgramFromMatrix(), {
      isCommandVisible: (command) => isTodosCliCommandVisibleForRoute(command, "remote-http"),
      localOnly: false,
    });
    expect(manual.examples.some((example) => example.startsWith("todos ready"))).toBe(false);
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
    expect(remoteHelp).not.toMatch(/\bburndown\b/);
    expect(remoteHelp).not.toMatch(/\bverify-providers\b/);
    expect(remoteHelp).toMatch(/\bstatus\b/);

    const localProgram = buildProgramFromMatrix();
    applyTodosCliHelpVisibility(localProgram, "local");
    expect(localProgram.helpInformation()).toMatch(/\bburndown\b/);
  });

  test("remote shell completions only suggest remote-executable commands", () => {
    const program = buildProgramFromMatrix();
    const remote = generateCompletionScript(program, "bash", (command) =>
      isTodosCliCommandVisibleForRoute(command, "remote-http"),
    );
    expect(remote).not.toMatch(/\bburndown\b/);
    expect(remote).not.toMatch(/\bverify-providers\b/);
    expect(remote).toMatch(/\bstatus\b/);
    // Default (local) completions still suggest the full catalog.
    const local = generateCompletionScript(program, "bash");
    expect(local).toMatch(/\bburndown\b/);
  });

  test("visibility predicate keeps diagnostic and remote owners while dropping local-only", () => {
    expect(isTodosCliCommandVisibleForRoute("status", "remote-http")).toBe(true); // remote-http
    expect(isTodosCliCommandVisibleForRoute("manual", "remote-http")).toBe(true); // diagnostic
    expect(isTodosCliCommandVisibleForRoute("burndown", "remote-http")).toBe(false); // local-only
    expect(isTodosCliCommandVisibleForRoute("burndown", "local")).toBe(true); // local route shows all
    // Unknown/optional families self-gate at runtime and stay visible.
    expect(isTodosCliCommandVisibleForRoute("not-a-real-command", "remote-http")).toBe(true);
  });
});
