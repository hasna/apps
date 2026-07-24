import type { Command } from "commander";
import { getDomainOwnerByDomainName } from "../../db/owners.js";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

async function requireDomainOwner(identifier: string) {
  const owner = await getDomainOwnerByDomainName(identifier);
  if (!owner) {
    console.error(`No owner info found for '${identifier}'.`);
    process.exit(1);
  }
  return owner;
}

export function registerOutreachCommand(program: Command): void {
  const outreach = program
    .command("outreach")
    .description("Contact domain owners via SMS, WhatsApp, or email");

  // ── sms ────────────────────────────────────────────────────────────────

  outreach
    .command("sms <identifier>")
    .description("Send SMS to a domain owner")
    .requiredOption("--message <text>", "SMS message body")
    .option("-j, --json", "Output JSON")
    .action(async (identifier: string, opts: { message: string; json?: boolean }) => {
      const owner = await requireDomainOwner(identifier);
      if (!owner.owner_phone) {
        console.error(`No phone number for '${identifier}'.`);
        process.exit(1);
      }

      try {
        const { stdout } = await execFileAsync("connect-telephony", [
          "sms",
          "send",
          "--to", owner.owner_phone,
          "--message", opts.message,
          "--format", "json",
        ], { encoding: "utf-8" });

        const result = JSON.parse(stdout) as Record<string, unknown>;
        if (opts.json) {
          console.log(JSON.stringify({ domain: identifier, to: owner.owner_phone, result }, null, 2));
        } else {
          console.log(`SMS sent to ${owner.owner_name ?? owner.owner_email} (${owner.owner_phone}): "${opts.message}"`);
        }
      } catch (error: unknown) {
        const msg = error instanceof Error ? error.message : String(error);
        console.error(`SMS send failed: ${msg}`);
        process.exit(1);
      }
    });

  // ── whatsapp ───────────────────────────────────────────────────────────

  outreach
    .command("whatsapp <identifier>")
    .description("Send WhatsApp message to a domain owner")
    .requiredOption("--message <text>", "Message body")
    .option("-j, --json", "Output JSON")
    .action(async (identifier: string, opts: { message: string; json?: boolean }) => {
      const owner = await requireDomainOwner(identifier);
      if (!owner.owner_phone) {
        console.error(`No phone number for '${identifier}'.`);
        process.exit(1);
      }

      try {
        const { stdout } = await execFileAsync("connect-telephony", [
          "whatsapp",
          "send",
          "--to", owner.owner_phone,
          "--message", opts.message,
          "--format", "json",
        ], { encoding: "utf-8" });

        const result = JSON.parse(stdout) as Record<string, unknown>;
        if (opts.json) {
          console.log(JSON.stringify({ domain: identifier, to: owner.owner_phone, result }, null, 2));
        } else {
          console.log(`WhatsApp sent to ${owner.owner_name ?? owner.owner_email} (${owner.owner_phone}): "${opts.message}"`);
        }
      } catch (error: unknown) {
        const msg = error instanceof Error ? error.message : String(error);
        console.error(`WhatsApp send failed: ${msg}`);
        process.exit(1);
      }
    });

  // ── email ──────────────────────────────────────────────────────────────

  outreach
    .command("email <identifier>")
    .description("Send email to a domain owner")
    .requiredOption("--subject <text>", "Email subject")
    .requiredOption("--body <text>", "Email body (plain text)")
    .option("--template <name>", "Use a template by name instead of --body")
    .option("-j, --json", "Output JSON")
    .action(async (identifier: string, opts: { subject: string; body: string; template?: string; json?: boolean }) => {
      const owner = await requireDomainOwner(identifier);
      if (!owner.owner_email) {
        console.error(`No email for '${identifier}'.`);
        process.exit(1);
      }

      try {
        const { stdout } = await execFileAsync("connect-emails", [
          "send",
          "--to", owner.owner_email,
          "--subject", opts.subject,
          "--body", opts.template ? "" : opts.body,
          ...(opts.template ? ["--template", opts.template] : []),
          "--format", "json",
        ], { encoding: "utf-8" });

        const result = JSON.parse(stdout) as Record<string, unknown>;
        if (opts.json) {
          console.log(JSON.stringify({ domain: identifier, to: owner.owner_email, result }, null, 2));
        } else {
          console.log(`Email sent to ${owner.owner_name ?? owner.owner_email} (${owner.owner_email}): "${opts.subject}"`);
        }
      } catch (error: unknown) {
        const msg = error instanceof Error ? error.message : String(error);
        console.error(`Email send failed: ${msg}`);
        process.exit(1);
      }
    });
}
