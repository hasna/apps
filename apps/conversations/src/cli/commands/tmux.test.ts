import { describe, test, expect } from "bun:test";
import { Command } from "commander";
import { registerTmuxCommands } from "./tmux";

describe("registerTmuxCommands", () => {
  test("registers tmux command on program", () => {
    const program = new Command();
    registerTmuxCommands(program);

    const tmuxCmd = program.commands.find((c) => c.name() === "tmux");
    expect(tmuxCmd).toBeDefined();
    expect(tmuxCmd?.description()).toContain("tmux");
  });

  test("registers tmux send subcommand", () => {
    const program = new Command();
    registerTmuxCommands(program);

    const tmux = program.commands.find((c) => c.name() === "tmux");
    const send = tmux?.commands.find((c) => c.name() === "send");
    expect(send).toBeDefined();
    expect(send?.description()).toContain("Send");
  });

  test("registers tmux broadcast subcommand", () => {
    const program = new Command();
    registerTmuxCommands(program);

    const tmux = program.commands.find((c) => c.name() === "tmux");
    const broadcast = tmux?.commands.find((c) => c.name() === "broadcast");
    expect(broadcast).toBeDefined();
    expect(broadcast?.description()).toContain("tmux");
  });
});
