import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";

export interface SigningEmailInput {
  from: string;
  to: string;
  signerName?: string;
  documentName: string;
  signingUrl: string;
  attachmentPath?: string;
  dryRun?: boolean;
}

export interface SigningEmailResult {
  sent: boolean;
  dry_run: boolean;
  command?: string[];
  output?: string;
  error?: string;
}

export function sendSigningEmail(input: SigningEmailInput): SigningEmailResult {
  const body = [
    `Hello${input.signerName ? ` ${input.signerName}` : ""},`,
    "",
    `Please review and sign "${input.documentName}".`,
    "",
    input.signingUrl,
    "",
    "This message was prepared by Hasna Signatures.",
  ].join("\n");

  const args = [
    "send",
    "--from", input.from,
    "--to", input.to,
    "--subject", `Signature requested: ${input.documentName}`,
    "--body", body,
  ];

  if (input.attachmentPath && existsSync(input.attachmentPath)) {
    args.push("--attachment", input.attachmentPath);
  }
  if (input.dryRun) args.push("--dry-run");

  const command = ["emails", ...args];
  const result = spawnSync("emails", args, { encoding: "utf-8" });
  if (result.error) {
    return {
      sent: false,
      dry_run: !!input.dryRun,
      command,
      error: result.error.message,
    };
  }

  return {
    sent: result.status === 0 && !input.dryRun,
    dry_run: !!input.dryRun,
    command,
    output: [result.stdout, result.stderr].filter(Boolean).join("\n").trim(),
    error: result.status === 0 ? undefined : `emails exited with ${result.status}`,
  };
}
