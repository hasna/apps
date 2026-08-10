import { describe, expect, test } from "bun:test";
import { Command } from "commander";
import { registerProjectRegistrationCommands } from "./project-registration.js";

describe("registerProjectRegistrationCommands", () => {
  test("registers create, terminal receipt, inverse, producer page, and exact read commands", () => {
    const program = new Command();
    registerProjectRegistrationCommands(program);

    const registration = program.commands.find((command) => command.name() === "project-registration");
    expect(registration).toBeDefined();
    const names = registration?.commands.map((command) => command.name()) ?? [];
    expect(names).toEqual(expect.arrayContaining([
      "capability",
      "create",
      "lookup-receipt",
      "compensate",
      "verify-inverse",
      "channels",
      "messages",
      "read-channel",
    ]));

    const channels = registration?.commands.find((command) => command.name() === "channels");
    expect(channels?.options.some((option) => option.long === "--project")).toBe(true);
    expect(channels?.options.some((option) => option.long === "--cursor")).toBe(true);
    expect(channels?.options.some((option) => option.long === "--limit")).toBe(true);

    const messages = registration?.commands.find((command) => command.name() === "messages");
    expect(messages?.options.some((option) => option.long === "--project")).toBe(true);
    expect(messages?.options.some((option) => option.long === "--cursor")).toBe(true);
    expect(messages?.options.some((option) => option.long === "--limit")).toBe(true);
  });
});
