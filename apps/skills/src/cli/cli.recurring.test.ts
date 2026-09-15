import { expect, test } from "bun:test";
import { Command } from "commander";
import { Readable } from "node:stream";
import { join } from "node:path";
import { writeFileSync } from "node:fs";
import { registerRecurringCommands } from "./commands/recurring.js";
import { recurringFixtureEnvironment, recurringProtocol, recurringFixtureRequest } from "../lib/recurring-surface.fixture.js";
import { useDefaultTestTimeout } from "../test-preload.js";
useDefaultTestTimeout();

/** Commander/stdin adapter test, not an installed child or physical PTY claim. */
async function invoke(args: string[], code = "123456\n") {
  const command = new Command("skills"); registerRecurringCommands(command);
  const override = (c: Command) => { c.exitOverride(); c.commands.forEach(override); }; override(command);
  const stdout = process.stdout.write, stderr = process.stderr.write, stdin = Object.getOwnPropertyDescriptor(process, "stdin")!, exit = process.exitCode;
  let output = "", diagnostic = "", parserError = false;
  process.stdout.write = ((chunk: unknown, ...rest: unknown[]) => { output += String(chunk); (rest.find(v => typeof v === "function") as (() => void) | undefined)?.(); return true; }) as typeof stdout;
  process.stderr.write = ((chunk: unknown, ...rest: unknown[]) => { diagnostic += String(chunk); (rest.find(v => typeof v === "function") as (() => void) | undefined)?.(); return true; }) as typeof stderr;
  Object.defineProperty(process, "stdin", { configurable: true, value: Object.assign(Readable.from([code]), { isTTY: false }) }); process.exitCode = 0;
  try {
    try { await command.parseAsync(["bun", "skills", "recurring", ...args]); } catch { parserError = true; }
    return { output, diagnostic, parserError, exitCode: process.exitCode };
  } finally { process.stdout.write = stdout; process.stderr.write = stderr; Object.defineProperty(process, "stdin", stdin); process.exitCode = exit; }
}
test("Commander JSON activation uses bounded stdin and original terms, then all control leaves work", () => recurringProtocol(f => recurringFixtureEnvironment(f.env, async () => {
  const file = join(f.root, "request.json"); writeFileSync(file, JSON.stringify(recurringFixtureRequest()), { mode: 0o600 });
  const run = async (args: string[]) => {
    const result = await invoke([...args, "--json"]); expect(result.exitCode).toBe(0); expect(result.parserError).toBe(false);
    expect(result.output + result.diagnostic).not.toContain("123456"); expect(result.output + result.diagnostic).not.toContain("inert-session"); return JSON.parse(result.output);
  };
  expect(await run(["preview", "--request", file])).toMatchObject({ draftId: f.draftId });
  expect(await run(["draft", f.draftId])).toEqual(f.preview());
  expect(await run(["verification", f.draftId, "--email", "owner@example.test", "--confirm"])).toMatchObject({ deliveryConfirmed: false });
  const directory = join(f.root, "cli-activation"), before = f.snapshot();
  const activated = await run(["activate", f.draftId, "--accepted-terms", f.approval.acceptedTermsSha256, "--idempotency-key", f.approval.idempotencyKey,
    "--acceptance", f.approval.acceptance, "--confirm", "--recovery-dir", directory, "--email", "owner@example.test", "--code-stdin"]);
  const consentId = activated.result.consent.consentId;
  expect((await run(["list", "--limit", "1"])).items).toHaveLength(1);
  expect((await run(["get", consentId])).consentId).toBe(consentId);
  expect((await run(["occurrences", consentId])).nextCursor).toBeNull();
  expect((await run(["recover", "--recovery-dir", directory])).phase).toBe("observed");
  expect((await run(["revoke", consentId, "--confirm", "--recovery-dir", join(f.root, "cli-revoke")])).result.cancellationIsSeparate).toBe(true);
  expect(f.snapshot()).toEqual(before);
})));
test("Commander refuses extra fields, unbounded pages and absent literal consent before HTTP", () => recurringProtocol(f => recurringFixtureEnvironment(f.env, async () => {
  for (const args of [["list", "--limit", "101"], ["get", f.draftId, "--organization-id", f.identity.organization.id],
    ["activate", f.draftId, "--accepted-terms", f.approval.acceptedTermsSha256, "--idempotency-key", f.approval.idempotencyKey,
      "--recovery-dir", join(f.root, "refused"), "--confirm", "--email", "owner@example.test", "--code-stdin"]]) {
    const result = await invoke([...args, "--json"]); expect(result.exitCode !== 0 || result.parserError).toBe(true);
  }
  expect(f.calls).toHaveLength(0);
})));
