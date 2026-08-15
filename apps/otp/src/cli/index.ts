#!/usr/bin/env bun
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Command } from "commander";
import {
  addOtpEntry,
  bootstrapOtpStorage,
  generateOtpCode,
  getOtpEntry,
  getOtpStorageStatus,
  importOtpAuthUri,
  listOtpEntries,
  removeOtpEntry,
} from "../index.js";
import type { AddOtpEntryInput, OtpEntry } from "../types.js";

function getPackageVersion(): string {
  try {
    const pkgPath = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "package.json");
    return (JSON.parse(readFileSync(pkgPath, "utf8")) as { version?: string }).version ?? "0.0.0";
  } catch {
    return "0.0.0";
  }
}

function printJson(value: unknown): void {
  console.log(JSON.stringify(value, null, 2));
}

function parseInteger(value: string, label: string): number {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed)) throw new Error(`${label} must be an integer`);
  return parsed;
}

function parseTime(value: string | undefined): Date | number | undefined {
  if (!value) return undefined;
  if (/^\d+$/.test(value)) return Number.parseInt(value, 10) * 1000;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) throw new Error("--at must be a Unix timestamp in seconds or ISO date");
  return date;
}

function generationOptions(at: string | undefined): { at?: Date | number } {
  const parsed = parseTime(at);
  return parsed === undefined ? {} : { at: parsed };
}

async function readSecretOption(options: { secret?: string; secretStdin?: boolean; secretEnv?: string }): Promise<string> {
  if (options.secretStdin) {
    return (await Bun.stdin.text()).trim();
  }
  if (options.secretEnv) {
    const value = process.env[options.secretEnv];
    if (!value) throw new Error(`Environment variable ${options.secretEnv} is empty or unset`);
    return value.trim();
  }
  if (options.secret) return options.secret.trim();
  throw new Error("Provide a secret with --secret, --secret-stdin, or --secret-env");
}

async function readUriOption(uri: string | undefined, options: { stdin?: boolean; file?: string }): Promise<string> {
  if (options.stdin) return (await Bun.stdin.text()).trim();
  if (options.file) return readFileSync(options.file, "utf8").trim();
  if (uri) return uri.trim();
  throw new Error("Provide an otpauth:// URI, --stdin, or --file <path>");
}

function compactEntry(entry: OtpEntry): Record<string, unknown> {
  return {
    id: entry.id,
    label: entry.label,
    issuer: entry.issuer,
    account: entry.account,
    algorithm: entry.algorithm,
    digits: entry.digits,
    period: entry.period,
    created_at: entry.created_at,
    updated_at: entry.updated_at,
  };
}

function formatEntries(entries: OtpEntry[]): string {
  if (!entries.length) return "No OTP entries.";
  return entries.map((entry) => [
    entry.id,
    entry.label,
    entry.issuer ?? "",
    entry.account,
    `${entry.digits} digits`,
    `${entry.period}s`,
  ].join("\t")).join("\n");
}

