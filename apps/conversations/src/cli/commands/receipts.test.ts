import { describe, test, expect } from "bun:test";
import { Command } from "commander";
import { registerReceiptCommands } from "./receipts";

describe("registerReceiptCommands", () => {
  test("registers receipts command", () => {
    const program = new Command();
    registerReceiptCommands(program);

    const receipts = program.commands.find((c) => c.name() === "receipts");
    expect(receipts).toBeDefined();
    expect(receipts?.description()).toContain("read receipts");
  });

  test("receipts requires a message-id argument", () => {
    const program = new Command();
    registerReceiptCommands(program);

    const receipts = program.commands.find((c) => c.name() === "receipts");
    const args = receipts?.registeredArguments ?? [];
    expect(args.length).toBe(1);
    expect(args[0]?.required).toBe(true);
  });

  test("receipts has --channel and --json options", () => {
    const program = new Command();
    registerReceiptCommands(program);

    const receipts = program.commands.find((c) => c.name() === "receipts");
    expect(receipts?.options.some((o) => o.long === "--channel")).toBe(true);
    expect(receipts?.options.some((o) => o.long === "--json")).toBe(true);
  });
});
