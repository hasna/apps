import { describe, test, expect } from "bun:test";
import { Command } from "commander";
import { registerChannelCommands } from "./channels";

describe("registerChannelCommands", () => {
  test("registers channel command", () => {
    const program = new Command();
    registerChannelCommands(program);

    const channel = program.commands.find((c) => c.name() === "channel");
    expect(channel).toBeDefined();
    expect(channel?.description()).toContain("Manage");
  });

  test("registers channel subcommands", () => {
    const program = new Command();
    registerChannelCommands(program);

    const channel = program.commands.find((c) => c.name() === "channel");
    const subcommands = channel?.commands.map((c) => c.name()) ?? [];

    expect(subcommands).toContain("create");
    expect(subcommands).toContain("list");
    expect(subcommands).toContain("update");
    expect(subcommands).toContain("archive");
    expect(subcommands).toContain("unarchive");
  });

  test("registers channel send subcommand", () => {
    const program = new Command();
    registerChannelCommands(program);

    const channel = program.commands.find((c) => c.name() === "channel");
    const send = channel?.commands.find((c) => c.name() === "send");
    expect(send).toBeDefined();
    expect(send?.options.some((o) => o.long === "--priority")).toBe(true);
  });

  test("registers channel read subcommand", () => {
    const program = new Command();
    registerChannelCommands(program);

    const channel = program.commands.find((c) => c.name() === "channel");
    const read = channel?.commands.find((c) => c.name() === "read");
    expect(read).toBeDefined();
  });

  test("registers channel join and leave commands", () => {
    const program = new Command();
    registerChannelCommands(program);

    const channel = program.commands.find((c) => c.name() === "channel");
    expect(channel?.commands.find((c) => c.name() === "join")).toBeDefined();
    expect(channel?.commands.find((c) => c.name() === "leave")).toBeDefined();
  });

  test("registers channel subscribe and unsubscribe commands", () => {
    const program = new Command();
    registerChannelCommands(program);

    const channel = program.commands.find((c) => c.name() === "channel");
    expect(channel?.commands.find((c) => c.name() === "subscribe")).toBeDefined();
    expect(channel?.commands.find((c) => c.name() === "unsubscribe")).toBeDefined();
  });

  test("registers channel subscriptions command", () => {
    const program = new Command();
    registerChannelCommands(program);

    const channel = program.commands.find((c) => c.name() === "channel");
    const subs = channel?.commands.find((c) => c.name() === "subscriptions");
    expect(subs).toBeDefined();
  });

  test("registers channel members command", () => {
    const program = new Command();
    registerChannelCommands(program);

    const channel = program.commands.find((c) => c.name() === "channel");
    const members = channel?.commands.find((c) => c.name() === "members");
    expect(members).toBeDefined();
  });
});