async function main(): Promise<void> {
  const program = new Command();

  program
    .name("otp")
    .description("Local encrypted OTP/TOTP manager for AI agent workflows")
    .version(getPackageVersion());

  program
    .command("bootstrap")
    .description("Create the local encrypted OTP store if missing")
    .option("--json", "print JSON")
    .action((options: { json?: boolean }) => {
      const status = bootstrapOtpStorage();
      if (options.json) printJson(status);
      else console.log(`OTP store ready at ${status.home}`);
    });

  program
    .command("status")
    .description("Show local OTP store status without revealing secrets")
    .option("--json", "print JSON")
    .action((options: { json?: boolean }) => {
      const status = getOtpStorageStatus();
      if (options.json) printJson(status);
      else {
        console.log(`home: ${status.home}`);
        console.log(`entries: ${status.entries}`);
        console.log(`storage: ${status.storage}`);
        console.log("encrypted_at_rest: true");
      }
    });

  program
    .command("add")
    .description("Add a TOTP entry. Secret values are never printed.")
    .requiredOption("--account <account>", "account/user label")
    .option("--issuer <issuer>", "issuer label")
    .option("--label <label>", "custom display label")
    .option("--id <id>", "custom stable id")
    .option("--secret <secret>", "base32 TOTP secret; prefer --secret-stdin or --secret-env")
    .option("--secret-stdin", "read the base32 TOTP secret from stdin")
    .option("--secret-env <name>", "read the base32 TOTP secret from an environment variable")
    .option("--algorithm <algorithm>", "SHA1, SHA256, or SHA512", "SHA1")
    .option("--digits <n>", "code length, 6 to 8 digits (default: 6)")
    .option("--period <seconds>", "TOTP period, 1 to 300 seconds (default: 30)")
    .option("--json", "print JSON")
    .action(async (options: {
      account: string;
      issuer?: string;
      label?: string;
      id?: string;
      secret?: string;
      secretStdin?: boolean;
      secretEnv?: string;
      algorithm?: string;
      digits?: string;
      period?: string;
      json?: boolean;
    }) => {
      const input: AddOtpEntryInput = {
        account: options.account,
        secret: await readSecretOption(options),
      };
      if (options.algorithm) input.algorithm = options.algorithm;
      if (options.digits) input.digits = parseInteger(options.digits, "--digits");
      if (options.period) input.period = parseInteger(options.period, "--period");
      if (options.id) input.id = options.id;
      if (options.issuer) input.issuer = options.issuer;
      if (options.label) input.label = options.label;
      const entry = await addOtpEntry(input);
      if (options.json) printJson(compactEntry(entry));
      else console.log(`Added ${entry.label} (${entry.id})`);
    });

  program
    .command("import")
    .description("Import an otpauth://totp URI without printing the embedded secret")
    .argument("[uri]", "otpauth://totp URI")
    .option("--stdin", "read URI from stdin")
    .option("--file <path>", "read URI from a file")
    .option("--id <id>", "custom stable id")
    .option("--label <label>", "custom display label")
    .option("--json", "print JSON")
    .action(async (uri: string | undefined, options: {
      stdin?: boolean;
      file?: string;
      id?: string;
      label?: string;
      json?: boolean;
    }) => {
      const entry = importOtpAuthUri({
        uri: await readUriOption(uri, options),
        ...(options.id ? { id: options.id } : {}),
        ...(options.label ? { label: options.label } : {}),
      });
      if (options.json) printJson(compactEntry(entry));
      else console.log(`Imported ${entry.label} (${entry.id})`);
    });

  program
    .command("list")
    .description("List OTP entries without revealing secrets")
    .option("--json", "print JSON")
    .action((options: { json?: boolean }) => {
      const entries = listOtpEntries();
      if (options.json) printJson(entries.map(compactEntry));
      else console.log(formatEntries(entries));
    });

  program
    .command("show")
    .description("Show one OTP entry without revealing its seed")
    .argument("<target>", "entry id, label, issuer:account, or unique account")
    .option("--code", "include a freshly generated TOTP code")
    .option("--at <time>", "Unix timestamp in seconds or ISO date (with --code)")
    .option("--json", "print JSON")
    .action((target: string, options: { code?: boolean; at?: string; json?: boolean }) => {
      const entry = getOtpEntry(target);
      if (!entry) throw new Error(`OTP entry "${target}" was not found`);
      if (options.code) {
        const generated = generateOtpCode(target, generationOptions(options.at));
        if (options.json) printJson({ ...compactEntry(entry), code: generated.code, expires_at: generated.expires_at, expires_in: generated.expires_in });
        else {
          console.log(`id: ${entry.id}`);
          console.log(`label: ${entry.label}`);
          console.log(`account: ${entry.account}`);
          if (entry.issuer) console.log(`issuer: ${entry.issuer}`);
          console.log(`code: ${generated.code}`);
          console.log(`expires_in: ${generated.expires_in}s`);
        }
        return;
      }
      if (options.json) printJson(compactEntry(entry));
      else {
        console.log(`id: ${entry.id}`);
        console.log(`label: ${entry.label}`);
        console.log(`account: ${entry.account}`);
        if (entry.issuer) console.log(`issuer: ${entry.issuer}`);
        console.log(`algorithm: ${entry.algorithm}`);
        console.log(`digits: ${entry.digits}`);
        console.log(`period: ${entry.period}s`);
      }
    });

  program
    .command("generate")
    .alias("code")
    .description("Generate a TOTP code by id, label, issuer:account, or unique account")
    .argument("<target>", "entry id, label, issuer:account, or unique account")
    .option("--at <time>", "Unix timestamp in seconds or ISO date")
    .option("--json", "print JSON")
    .action((target: string, options: { at?: string; json?: boolean }) => {
      const generated = generateOtpCode(target, generationOptions(options.at));
      if (options.json) printJson(generated);
      else console.log(generated.code);
    });

  program
    .command("remove")
    .alias("rm")
    .description("Remove an OTP entry")
    .argument("<target>", "entry id, label, issuer:account, or unique account")
    .option("--json", "print JSON")
    .action((target: string, options: { json?: boolean }) => {
      const removed = removeOtpEntry(target);
      if (!removed) throw new Error(`OTP entry "${target}" was not found`);
      if (options.json) printJson({ removed: compactEntry(removed) });
      else console.log(`Removed ${removed.label} (${removed.id})`);
    });

  await program.parseAsync(process.argv);
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`otp: ${message}`);
  process.exit(1);
});
