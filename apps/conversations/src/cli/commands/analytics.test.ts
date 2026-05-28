import { describe, test, expect } from "bun:test";
import { Command } from "commander";
import { registerAnalyticsCommands } from "./analytics";

describe("registerAnalyticsCommands", () => {
  test("registers graph command", () => {
    const program = new Command();
    registerAnalyticsCommands(program);

    const graph = program.commands.find((c) => c.name() === "graph");
    expect(graph).toBeDefined();
  });

  test("registers graph build and stats subcommands", () => {
    const program = new Command();
    registerAnalyticsCommands(program);

    const graph = program.commands.find((c) => c.name() === "graph");
    expect(graph?.commands.find((c) => c.name() === "build")).toBeDefined();
    expect(graph?.commands.find((c) => c.name() === "stats")).toBeDefined();
    expect(graph?.commands.find((c) => c.name() === "agent")).toBeDefined();
  });

  test("registers summary command", () => {
    const program = new Command();
    registerAnalyticsCommands(program);

    const summary = program.commands.find((c) => c.name() === "summary");
    expect(summary).toBeDefined();
  });

  test("registers topics command", () => {
    const program = new Command();
    registerAnalyticsCommands(program);

    const topics = program.commands.find((c) => c.name() === "topics");
    expect(topics).toBeDefined();
    expect(topics?.options.some((o) => o.long === "--space")).toBe(true);
  });

  test("registers hot command", () => {
    const program = new Command();
    registerAnalyticsCommands(program);

    const hot = program.commands.find((c) => c.name() === "hot");
    expect(hot).toBeDefined();
    expect(hot?.options.some((o) => o.long === "--limit")).toBe(true);
  });

  test("registers context command", () => {
    const program = new Command();
    registerAnalyticsCommands(program);

    const context = program.commands.find((c) => c.name() === "context");
    expect(context).toBeDefined();
  });

  test("registers sessions command", () => {
    const program = new Command();
    registerAnalyticsCommands(program);

    const sessions = program.commands.find((c) => c.name() === "sessions");
    expect(sessions).toBeDefined();
  });

  test("registers status command", () => {
    const program = new Command();
    registerAnalyticsCommands(program);

    const status = program.commands.find((c) => c.name() === "status");
    expect(status).toBeDefined();
  });

  test("registers doctor command", () => {
    const program = new Command();
    registerAnalyticsCommands(program);

    const doctor = program.commands.find((c) => c.name() === "doctor");
    expect(doctor).toBeDefined();
  });

  test("registers react, unreact, reactions commands", () => {
    const program = new Command();
    registerAnalyticsCommands(program);

    expect(program.commands.find((c) => c.name() === "react")).toBeDefined();
    expect(program.commands.find((c) => c.name() === "unreact")).toBeDefined();
    expect(program.commands.find((c) => c.name() === "reactions")).toBeDefined();
  });
});
