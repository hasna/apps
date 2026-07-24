import { describe, expect, test } from "bun:test";
import { Command } from "commander";
import { registerAdminCommands } from "./admin.js";

describe("registerAdminCommands", () => {
  test("registers audited redaction command with live-mutation gates", () => {
    const program = new Command();
    registerAdminCommands(program);

    const admin = program.commands.find((command) => command.name() === "admin");
    expect(admin).toBeDefined();
    const redact = admin?.commands.find((command) => command.name() === "redact-messages");
    expect(redact).toBeDefined();
    expect(redact?.options.some((option) => option.long === "--apply")).toBe(true);
    expect(redact?.options.some((option) => option.long === "--backup-confirmed")).toBe(true);
    expect(redact?.options.some((option) => option.long === "--dry-run-confirmed")).toBe(true);
    expect(redact?.options.some((option) => option.long === "--authority")).toBe(true);
  });
});
