import { Command, CommanderError } from "commander";
import { HostedLibrary } from "../hosted/library.js";
import { HostedPasteHistory } from "../hosted/paste-history.js";
import { hostedFailure, hostedProcessClient } from "../hosted/process-options.js";
import type { HostedRecordingsClient } from "../hosted/index.js";

export interface HostedCLIOptions {
  write?: (value: string) => void;
  env?: Record<string, string | undefined>;
  /** Test/custom-runtime injection retains the same shared operation and parser. */
  client?: HostedRecordingsClient;
}
export function buildHostedCommand(options: HostedCLIOptions = {}): Command {
  const write = options.write ?? ((value: string) => { process.stdout.write(value); });
  const program = new Command("hosted").description("Read hosted recordings, paste history and transcription providers; private text is omitted by default.")
    .requiredOption("--api-base <url>", "Complete hosted API base ending in /v1/")
    .requiredOption("--credential-env <name>", "Name of the environment variable containing this API's bearer session")
    .exitOverride().configureOutput({ writeOut: write, writeErr: () => {} });
  const library = () => new HostedLibrary(options.client ?? hostedProcessClient(program.opts(), options.env));
  program.command("providers").description("Read the server's transcription providers, models and defaults")
    .action(async () => {
      const client = options.client ?? hostedProcessClient(program.opts(), options.env);
      write(JSON.stringify(await client.providers()) + "\n");
    });
  const list = program.command("list").description("Read one page of hosted recording metadata")
    .option("--limit <number>", "Page size, 1–100", "25")
    .option("--before <timestamp>", "UTC timestamp from the returned nextCursor")
    .option("--before-id <id>", "Recording ID from the same nextCursor")
    .option("--include-text", "Include private transcripts", false);
  list.action(async values => {
    const result = await library().list({ limit: Number(values.limit), before: values.before,
      beforeId: values.beforeId, includeText: values.includeText });
    write(JSON.stringify(result) + "\n");
  });
  program.command("get <id>").description("Read one hosted recording's metadata")
    .option("--include-text", "Include its private transcript", false)
    .action(async (id, values) => { write(JSON.stringify(await library().get(id, { includeText: values.includeText })) + "\n"); });
  program.command("paste-history").description("Read client-reported paste history; private text is omitted by default")
    .option("--limit <number>", "Page size, 1–100", "25")
    .option("--before <timestamp>", "UTC timestamp from the returned nextCursor")
    .option("--before-id <id>", "Receipt ID from the same nextCursor")
    .option("--include-text", "Include private pasted text", false)
    .action(async values => {
      const history = new HostedPasteHistory(options.client ?? hostedProcessClient(program.opts(), options.env));
      write(JSON.stringify(await history.list({ limit: Number(values.limit), before: values.before,
        beforeId: values.beforeId, includeText: values.includeText })) + "\n");
    });
  return program;
}
export function reportHostedCLIError(error: unknown, write = (value: string) => { process.stdout.write(value); }): number {
  if (error instanceof CommanderError && error.code === "commander.helpDisplayed") return 0;
  write(JSON.stringify(hostedFailure(error)) + "\n"); return 1;
}
export async function runHostedCLI(args: string[], options: HostedCLIOptions = {}): Promise<number> {
  const program = buildHostedCommand(options).name("recordings hosted");
  try {
    if (!args.length) { program.outputHelp(); return 0; }
    await program.parseAsync(args, { from: "user" }); return 0;
  } catch (error) {
    return reportHostedCLIError(error, options.write);
  }
}
