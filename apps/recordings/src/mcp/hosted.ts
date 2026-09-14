import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { HostedLibrary } from "../hosted/library.js";
import { HostedPasteHistory } from "../hosted/paste-history.js";
import { hostedFailure } from "../hosted/process-options.js";
import { assertAudioDestination, audioFileInDirectory, prepareAudioUpload, writeAudioDownload } from "../hosted/audio-files.js";
import type { HostedRecordingsClient } from "../hosted/index.js";
import { VERSION } from "../version.js";

export function buildHostedServer(client: HostedRecordingsClient, options: { allowWrites?: boolean; audioDirectory?: string } = {}): McpServer {
  const library = new HostedLibrary(client);
  const server = new McpServer({ name: "recordings-hosted", version: VERSION });
  const annotations = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true };
  const execute = async (operation: () => Promise<object>) => {
    try {
      const result = await operation();
      return { content: [{ type: "text" as const, text: JSON.stringify(result) }], structuredContent: { ...result } };
    } catch (error) {
      const result = hostedFailure(error);
      return { content: [{ type: "text" as const, text: JSON.stringify(result) }], structuredContent: result, isError: true };
    }
  };
  server.registerTool("recordings_hosted_providers", {
    description: "Read server-configured transcription providers, models and optional defaults. Availability is reported by the server; no provider request is made.",
    inputSchema: z.object({}).strict(), annotations,
  }, () => execute(() => client.providers()));
  server.registerTool("recordings_hosted_list", {
    description: "Read one hosted Library page. Private transcripts require includeText. A cursor permits another request, without an inferred total.",
    inputSchema: { limit: z.number().int().min(1).max(100).optional(), before: z.string().optional(),
      beforeId: z.string().optional(), includeText: z.boolean().optional() }, annotations,
  }, options => execute(() => library.list(options)));
  server.registerTool("recordings_hosted_get", {
    description: "Read one hosted recording. Private transcript text is omitted unless includeText is true.",
    inputSchema: { id: z.string(), includeText: z.boolean().optional() }, annotations,
  }, ({ id, includeText }) => execute(() => library.get(id, { includeText })));
  server.registerTool("recordings_hosted_export", {
    description: "Explicitly export one private transcript as UTF-8 plain text. Returns its text and a safe .txt filename; does not write a local file or change the recording.",
    inputSchema: z.object({ id: z.string() }).strict(), annotations,
  }, ({ id }, extra) => execute(() => library.export(id, { signal: extra.signal })));
  server.registerTool("recordings_hosted_audio_metadata", {
    description: "Read hosted audio availability and canonical format metadata. No audio bytes or local paths are returned.",
    inputSchema: { id: z.string() }, annotations,
  }, ({ id }, extra) => execute(() => library.getAudioMetadata(id, { signal: extra.signal })));
  if (options.allowWrites === true && options.audioDirectory !== undefined) {
    const audioDirectory = options.audioDirectory;
    server.registerTool("recordings_hosted_audio_upload", {
      description: "Upload one canonical WAV from a configured audio directory. Requires retainAudio=true and startup --allow-writes.",
      inputSchema: z.object({ id: z.string(), fileName: z.string(), retainAudio: z.literal(true) }).strict(),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    }, ({ id, fileName, retainAudio }, extra) => execute(async () => {
      const path = audioFileInDirectory(audioDirectory, fileName);
      const upload = await prepareAudioUpload(path, extra.signal);
      return library.uploadAudio(id, { ...upload, retainAudio }, { signal: extra.signal });
    }));
    server.registerTool("recordings_hosted_audio_download", {
      description: "Download one complete hosted WAV into a new file in the configured audio directory. Existing files are refused.",
      inputSchema: z.object({ id: z.string(), fileName: z.string() }).strict(),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    }, ({ id, fileName }, extra) => execute(async () => {
      const path = audioFileInDirectory(audioDirectory, fileName);
      await assertAudioDestination(path);
      const response = await library.downloadAudio(id, { signal: extra.signal });
      const receipt = await writeAudioDownload(path, response, extra.signal);
      return { fileName, byteLength: receipt.byteLength, sha256: receipt.sha256, status: receipt.status };
    }));
  }
  if (options.allowWrites === true) {
    server.registerTool("recordings_hosted_save", {
      description: "Save one hosted recording. Returns metadata without private transcript text and makes one request without automatic retry.",
      inputSchema: z.object({ id: z.string(), sessionId: z.string().optional(), title: z.string(), transcript: z.string().max(256_000),
        durationMs: z.number().finite().min(0).max(1_800_000) }).strict(),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    }, (value, extra) => execute(() => library.save(value, { signal: extra.signal })));
    server.registerTool("recordings_hosted_rename", {
      description: "Rename one hosted recording. Returns metadata without private transcript text. The title is trimmed and must contain 1–200 characters.",
      inputSchema: z.object({ id: z.string(), title: z.string() }).strict(),
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true },
    }, ({ id, title }, extra) => execute(() => library.rename(id, title, { signal: extra.signal })));
    server.registerTool("recordings_hosted_delete", {
      description: "Permanently delete one hosted recording. A pending result means durable deletion was accepted but audio cleanup is unfinished. Makes one request without automatic retry.",
      inputSchema: z.object({ id: z.string() }).strict(),
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: true },
    }, ({ id }, extra) => execute(() => library.delete(id, { signal: extra.signal })));
  }
  const history = new HostedPasteHistory(client);
  if (options.allowWrites === true) {
    server.registerTool("recordings_hosted_paste_save", {
      description: "Save one client-reported paste receipt. Private text is accepted for the explicit write but omitted from the returned receipt.",
      inputSchema: z.object({ id: z.string(), recordingId: z.string().nullable().optional(), text: z.string().max(256_000),
        destinationAppId: z.string().min(1).max(255).optional(), destinationAppName: z.string().min(1).max(200).optional(),
        status: z.enum(["attempted", "confirmed", "failed"]), occurredAt: z.string().optional() }).strict(),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    }, (value, extra) => execute(() => history.save(value, { signal: extra.signal })));
  }
  server.registerTool("recordings_hosted_paste_history", {
    description: "Read one hosted paste-history page with destination and client-reported delivery evidence. Private pasted text requires includeText. A confirmed report does not mean the server observed delivery.",
    inputSchema: { limit: z.number().int().min(1).max(100).optional(), before: z.string().optional(),
      beforeId: z.string().optional(), includeText: z.boolean().optional() }, annotations,
  }, options => execute(() => history.list(options)));
  return server;
}
