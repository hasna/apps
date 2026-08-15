import { describe, test, expect } from "bun:test";
import { Command } from "commander";
import { registerBrainsCommand } from "./brains";

describe("registerBrainsCommand", () => {
  test("registers brains command on program", () => {
    const program = new Command();
    registerBrainsCommand(program);

    const brains = program.commands.find((c) => c.name() === "brains");
    expect(brains).toBeDefined();
    expect(brains?.description()).toContain("Training");
  });

  test("registers gather subcommand", () => {
    const program = new Command();
    registerBrainsCommand(program);

    const brains = program.commands.find((c) => c.name() === "brains");
    const gather = brains?.commands.find((c) => c.name() === "gather");
    expect(gather).toBeDefined();
    expect(gather?.options.some((o) => o.long === "--limit")).toBe(true);
    expect(gather?.options.some((o) => o.long === "--output")).toBe(true);
  });

  test("registers train subcommand with provider option", () => {
    const program = new Command();
    registerBrainsCommand(program);

    const brains = program.commands.find((c) => c.name() === "brains");
    const train = brains?.commands.find((c) => c.name() === "train");
    expect(train).toBeDefined();
    expect(train?.options.some((o) => o.long === "--provider")).toBe(true);
    expect(train?.options.some((o) => o.long === "--base-model")).toBe(true);
  });

  test("registers model subcommand", () => {
    const program = new Command();
    registerBrainsCommand(program);

    const brains = program.commands.find((c) => c.name() === "brains");
    const model = brains?.commands.find((c) => c.name() === "model");
    expect(model).toBeDefined();
    expect(model?.description()).toContain("Manage");
  });

  test("registers model set subcommand", () => {
    const program = new Command();
    registerBrainsCommand(program);

    const brains = program.commands.find((c) => c.name() === "brains");
    const model = brains?.commands.find((c) => c.name() === "model");
    const set = model?.commands.find((c) => c.name() === "set");
    expect(set).toBeDefined();
  });

  test("registers model clear subcommand", () => {
    const program = new Command();
    registerBrainsCommand(program);

    const brains = program.commands.find((c) => c.name() === "brains");
    const model = brains?.commands.find((c) => c.name() === "model");
    const clear = model?.commands.find((c) => c.name() === "clear");
    expect(clear).toBeDefined();
  });
});
