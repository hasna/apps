// Domain infrastructure creation remains explicitly unsupported; address provisioning uses its API suite.
import { describe, expect, it } from "bun:test";
import { Command } from "commander";
import { registerProvisionCommands } from "./provision.js";

async function runProvisionCommandExpectingExit(args: string[]) {
  const originalExit = process.exit;
  const originalError = console.error;
  const errors: string[] = [];
  console.error = ((message?: unknown) => { errors.push(String(message ?? "")); }) as typeof console.error;
  process.exit = ((code?: number) => {
    throw new Error(`process.exit:${code ?? 0}`);
  }) as typeof process.exit;
  const program = new Command();
  program.exitOverride();
  registerProvisionCommands(program, () => {});
  try {
    await program.parseAsync(["node", "emails", ...args]);
    throw new Error("Expected command to exit");
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e), stderr: errors.join("\n") };
  } finally {
    process.exit = originalExit;
    console.error = originalError;
  }
}

describe("unimplemented provisioning commands", () => {
  // Required options are supplied so the command action runs and hits the
  // server-only guard rather than a commander missing-option error.
  const SERVER_ONLY = [
    { name: "provision up", args: ["provision", "up", "example.com", "--provider", "ses-provider"] },
    { name: "provision roundtrip", args: ["provision", "roundtrip", "--domain", "example.com", "--provider", "ses-provider"] },
    { name: "provision daemon", args: ["provision", "daemon", "--provider", "ses-provider"] },
    { name: "provision retry", args: ["provision", "retry", "example.com"] },
  ] as const;

  for (const { name, args } of SERVER_ONLY) {
    it(`fails emails ${name} with a truthful, actionable message`, async () => {
      const result = await runProvisionCommandExpectingExit(args as unknown as string[]);
      expect(result.error).toBe("process.exit:1");
      expect(result.stderr).toContain(`emails ${name}`);
      expect(result.stderr).toContain("is not implemented in this build");
      // Names the two commands that DO work instead of a phantom server.
      expect(result.stderr).toContain("emails domain adopt");
      expect(result.stderr).toContain("emails aws setup-inbound");
      // The old claims were false in both local and self_hosted mode.
      expect(result.stderr).not.toContain("not available in the self-hosted client");
      expect(result.stderr).not.toContain("runs on the self-hosted server");
    });
  }

  it("advertises the working status inspection in --help", () => {
    const program = new Command();
    registerProvisionCommands(program, () => {});
    const provision = program.commands.find((command) => command.name() === "provision");
    expect(provision?.description()).toContain("Inspect provisioning status");
  });
});
