import type { Command } from "commander";
import chalk from "chalk";
import { readFileSync } from "fs";
import { closeDb } from "../../lib/db.js";
import { resolveIdentity } from "../../lib/identity.js";
import { redactMessagesById } from "../../lib/admin-redaction.js";

function parseMessageIds(values: string[], idsFile?: string): number[] {
  const tokens = [...values];
  if (idsFile) {
    tokens.push(...readFileSync(idsFile, "utf8").split(/[\s,]+/));
  }
  return tokens
    .map((token) => token.trim())
    .filter(Boolean)
    .map((token) => {
      const id = Number.parseInt(token, 10);
      if (!Number.isInteger(id) || id <= 0 || String(id) !== token) {
        throw new Error(`Invalid message id: ${token}`);
      }
      return id;
    });
}

function printRedactionSummary(result: ReturnType<typeof redactMessagesById>): void {
  const mode = result.applied ? chalk.red("APPLIED") : chalk.yellow("DRY RUN");
  console.log(`${mode} message redaction report`);
  console.log(chalk.dim(`matched ${result.matched_count}/${result.requested_ids.length}; missing ${result.missing_ids.length}; redacted ${result.redacted_count}`));
  console.log(chalk.dim(`surfaces: ${result.surfaces.join(", ")}`));
  for (const message of result.messages) {
    if (!message.exists) {
      console.log(chalk.dim(`#${message.id}: missing`));
      continue;
    }
    const classes = message.secret_classes.length > 0 ? message.secret_classes.join(",") : "unclassified";
    const fields = message.fields.join(",");
    const fileSummary = message.attachment_file_count > 0
      ? ` attachment_files=${message.attachment_file_count} deleted=${message.attachment_files_deleted} unsafe=${message.unsafe_attachment_file_count}`
      : "";
    console.log(`#${message.id}: ${fields} classes=${classes}${fileSummary}`);
  }
  if (!result.applied) {
    console.log(chalk.dim("No data was changed. Apply requires --apply --backup-confirmed --dry-run-confirmed --authority <ref>."));
  }
}

export function registerAdminCommands(program: Command): void {
  const admin = program
    .command("admin")
    .description("Audited administrative maintenance commands");

  admin
    .command("redact-messages")
    .description("Redact known credential-shaped message ids without printing message bodies")
    .argument("[ids...]", "Numeric message IDs to redact")
    .option("--ids-file <path>", "Read additional numeric message IDs from a newline/comma-separated file")
    .option("--actor <agent>", "Actor performing the review/redaction")
    .option("--reason <text>", "Audit reason for the redaction", "credential-shaped message remediation")
    .option("--authority <ref>", "Owner authority reference required with --apply")
    .option("--apply", "Apply redaction; default is dry-run only")
    .option("--backup-confirmed", "Confirm a current backup exists before live mutation")
    .option("--dry-run-confirmed", "Confirm the dry-run report was reviewed before live mutation")
    .option("--no-purge-attachments", "Do not delete local attachment files during apply")
    .option("-j, --json", "Output as JSON")
    .action((ids: string[], opts) => {
      try {
        const messageIds = parseMessageIds(ids, opts.idsFile);
        const actor = resolveIdentity(opts.actor).trim();
        if (!actor) {
          console.error(chalk.red("Actor identity is required."));
          process.exit(1);
        }

        const result = redactMessagesById({
          ids: messageIds,
          actor,
          reason: opts.reason,
          apply: opts.apply,
          authority: opts.authority,
          backupConfirmed: opts.backupConfirmed,
          dryRunConfirmed: opts.dryRunConfirmed,
          purgeAttachments: opts.purgeAttachments,
        });

        if (opts.json) {
          console.log(JSON.stringify(result, null, 2));
        } else {
          printRedactionSummary(result);
        }
      } catch (error) {
        console.error(chalk.red(error instanceof Error ? error.message : String(error)));
        process.exit(1);
      } finally {
        closeDb();
      }
    });
}
