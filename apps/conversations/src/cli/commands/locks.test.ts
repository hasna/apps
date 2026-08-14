import { describe, test, expect } from "bun:test";
import { Command } from "commander";
import { registerLockCommands } from "./locks";

function getLocks(program: Command) {
  return program.commands.find((c) => c.name() === "locks");
}

describe("registerLockCommands", () => {
  test("registers locks command group", () => {
    const program = new Command();
    registerLockCommands(program);

    const locks = getLocks(program);
    expect(locks).toBeDefined();
    expect(locks?.description()).toContain("lock");
  });

  test("registers acquire/release/check/list/clean subcommands", () => {
    const program = new Command();
    registerLockCommands(program);

    const subcommands = getLocks(program)?.commands.map((c) => c.name()) ?? [];
    expect(subcommands).toContain("acquire");
    expect(subcommands).toContain("release");
    expect(subcommands).toContain("check");
    expect(subcommands).toContain("list");
    expect(subcommands).toContain("clean");
  });

  test("acquire has --ttl, --from, --type, --exclusive, --no-dm and --json options", () => {
    const program = new Command();
    registerLockCommands(program);

    const acquire = getLocks(program)?.commands.find((c) => c.name() === "acquire");
    expect(acquire).toBeDefined();
    for (const flag of ["--ttl", "--from", "--type", "--exclusive", "--no-dm", "--json"]) {
      expect(acquire?.options.some((o) => o.long === flag)).toBe(true);
    }
    const args = acquire?.registeredArguments ?? [];
    expect(args.length).toBe(1);
    expect(args[0]?.required).toBe(true);
  });

  test("release and check take a key argument and --type option", () => {
    const program = new Command();
    registerLockCommands(program);

    for (const name of ["release", "check"]) {
      const cmd = getLocks(program)?.commands.find((c) => c.name() === name);
      expect(cmd).toBeDefined();
      expect(cmd?.registeredArguments.length).toBe(1);
      expect(cmd?.options.some((o) => o.long === "--type")).toBe(true);
    }
  });

  test("list supports filtering and pagination", () => {
    const program = new Command();
    registerLockCommands(program);

    const list = getLocks(program)?.commands.find((c) => c.name() === "list");
    for (const flag of ["--type", "--agent", "--limit", "--cursor", "--json"]) {
      expect(list?.options.some((o) => o.long === flag)).toBe(true);
    }
  });
});
