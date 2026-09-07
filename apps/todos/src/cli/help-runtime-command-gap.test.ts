import { describe, expect, test } from "bun:test";
import { Command } from "commander";
import { createCliManual, generateCompletionScript } from "../lib/cli-help.js";
import { getTodosCliOnBoxStoreCommands, initializeTodosCliAuthority } from "./stage-a.js";

// The command catalog is transport-neutral: every command is advertised in
// `todos --help`, `todos manual`, and completions regardless of which store a
// run serves. The old "remote help describes the authority-served surface"
// contract hid an entire class of workstation-store verbs from hosted help;
// that gap is closed — help always advertises everything.

const REPRO_ON_BOX_COMMANDS = [
  "ready", "blocked", "overdue", "sla", "priorities", "today", "yesterday",
  "week", "burndown", "stale", "summary", "report", "sprint", "log",
  "org", "machines", "context", "search", "export", "board", "runs",
  "knowledge", "risks", "roadmaps", "reviews", "findings", "views", "calendar",
  "events", "usage", "backup", "scale", "audit-ledger", "policies",
  "extensions", "api-keys", "verify-providers",
];

function buildProgramFromOnBoxSet(): Command {
  const program = new Command();
  for (const name of ["status", "list", "add", "show", "start", "done", "fail", "manual", ...getTodosCliOnBoxStoreCommands()]) {
    // `help` is reserved and auto-managed by commander.
    if (name === "help") continue;
    program.command(name);
  }
  return program;
}

describe("help/runtime command parity — the full catalog in every transport", () => {
  test("the manual advertises every command, on-box verbs included", () => {
    const manual = createCliManual(buildProgramFromOnBoxSet());
    const advertised = manual.commands.map((entry) => entry.path[0] ?? "");

    for (const name of REPRO_ON_BOX_COMMANDS) {
      expect(advertised).toContain(name);
    }
    for (const name of ["status", "list", "add", "show", "start", "done", "fail"]) {
      expect(advertised).toContain(name);
    }
    // The transport-conditional `local_only` field is gone from the contract.
    expect("local_only" in manual).toBe(false);
  });

  test("manual examples keep the workstation-store verbs", () => {
    const manual = createCliManual(buildProgramFromOnBoxSet());
    expect(manual.examples.some((example) => example.startsWith("todos ready"))).toBe(true);
    expect(manual.examples.some((example) => example.startsWith("todos usage report"))).toBe(true);
    expect(manual.examples.some((example) => example.startsWith("todos add"))).toBe(true);
  });

  test("--help contains the full catalog in every route", () => {
    for (const route of ["local", "remote-http", "remote-diagnostic"] as const) {
      const program = buildProgramFromOnBoxSet();
      const help = program.helpInformation();
      expect(help).toMatch(/\bburndown\b/);
      expect(help).toMatch(/\bverify-providers\b/);
      expect(help).toMatch(/\bstatus\b/);
    }
  });

  test("shell completions suggest the full catalog in every transport", () => {
    const program = buildProgramFromOnBoxSet();
    const bash = generateCompletionScript(program, "bash");
    expect(bash).toMatch(/\bburndown\b/);
    expect(bash).toMatch(/\bverify-providers\b/);
    expect(bash).toMatch(/\bstatus\b/);
    const zsh = generateCompletionScript(program, "zsh");
    expect(zsh).toMatch(/\bburndown\b/);
  });

  test("every on-box verb is registered and routed to the on-box store under hosted configuration", () => {
    const hostedEnv = {
      HASNA_TODOS_API_URL: "https://authority.invalid",
      HASNA_TODOS_API_KEY: "fixture-remote-key",
    };
    for (const name of REPRO_ON_BOX_COMMANDS) {
      expect(getTodosCliOnBoxStoreCommands().has(name)).toBe(true);
      expect(initializeTodosCliAuthority([name], hostedEnv)).toEqual({
        route: "local",
        v1_base_url: null,
        local_store: "configured-authority",
      });
    }
  });
});