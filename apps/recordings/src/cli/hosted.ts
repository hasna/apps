import { Command, CommanderError } from "commander";
import { HostedLibrary } from "../hosted/library.js";
import { HostedPasteHistory } from "../hosted/paste-history.js";
import { RecordingsSDKError } from "../hosted/transport.js";
import { hostedFailure, hostedProcessClient } from "../hosted/process-options.js";
import type { HostedRecordingsClient } from "../hosted/index.js";

const MAX_HOSTED_STDIN_BYTES = 1_048_576;

/** Read one bounded, fatal-UTF-8 transcript without retaining shell-visible arguments. */
async function readHostedTranscriptFromStdin(): Promise<string> {
  const reader = Bun.stdin.stream().getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > MAX_HOSTED_STDIN_BYTES) throw new RecordingsSDKError("invalid_input");
      chunks.push(value);
    }
    const bytes = new Uint8Array(length);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch (error) {
    if (error instanceof RecordingsSDKError) throw error;
    throw new RecordingsSDKError("invalid_input");
  } finally {
    void reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}

async function hostedTranscriptInput(text: string | undefined, fromStdin: boolean): Promise<string> {
  const sourceCount = [text !== undefined, fromStdin].filter(Boolean).length;
  if (sourceCount !== 1) throw new RecordingsSDKError("invalid_input");
  const transcript = fromStdin ? await readHostedTranscriptFromStdin() : text!;
  if (!transcript.trim()) throw new RecordingsSDKError("invalid_input");
  return transcript;
}

export interface HostedCLIOptions {
  write?: (value: string) => void;
  env?: Record<string, string | undefined>;
  /** Test/custom-runtime injection retains the same shared operation and parser. */
  client?: HostedRecordingsClient;
}
export function buildHostedCommand(options: HostedCLIOptions = {}): Command {
  const write = options.write ?? ((value: string) => { process.stdout.write(value); });
  const program = new Command("hosted").description("Manage hosted recordings and read paste history and providers; private text is omitted by default.")
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
  program.command("rename <id> <title>").description("Rename one hosted recording; returns metadata without transcript text")
    .action(async (id, title) => { write(JSON.stringify(await library().rename(id, title)) + "\n"); });
  program.command("save <id> <title>").description("Save one hosted recording; returns metadata without transcript text")
    .option("--transcript <text>", "Recording transcript")
    .option("--transcript-stdin", "Read recording transcript from bounded UTF-8 stdin")
    .requiredOption("--duration-ms <number>", "Recording duration in milliseconds")
    .option("--session-id <id>", "Optional recording session ID")
    .action(async (id, title, values) => {
      const transcript = await hostedTranscriptInput(values.transcript, Boolean(values.transcriptStdin));
      const input = { id, title, transcript, durationMs: Number(values.durationMs),
        ...(values.sessionId === undefined ? {} : { sessionId: values.sessionId }) };
      write(JSON.stringify(await library().save(input)) + "\n");
    });
  program.command("delete <id>").description("Permanently delete one hosted recording; pending means audio cleanup is unfinished, with no automatic retry")
    .action(async id => { write(JSON.stringify(await library().delete(id)) + "\n"); });
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
