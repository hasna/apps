import { describe, test, expect } from "bun:test";
import { Command } from "commander";
import { registerSpaceCommands } from "./spaces";

describe("registerSpaceCommands", () => {
  test("registers space command", () => {
    const program = new Command();
    registerSpaceCommands(program);

    const space = program.commands.find((c) => c.name() === "space");
    expect(space).toBeDefined();
    expect(space?.description()).toContain("Manage");
  });

  test("registers space subcommands", () => {
    const program = new Command();
    registerSpaceCommands(program);

    const space = program.commands.find((c) => c.name() === "space");
    const subcommands = space?.commands.map((c) => c.name()) ?? [];

    expect(subcommands).toContain("create");
    expect(subcommands).toContain("list");
    expect(subcommands).toContain("update");
    expect(subcommands).toContain("archive");
    expect(subcommands).toContain("unarchive");
  });

  test("registers space send subcommand", () => {
    const program = new Command();
    registerSpaceCommands(program);

    const space = program.commands.find((c) => c.name() === "space");
    const send = space?.commands.find((c) => c.name() === "send");
    expect(send).toBeDefined();
    expect(send?.options.some((o) => o.long === "--priority")).toBe(true);
  });

  test("registers space read subcommand", () => {
    const program = new Command();
    registerSpaceCommands(program);

    const space = program.commands.find((c) => c.name() === "space");
    const read = space?.commands.find((c) => c.name() === "read");
    expect(read).toBeDefined();
  });

  test("registers space join and leave commands", () => {
    const program = new Command();
    registerSpaceCommands(program);

    const space = program.commands.find((c) => c.name() === "space");
    expect(space?.commands.find((c) => c.name() === "join")).toBeDefined();
    expect(space?.commands.find((c) => c.name() === "leave")).toBeDefined();
  });

  test("registers space subscribe and unsubscribe commands", () => {
    const program = new Command();
    registerSpaceCommands(program);

    const space = program.commands.find((c) => c.name() === "space");
    expect(space?.commands.find((c) => c.name() === "subscribe")).toBeDefined();
    expect(space?.commands.find((c) => c.name() === "unsubscribe")).toBeDefined();
  });

  test("registers space subscriptions command", () => {
    const program = new Command();
    registerSpaceCommands(program);

    const space = program.commands.find((c) => c.name() === "space");
    const subs = space?.commands.find((c) => c.name() === "subscriptions");
    expect(subs).toBeDefined();
  });

  test("registers space members command", () => {
    const program = new Command();
    registerSpaceCommands(program);

    const space = program.commands.find((c) => c.name() === "space");
    const members = space?.commands.find((c) => c.name() === "members");
    expect(members).toBeDefined();
  });
});
