import chalk from "chalk";
import { describeSendRedaction, type SendRedactionNotice } from "../lib/content-safety.js";
import { printErrorLine } from "../lib/stdout.js";

/**
 * Distinct from 1 (send failed) on purpose: the message DID persist and has a
 * real id, but its body is not what the author wrote. A caller scripting around
 * `conversations send` has to be able to tell "nothing was stored" apart from
 * "something different was stored", and a bare success told it neither.
 */
export const REDACTION_EXIT_CODE = 2;

/**
 * Tell the author when what landed is not what they wrote.
 *
 * Redaction was previously invisible from the sending side: rc=0, a real
 * message id, no warning. Three messages were destroyed that way and every one
 * of them was discovered by a different agent reading the channel — including a
 * correction to a wrongly-closed incident, and a self-critical NO_GO record
 * whose author retried and lost it twice.
 */
export function warnIfRedacted(submitted: string, stored: string | null | undefined): SendRedactionNotice {
  const notice = describeSendRedaction(submitted, stored);
  if (!notice.redacted) return notice;

  printErrorLine(chalk.yellow.bold("WARNING: your message is not what readers will see."));
  printErrorLine(chalk.yellow(notice.message));
  printErrorLine(
    chalk.yellow("Re-read it in the channel before assuming the record landed. If this is a false positive, report it — do not silently retry unchanged."),
  );
  process.exitCode = REDACTION_EXIT_CODE;

  return notice;
}
