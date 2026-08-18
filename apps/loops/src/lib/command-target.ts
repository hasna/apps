import { createHash } from "node:crypto";
import type { CommandTarget } from "../types.js";
import { scrubSecrets } from "./redact.js";

/**
 * Command-target integrity surface (loops bbe50c53).
 *
 * `loops show --json` previously reported the literal string `'shell'` for
 * shell command targets, so a control-plane reader could not prove which
 * command the loop would actually execute. This module provides the canonical
 * resolved command line (byte-identical to the executor's own shell path),
 * a `cmd:sha256:` digest over those exact bytes, and a verify helper.
 *
 * The digest is computed over the RAW stored command line — never over a
 * scrubbed or displayed form — so a one-byte mutation of the stored command
 * changes the digest, while the displayed surface can stay secret-safe.
 */

export const COMMAND_DIGEST_PREFIX = "cmd:sha256:";

/** Shell-quote a single argv element exactly like the executor's shell path. */
export function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

/**
 * The exact command line the executor will run for a command target:
 * `command` followed by shell-quoted `args`, space-joined. For a bare command
 * with no args this is the command itself. Matches the executor's shell path
 * (`sh -c <this string>`) byte for byte, so a digest over this string binds
 * what actually executes.
 */
export function resolvedCommandLine(target: Pick<CommandTarget, "command" | "args">): string {
  const args = target.args ?? [];
  if (args.length === 0) return target.command;
  return [target.command, ...args.map(shellQuote)].join(" ");
}

/**
 * Secret-safe integrity commitment for a command target. The digest binds the
 * exact resolved command line (command + shell-quoted args) and reveals
 * nothing about its content.
 */
export function commandTargetDigest(target: Pick<CommandTarget, "command" | "args">): string {
  return `${COMMAND_DIGEST_PREFIX}${sha256Hex(resolvedCommandLine(target))}`;
}

/**
 * Prove an intended candidate command line matches a digest returned by the
 * control-plane surface. Returns false for any malformed or mismatched digest;
 * the literal `'shell'` can never pass as integrity evidence for a real
 * command because it hashes to a different value.
 */
export function verifyCommandDigest(candidate: string, digest: string): boolean {
  if (!digest.startsWith(COMMAND_DIGEST_PREFIX)) return false;
  const expected = sha256Hex(candidate);
  return digest === `${COMMAND_DIGEST_PREFIX}${expected}`;
}

function safeCommandName(command: string): string {
  const normalized = command.replaceAll("\\", "/");
  return normalized.slice(normalized.lastIndexOf("/") + 1) || "command";
}

/**
 * Secret-safe display descriptor of a command target, used by every surface
 * that shows a command loop's target (show, list labels, and the default loop
 * description). For a shell target this is the REAL resolved command line,
 * secret-scrubbed and bounded to `visible` characters with the remainder's
 * length noted — never the placeholder literal `'shell'`. For a non-shell
 * target it is the command's own name, unchanged.
 */
export function publicCommandDescriptor(
  target: Pick<CommandTarget, "command" | "args" | "shell">,
  visible = 80,
): string {
  if (!target.shell) return safeCommandName(target.command);
  const scrubbed = scrubSecrets(resolvedCommandLine(target));
  if (scrubbed.length <= visible) return scrubbed;
  return `${scrubbed.slice(0, visible)}... [redacted ${scrubbed.length - visible} chars]`;
}

function sha256Hex(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}
