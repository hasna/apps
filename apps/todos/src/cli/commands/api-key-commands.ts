import type { Command } from "commander";
import chalk from "chalk";
import { createApiKey, listApiKeys, revokeApiKey, verifyApiKey } from "../../db/api-keys.js";
import { handleError, output } from "../helpers.js";

export function registerApiKeyCommands(program: Command) {
  const apiKeys = program
    .command("api-keys")
    .alias("api-key")
    .description("Generate, list, and revoke API keys for secured app/API access");

  apiKeys
    .command("create <name>")
    .alias("generate")
    .description("Generate a new API key. The plaintext key is shown once.")
    .option("--expires-at <iso>", "Optional ISO timestamp when this key expires")
    .option("--permissions <list>", "Comma-separated permissions (default: *)")
    .action((name: string, opts: { expiresAt?: string; permissions?: string }) => {
      const globalOpts = program.opts();
      try {
        const permissions = opts.permissions
          ? opts.permissions.split(",").map((item) => item.trim()).filter(Boolean)
          : undefined;
        const created = createApiKey({ name, permissions, expires_at: opts.expiresAt || null });
        if (globalOpts.json) {
          output(created, true);
          return;
        }
        console.log(chalk.green("API key generated:"));
        console.log(`  ${chalk.dim("ID:")}     ${created.record.id}`);
        console.log(`  ${chalk.dim("Name:")}   ${created.record.name}`);
        console.log(`  ${chalk.dim("Prefix:")} ${created.record.prefix}`);
        console.log();
        console.log(chalk.yellow("Copy this key now. It will not be shown again:"));
        console.log(created.key);
      } catch (e) {
        handleError(e);
      }
    });

  apiKeys
    .command("list")
    .description("List API keys without showing plaintext secrets")
    .option("--include-revoked", "Include revoked keys")
    .action((opts: { includeRevoked?: boolean }) => {
      const globalOpts = program.opts();
      try {
        const keys = listApiKeys({ include_revoked: opts.includeRevoked ?? false });
        if (globalOpts.json) {
          output(keys, true);
          return;
        }
        if (keys.length === 0) {
          console.log(chalk.dim("No API keys found."));
          return;
        }
        for (const key of keys) {
          const state = key.revoked_at ? chalk.red("revoked") : key.expires_at && key.expires_at < new Date().toISOString() ? chalk.yellow("expired") : chalk.green("active");
          console.log(`${chalk.cyan(key.id)} ${chalk.bold(key.name)} ${chalk.dim(key.prefix)} ${state}`);
          if (key.last_used_at) console.log(chalk.dim(`  last used: ${key.last_used_at}`));
          if (key.expires_at) console.log(chalk.dim(`  expires:   ${key.expires_at}`));
        }
      } catch (e) {
        handleError(e);
      }
    });

  apiKeys
    .command("revoke <id-or-prefix>")
    .description("Revoke an API key by id or prefix")
    .action((idOrPrefix: string) => {
      const globalOpts = program.opts();
      try {
        const revoked = revokeApiKey(idOrPrefix);
        if (!revoked) {
          throw new Error(`API key not found: ${idOrPrefix}`);
        }
        if (globalOpts.json) {
          output(revoked, true);
          return;
        }
        console.log(chalk.green(`Revoked API key: ${revoked.name} (${revoked.prefix})`));
      } catch (e) {
        handleError(e);
      }
    });

  apiKeys
    .command("verify <key>")
    .description("Verify an API key locally without printing stored hashes")
    .action((key: string) => {
      const globalOpts = program.opts();
      try {
        const record = verifyApiKey(key);
        if (globalOpts.json) {
          output({ valid: Boolean(record), key: record }, true);
          return;
        }
        if (!record) {
          console.error(chalk.red("API key is invalid, revoked, or expired."));
          process.exit(1);
        }
        console.log(chalk.green(`API key valid: ${record.name} (${record.prefix})`));
      } catch (e) {
        handleError(e);
      }
    });
}
