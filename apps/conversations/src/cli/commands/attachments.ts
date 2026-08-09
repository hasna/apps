import type { Command } from "commander";
import chalk from "chalk";
import { writeFileSync } from "node:fs";
import { getStore } from "../../lib/store/index.js";
import { closeDb } from "../../lib/db.js";
import {
  AttachmentRetrievalError,
  type RetrievedAttachment,
} from "../../lib/attachment-retrieval.js";
import { assertNoSensitiveContent } from "../../lib/content-safety.js";
import { printErrorLine, printLine, writeStdoutBytes } from "../../lib/stdout.js";
import { emitCliError } from "../cli-error.js";

function errorCode(error: unknown): string | null {
  if (!error || typeof error !== "object") return null;
  const code = (error as { code?: unknown }).code;
  return typeof code === "string" ? code : null;
}

function failMessage(message: string): never {
  printErrorLine(chalk.red(message));
  closeDb();
  process.exit(1);
}

function failRetrieval(error: unknown): never {
  if (error instanceof AttachmentRetrievalError) {
    failMessage(error.message);
  }
  failMessage(
    "Attachment retrieval failed without returning bytes. " +
      "Check the configured Conversations store and retry.",
  );
}

export function registerAttachmentCommands(program: Command): void {
  const attachments = program
    .command("attachments")
    .description("Retrieve message attachment bytes");

  attachments
    .command("get")
    .description("Retrieve one message attachment without overwriting existing files")
    .argument("<message-id>", "Positive numeric message ID")
    .argument("<name>", "Exact attachment name from conversations show <id> --json")
    .option("-o, --output <path>", "Write to a new file with mode 0600")
    .option("--stdout", "Write raw attachment bytes to stdout")
    .action(async (messageIdArg: string, nameArg: string, opts: {
      output?: string;
      stdout?: boolean;
    }) => {
      if (!/^\d+$/.test(messageIdArg)) {
        emitCliError("Message id must be a positive integer.");
      }
      const messageId = Number(messageIdArg);
      if (!Number.isSafeInteger(messageId) || messageId <= 0) {
        emitCliError("Message id must be a positive safe integer.");
      }
      const name = nameArg.trim();
      if (!name) emitCliError("Attachment name cannot be empty.");
      try {
        assertNoSensitiveContent(name, "Attachment name");
      } catch {
        emitCliError("Attachment name contains sensitive content and cannot be echoed safely.");
      }

      const output = typeof opts.output === "string" ? opts.output.trim() : "";
      const toStdout = opts.stdout === true;
      if ((output ? 1 : 0) + (toStdout ? 1 : 0) !== 1) {
        emitCliError("Choose exactly one destination: --output <path> or --stdout.");
      }

      let attachment: RetrievedAttachment;
      try {
        attachment = await getStore().getMessageAttachment(messageId, name);
      } catch (error) {
        failRetrieval(error);
      }

      if (toStdout) {
        writeStdoutBytes(attachment.content);
        if (attachment.size === 0) {
          printErrorLine(chalk.dim(`Attachment "${attachment.name}" is empty; 0 bytes written to stdout.`));
        }
        closeDb();
        return;
      }

      try {
        writeFileSync(output, attachment.content, { flag: "wx", mode: 0o600 });
      } catch (error) {
        const code = errorCode(error);
        if (code === "EEXIST") {
          failMessage("Output file already exists. Choose a new --output path; existing files are never overwritten.");
        }
        if (code === "EACCES" || code === "EPERM") {
          failMessage("Permission denied while writing the output file. Choose a writable --output path.");
        }
        failMessage("Could not write the output file. Choose a valid writable --output path.");
      }
      printLine(chalk.green(`Saved attachment "${attachment.name}" (${attachment.size} bytes).`));
      closeDb();
    });
}
