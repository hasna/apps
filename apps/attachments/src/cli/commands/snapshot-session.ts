import { Command } from "commander";
import { exitError } from "../utils";

/**
 * Register the session snapshot command.
 *
 * The former implementation fetched and materialized an unbounded transcript
 * and uploaded it without deterministic redaction, a validated receipt, or
 * authoritative readback. Keep the command visible for compatibility, but
 * fail closed until the package-owned producer and complete snapshot mutation
 * contract are implemented and independently verified.
 */
export function registerSnapshotSession(program: Command): void {
  program
    .command("snapshot-session <session-id>")
    .description("Fetch a bounded, redacted session transcript and upload it as an attachment")
    .option("--sessions-url <url>", "Sessions REST API base URL")
    .option("--format <fmt>", "Output format: markdown or html", "markdown")
    .option("--expiry <time>", "Link expiry: e.g. 7d, 24h, never")
    .option("--tag <tag>", "Tag/label for the attachment")
    .action(() => {
      exitError(
        "snapshot-session is unavailable: the installed producer contract does not prove finite capture bounds, deterministic redaction, a validated receipt, or attachment readback"
      );
    });
}
