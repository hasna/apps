import { describe, test, expect } from "bun:test";
import { Command } from "commander";
import { registerInteractiveCommand } from "./interactive.js";

describe("domains interactive command", () => {
  test("registers interactive subcommand", () => {
    const program = new Command();
    registerInteractiveCommand(program);

    const cmd = program.commands.find((command) => command.name() === "interactive");
    expect(cmd).toBeDefined();
    expect(cmd?.description()).toContain("interactive");
  });
});
