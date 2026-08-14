import { describe, expect, test } from "bun:test";
import { Command } from "commander";
import { registerDomainCommand } from "./domain.js";

function registeredDomainCommand(): Command {
  const program = new Command();
  program.exitOverride();
  registerDomainCommand(program);
  return program.commands.find((command) => command.name() === "domain")!;
}

describe("registerDomainCommand", () => {
  test("registers the complete domain command surface with documented options", () => {
    const domain = registeredDomainCommand();

    expect(domain.description()).toBe("Domain portfolio management");
    expect(domain.commands.map((command) => command.name())).toEqual([
      "list",
      "get",
      "add",
      "update",
      "delete",
      "search",
      "expiring",
      "stats",
      "whois",
      "export",
      "check",
      "sync",
      "premium",
      "offer",
      "status",
      "emails",
      "link-email",
      "renew",
      "buy",
      "setup",
    ]);

    const add = domain.commands.find((command) => command.name() === "add")!;
    expect(add.options.find((option) => option.long === "--name")?.mandatory).toBe(true);
    expect(add.options.find((option) => option.long === "--status")?.defaultValue).toBe("active");

    const list = domain.commands.find((command) => command.name() === "list")!;
    expect(list.options.map((option) => option.long)).toEqual(expect.arrayContaining([
      "--status",
      "--registrar",
      "--premium",
      "--limit",
      "--offset",
      "--all",
      "--verbose",
      "--json",
    ]));
  });

  test.each([
    ["--premium-price=-1", "--premium-price must be a non-negative number"],
    ["--standard-price=not-a-number", "--standard-price must be a non-negative number"],
    ["--purchase-price=-0.01", "--purchase-price must be a non-negative number"],
  ])("rejects invalid %s values before creating a domain", async (option, message) => {
    const program = new Command();
    program.exitOverride();
    registerDomainCommand(program);

    await expect(
      program.parseAsync(["node", "domains", "domain", "add", "--name", "example.com", option]),
    ).rejects.toThrow(message);
  });
});
