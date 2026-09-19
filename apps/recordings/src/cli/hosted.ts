import { Command, CommanderError } from "commander";
import { transcriptDestination, writeTranscriptExport } from "./hosted-export.js";
import { HostedLibrary } from "../hosted/library.js";
import { HostedPasteHistory } from "../hosted/paste-history.js";
import { RecordingsSDKError } from "../hosted/transport.js";
import { assertAudioDestination, prepareAudioUpload, writeAudioDownload } from "../hosted/audio-files.js";
import { hostedFailure, hostedProcessClient } from "../hosted/process-options.js";
import { HostedRecordingsClient } from "../hosted/index.js";
import { resolveRecordingsSdkTransport } from "../sdk/resolve.js";

const MAX_HOSTED_STDIN_BYTES = 1_048_576;

/** Read one bounded, fatal-UTF-8 private text value without retaining shell-visible arguments. */
async function readHostedTextFromStdin(): Promise<string> {
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

async function hostedTextInput(text: string | undefined, fromStdin: boolean): Promise<string> {
  const sourceCount = [text !== undefined, fromStdin].filter(Boolean).length;
  if (sourceCount !== 1) throw new RecordingsSDKError("invalid_input");
  return fromStdin ? await readHostedTextFromStdin() : text!;
}
async function hostedTranscriptInput(text: string | undefined, fromStdin: boolean): Promise<string> {
  const transcript = await hostedTextInput(text, fromStdin);
  if (!transcript.trim()) throw new RecordingsSDKError("invalid_input");
  return transcript;
}

export interface HostedCLIOptions {
  write?: (value: string) => void;
  env?: Record<string, string | undefined>;
  /** Test/custom-runtime injection retains the same shared operation and parser. */
  client?: HostedRecordingsClient;
  /** Test/custom-runtime fetch injection, forwarded to the resolved hosted transport. */
  fetch?: typeof globalThis.fetch;
}

export interface HostedCommandAuthority { apiBase?: string; credentialEnv?: string }

/**
 * The hosted Library client for one invocation of `recordings hosted`.
 *
 * `--api-base` + `--credential-env` stay an explicit, named selection and are
 * still the only way to reach an arbitrary authority. With NEITHER flag the
 * command resolves through the ONE fleet chain (`resolveRecordingsSdkTransport`
 * -> `@hasna/contracts/client`), so a station that already holds a recordings
 * credential reads the hosted `/v1` Library without hand-building an authority
 * or exporting a bearer value.
 *
 * The unhosted local serve is never a hosted Library: when the chain selects it
 * - or resolves no credential - this fails closed rather than reading a local
 * process and calling the result "hosted".
 */
export function hostedCommandClient(
  authority: HostedCommandAuthority,
  env: Record<string, string | undefined> = process.env,
  fetchImpl?: typeof globalThis.fetch,
): HostedRecordingsClient {
  if (authority.apiBase !== undefined || authority.credentialEnv !== undefined) {
    if (!authority.apiBase) throw new RecordingsSDKError("invalid_configuration");
    return hostedProcessClient({ apiBase: authority.apiBase, credentialEnv: authority.credentialEnv }, env, fetchImpl);
  }
  const transport = resolveRecordingsSdkTransport({ env });
  if (transport.mode !== "http" || !transport.apiKey) throw new RecordingsSDKError("credential_unavailable");
  const credential = transport.apiKey;
  return new HostedRecordingsClient({
    apiBase: `${transport.baseUrl}/v1`,
    fetch: fetchImpl,
    credentialProvider: () => credential,
  });
}
export function buildHostedCommand(options: HostedCLIOptions = {}): Command {
  const write = options.write ?? ((value: string) => { process.stdout.write(value); });
  const program = new Command("hosted").description("Manage hosted recordings and read paste history and providers; private text is omitted by default.")
    .option("--api-base <url>", "Complete hosted API base ending in /v1/ (default: the resolved recordings authority)")
    .option("--credential-env <name>", "Name of the environment variable containing this API's bearer session (default: the resolved recordings credential)")
    .exitOverride().configureOutput({ writeOut: write, writeErr: () => {} });
  const client = () => options.client ?? hostedCommandClient(program.opts(), options.env, options.fetch);
  const library = () => new HostedLibrary(client());
  program.command("providers").description("Read the server's transcription providers, models and defaults")
    .action(async () => {
      const client = options.client ?? hostedCommandClient(program.opts(), options.env, options.fetch);
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
  program.command("export <id>").description("Export a private transcript as UTF-8 plain text to a new file; never overwrites an existing path")
    .requiredOption("--output <path>", "Destination for the transcript file")
    .action(async (id, values) => {
      const destination = transcriptDestination(values.output);
      const exported = await library().export(id);
      write(JSON.stringify(writeTranscriptExport(exported, destination)) + "\n");
    });
  program.command("audio-metadata <id>").description("Read hosted audio availability and canonical format metadata")
    .action(async id => { write(JSON.stringify(await client().getAudioMetadata(id)) + "\n"); });
  program.command("audio-upload <id>").description("Upload one canonical WAV from an explicit regular file with retention consent")
    .requiredOption("--input <path>", "Existing regular WAV file to upload")
    .option("--retain-audio", "Explicitly retain hosted audio", false)
    .action(async (id, values) => {
      if (values.retainAudio !== true) throw new RecordingsSDKError("invalid_input");
      const upload = await prepareAudioUpload(values.input);
      write(JSON.stringify(await client().uploadAudio(id, upload)) + "\n");
    });
  program.command("audio-download <id>").description("Download one complete hosted WAV to a new destination file; existing files are preserved")
    .requiredOption("--output <path>", "New destination file; an existing path is refused")
    .action(async (id, values) => {
      await assertAudioDestination(values.output);
      const downloaded = await client().downloadAudio(id);
      const receipt = await writeAudioDownload(values.output, downloaded);
      write(JSON.stringify(receipt) + "\n");
    });
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
  program.command("paste-save <id>").description("Save one client-reported paste receipt; private text is read explicitly and omitted from output")
    .option("--text <text>", "Pasted text")
    .option("--text-stdin", "Read pasted text from bounded UTF-8 stdin")
    .requiredOption("--status <status>", "Delivery status: attempted, confirmed or failed")
    .option("--recording-id <id>", "Optional source recording ID")
    .option("--destination-app-id <id>", "Destination application bundle or application ID")
    .option("--destination-app-name <name>", "Destination application name")
    .option("--occurred-at <timestamp>", "Optional UTC timestamp ending in Z")
    .action(async (id, values) => {
      const text = await hostedTextInput(values.text, Boolean(values.textStdin));
      const value = { id, text, status: values.status,
        ...(values.recordingId === undefined ? {} : { recordingId: values.recordingId }),
        ...(values.destinationAppId === undefined ? {} : { destinationAppId: values.destinationAppId }),
        ...(values.destinationAppName === undefined ? {} : { destinationAppName: values.destinationAppName }),
        ...(values.occurredAt === undefined ? {} : { occurredAt: values.occurredAt }) };
      const history = new HostedPasteHistory(options.client ?? hostedCommandClient(program.opts(), options.env, options.fetch));
      write(JSON.stringify(await history.save(value)) + "\n");
    });
  program.command("paste-history").description("Read client-reported paste history; private text is omitted by default")
    .option("--limit <number>", "Page size, 1–100", "25")
    .option("--before <timestamp>", "UTC timestamp from the returned nextCursor")
    .option("--before-id <id>", "Receipt ID from the same nextCursor")
    .option("--include-text", "Include private pasted text", false)
    .action(async values => {
      const history = new HostedPasteHistory(options.client ?? hostedCommandClient(program.opts(), options.env, options.fetch));
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
