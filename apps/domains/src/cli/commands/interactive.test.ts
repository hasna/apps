import { describe, test, expect, spyOn, afterEach } from "bun:test";
import { Command } from "commander";
import { registerInteractiveCommand, assertInteractiveTty } from "./interactive.js";
import { stripAnsi } from "../tui/format.js";

describe("domains interactive command", () => {
  const stdinDescriptor = Object.getOwnPropertyDescriptor(process.stdin, "isTTY");
  const stdoutDescriptor = Object.getOwnPropertyDescriptor(process.stdout, "isTTY");

  afterEach(() => {
    if (stdinDescriptor) Object.defineProperty(process.stdin, "isTTY", stdinDescriptor);
    if (stdoutDescriptor) Object.defineProperty(process.stdout, "isTTY", stdoutDescriptor);
  });

  test("registers interactive subcommand", () => {
    const program = new Command();
    registerInteractiveCommand(program);

    const cmd = program.commands.find((command) => command.name() === "interactive");
    expect(cmd).toBeDefined();
    expect(cmd?.description()).toContain("interactive");
  });

  test("assertInteractiveTty exits when stdin is not a TTY", () => {
    Object.defineProperty(process.stdin, "isTTY", { value: false, configurable: true });
    Object.defineProperty(process.stdout, "isTTY", { value: true, configurable: true });

    const exitSpy = spyOn(process, "exit").mockImplementation((() => {
      throw new Error("process.exit");
    }) as typeof process.exit);
    const errorSpy = spyOn(console, "error").mockImplementation(() => {});

    expect(() => assertInteractiveTty()).toThrow("process.exit");
    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(stripAnsi(errorSpy.mock.calls.flat().join(" "))).toContain("TTY");

    exitSpy.mockRestore();
    errorSpy.mockRestore();
  });
});
