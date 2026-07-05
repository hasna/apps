#!/usr/bin/env bun
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { getCurrentMachine, listMachines } from "../db/machines.js";
import { createSource, listSources, getSource, deleteSource } from "../db/sources.js";
import { listFiles, getFile, getFileByPath, annotateFile } from "../db/files.js";
import { searchFiles } from "../db/search.js";
import { tagFile, untagFile, listTags, deleteTag } from "../db/tags.js";
import { createCollection, updateCollection, listCollections, getCollection, deleteCollection, addToCollection, removeFromCollection, autoPopulateCollection } from "../db/collections.js";
import { createProject, updateProject, listProjects, getProject, deleteProject, addToProject, removeFromProject } from "../db/projects.js";
import { indexLocalSource } from "../lib/indexer.js";
import { listGoogleDriveItems, listGoogleDriveProfiles, preflightGoogleDriveSource, syncGoogleDriveSource } from "../lib/google-drive.js";
import { indexS3Source, downloadFromS3, uploadToS3, getPresignedUrl } from "../lib/s3.js";
import { downloadResolvedFileObject, resolveFileObject, resolvedFileObjectSummary } from "../lib/file-object.js";
import { extractTextFromFile } from "../lib/extraction.js";
import { extractTextSnapshotFromFile } from "../lib/extraction-snapshot.js";
import { doctorKnowledgeSources } from "../lib/knowledge-doctor.js";
import { exportKnowledgeSourceManifest } from "../lib/knowledge-manifest.js";
import { resolveKnowledgeSourceRef } from "../lib/knowledge-resolver.js";
import { buildFilesContextPack, buildFilesSearchPack } from "../lib/context-pack.js";
import { acknowledgeKnowledgeSourceOutbox, pollKnowledgeSourceOutbox } from "../db/knowledge-outbox.js";
import { parseOpenFilesSourceRef } from "../lib/source-ref.js";
import { registerEvidenceTools } from "./evidence-tools.js";
import { registerOrganizationTools } from "./organization-tools.js";
import { registerStorageTools } from "./storage-tools.js";
import { registerAgent, getAgent, listAgents as listDbAgents, updateAgentHeartbeat, setAgentFocus } from "../db/agents.js";
import { logActivity, getFileHistory, getAgentActivity, getSessionActivity } from "../db/activity.js";
import { basename, dirname, join, resolve } from "path";
import { existsSync, mkdirSync, writeFileSync } from "fs";
import { homedir } from "os";
import { createRequire } from "module";
import { buildOpenFilesFileRef } from "../lib/source-ref.js";
import type { FilesContextPack, GoogleDriveConfig, KnowledgeSourceManifestFormat, KnowledgeSourceResolveMode, S3Config } from "../types/index.js";

const require = createRequire(import.meta.url);
const pkg = require("../../package.json") as { version: string };

type McpCapability = "mutations" | "destructive" | "imports" | "signed_urls" | "downloads" | "indexing";

const MCP_TOOL_CAPABILITIES: Record<string, McpCapability[]> = {
  add_source: ["mutations"],
  add_google_drive_source: ["mutations"],
  sync_google_drive: ["imports"],
  remove_source: ["destructive"],
  index_source: ["indexing"],
  download_file: ["downloads"],
  upload_file: ["mutations"],
  create_evidence_upload_intent: ["mutations", "signed_urls"],
  upload_evidence_file: ["imports"],
  complete_evidence_upload: ["mutations"],
  link_evidence_asset: ["mutations"],
  sign_evidence_download: ["signed_urls", "downloads"],
  verify_evidence_asset: ["indexing"],
  files_storage_push: ["mutations"],
  files_storage_pull: ["mutations"],
  files_storage_sync: ["mutations"],
  tag_file: ["mutations"],
  untag_file: ["mutations"],
  delete_tag: ["mutations"],
  create_collection: ["mutations"],
  update_collection: ["mutations"],
  auto_populate_collection: ["mutations"],
  add_to_collection: ["mutations"],
  remove_from_collection: ["mutations"],
  delete_collection: ["mutations"],
  create_project: ["mutations"],
  update_project: ["mutations"],
  add_to_project: ["mutations"],
  remove_from_project: ["mutations"],
  delete_project: ["mutations"],
  get_file_url: ["signed_urls"],
  ack_knowledge_outbox: ["mutations"],
  bulk_tag: ["mutations"],
  move_file: ["mutations"],
  copy_file: ["mutations"],
  rename_file: ["mutations"],
  delete_file: ["mutations"],
  restore_file: ["mutations"],
  annotate_file: ["mutations"],
  normalize_source: ["mutations"],
  import_from_url: ["imports"],
  import_from_local: ["imports"],
  bulk_import: ["imports"],
  resolve_conflict: ["mutations"],
  purge_deleted: ["destructive"],
  get_or_create_collection: ["mutations"],
  get_or_create_project: ["mutations"],
  watch_source: ["indexing"],
  unwatch_source: ["indexing"],
};

const DEFAULT_MCP_READ_BYTES = 100 * 1024;
const MAX_MCP_READ_BYTES = 10 * 1024 * 1024;
const DEFAULT_MCP_IMPORT_BYTES = 100 * 1024 * 1024;
const MAX_MCP_IMPORT_BYTES = 2 * 1024 * 1024 * 1024;

function mcpToolDenied(toolName: string, capabilities: McpCapability[]) {
  const envNames = capabilities.map((capability) => capabilityEnvName(capability));
  return {
    content: [{
      type: "text" as const,
      text: [
        `MCP tool '${toolName}' requires explicit capability: ${capabilities.join(", ")}.`,
        `Start files-mcp with ${envNames.join(" and ")} set to 1, or OPEN_FILES_MCP_ALLOW_ALL=1.`,
      ].join(" "),
    }],
    isError: true,
  };
}

function requireMcpToolCapabilities(toolName: string) {
  const capabilities = MCP_TOOL_CAPABILITIES[toolName] ?? [];
  const missing = capabilities.filter((capability) => !mcpCapabilityEnabled(capability));
  return missing.length ? mcpToolDenied(toolName, missing) : null;
}

function requireMcpCapability(toolName: string, capability: McpCapability) {
  return mcpCapabilityEnabled(capability) ? null : mcpToolDenied(toolName, [capability]);
}

function mcpCapabilityEnabled(capability: McpCapability): boolean {
  return truthyEnv(process.env.OPEN_FILES_MCP_ALLOW_ALL)
    || truthyEnv(process.env.OPEN_FILES_ALLOW_ALL)
    || truthyEnv(process.env[`OPEN_FILES_ALLOW_${capability.toUpperCase()}`])
    || truthyEnv(process.env[capabilityEnvName(capability)]);
}

function capabilityEnvName(capability: McpCapability): string {
  return `OPEN_FILES_MCP_ALLOW_${capability.toUpperCase()}`;
}

function truthyEnv(value: string | undefined): boolean {
  return value === "1" || value === "true" || value === "yes" || value === "on";
}

function normalizeMcpReadLimit(value: number | undefined): number {
  if (!Number.isFinite(value ?? DEFAULT_MCP_READ_BYTES)) return DEFAULT_MCP_READ_BYTES;
  const normalized = Math.floor(value ?? DEFAULT_MCP_READ_BYTES);
  if (normalized <= 0) return DEFAULT_MCP_READ_BYTES;
  return Math.min(normalized, MAX_MCP_READ_BYTES);
}

function normalizeMcpImportLimit(): number {
  const parsed = Number(process.env.OPEN_FILES_MCP_IMPORT_MAX_BYTES);
  if (!Number.isFinite(parsed)) return DEFAULT_MCP_IMPORT_BYTES;
  if (parsed <= 0) return DEFAULT_MCP_IMPORT_BYTES;
  return Math.min(Math.floor(parsed), MAX_MCP_IMPORT_BYTES);
}

function compileMcpRedactions(patterns: string[] | undefined): RegExp[] | undefined {
  if (!patterns?.length) return undefined;
  return patterns.map((pattern) => {
    try {
      return new RegExp(pattern, "g");
    } catch (error) {
      throw new Error(`Invalid redact pattern "${pattern}": ${error instanceof Error ? error.message : String(error)}`);
    }
  });
}

function normalizeManagedRelativePath(value: string | undefined, fallback: string): string {
  const raw = (value && value.trim().length ? value : fallback).trim().replace(/\\/g, "/");
  if (!raw || raw.includes("\0") || raw.startsWith("/") || /^[A-Za-z]:\//.test(raw)) {
    throw new Error("Destination path must be a relative managed path.");
  }
  const parts = raw.split("/");
  if (parts.some((part) => !part || part === "." || part === "..")) {
    throw new Error("Destination path must not contain empty, '.', or '..' segments.");
  }
  return parts.join("/");
}

function safeTempFileName(fileName: string): string {
  return basename(fileName).replace(/[^A-Za-z0-9._-]/g, "_") || "downloaded-file";
}

async function readResponseBodyWithLimit(resp: Response, maxBytes: number): Promise<Buffer> {
  const contentLength = Number(resp.headers.get("content-length") ?? "");
  if (Number.isFinite(contentLength) && contentLength > maxBytes) {
    throw new Error(`Remote file is ${contentLength} bytes; max import size is ${maxBytes} bytes.`);
  }
  if (!resp.body) return Buffer.from(await resp.arrayBuffer()).subarray(0, maxBytes);

  const reader = resp.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      total += value.byteLength;
      if (total > maxBytes) {
        throw new Error(`Remote file exceeds max import size of ${maxBytes} bytes.`);
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  return Buffer.concat(chunks);
}

function mcpError(message: string) {
  return { content: [{ type: "text" as const, text: message }], isError: true };
}

function mcpContextPackResult(
  toolName: string,
  pack: FilesContextPack,
  outputLocalPath?: string,
  dryRun?: boolean,
) {
  if (!outputLocalPath) return { content: [{ type: "text" as const, text: JSON.stringify(pack) }] };

  if (!dryRun) {
    const denied = requireMcpCapability(toolName, "mutations");
    if (denied) return denied;
  }

  const body = `${JSON.stringify(pack, null, 2)}\n`;
  const outPath = resolve(outputLocalPath);
  if (!dryRun) {
    mkdirSync(dirname(outPath), { recursive: true });
    writeFileSync(outPath, body);
  }
  return {
    content: [{
      type: "text" as const,
      text: JSON.stringify({
        pack_id: pack.pack_id,
        dry_run: Boolean(dryRun),
        artifact: {
          provider: "local",
          path: outPath,
          bytes: Buffer.byteLength(body),
          format: "json",
        },
        counts: pack.counts,
        citation_count: pack.citations.length,
        attachment_ref_count: pack.attachment_refs.length,
      }),
    }],
  };
}

export function buildServer(): McpServer {
  const server = new McpServer({
    name: "files",
    version: pkg.version,
  });

type ToolHandler = (params: any) => unknown | Promise<unknown>;

function registerTool(
  name: string,
  description: string,
  inputSchema: Record<string, z.ZodTypeAny>,
  handler: ToolHandler,
): void {
  (server.tool as any)(name, description, inputSchema, async (params: any) => {
    const denied = requireMcpToolCapabilities(name);
    if (denied) return denied;
    return handler(params);
  });
}

registerEvidenceTools(registerTool);
registerOrganizationTools(registerTool);
registerStorageTools(registerTool);

// ─── Sources ──────────────────────────────────────────────────────────────────

registerTool("list_sources", "List all configured file sources", {
  machine_id: z.string().optional().describe("Filter by machine ID"),
}, async ({ machine_id }) => {
  const sources = listSources(machine_id);
  return { content: [{ type: "text", text: JSON.stringify(sources, null, 2) }] };
});

registerTool("add_source", "Add a local folder or S3 bucket as an indexed source", {
  type: z.enum(["local", "s3"]).describe("Source type"),
  path: z.string().optional().describe("Local folder path (required for local)"),
  bucket: z.string().optional().describe("S3 bucket name (required for s3)"),
  prefix: z.string().optional().describe("S3 key prefix"),
  region: z.string().optional().describe("AWS region"),
  name: z.string().optional().describe("Human-readable source name"),
  config: z.object({
    profile: z.string().optional(),
    endpoint: z.string().optional(),
    forcePathStyle: z.boolean().optional(),
  }).optional().describe("S3 named profile/endpoint settings only. Static credentials are rejected; use env/default chain or an AWS profile."),
}, async ({ type, path, bucket, prefix, region, name, config }) => {
  const machine = getCurrentMachine();
  const source = createSource({
    type,
    path,
    bucket,
    prefix,
    region,
    name: name ?? (type === "s3" ? bucket! : path!),
    config: (config as S3Config) ?? {},
    machine_id: machine.id,
  });
  return { content: [{ type: "text", text: JSON.stringify(source, null, 2) }] };
});

registerTool("list_google_drive_profiles", "List Google Drive profiles available through connectors auth", {}, async () => {
  return { content: [{ type: "text", text: JSON.stringify(await listGoogleDriveProfiles(), null, 2) }] };
});

registerTool("add_google_drive_source", "Add a Google Drive source that syncs into the default S3 source or a configured local/S3 destination", {
  profile: z.string().describe("Google Drive connector profile name"),
  destination_source_id: z.string().optional().describe("Destination S3 or local source ID. Omit to use the configured/default S3 source."),
  name: z.string().optional(),
  include_my_drive: z.boolean().optional().default(true),
  include_all_shared_drives: z.boolean().optional().default(true),
  shared_drive_ids: z.array(z.string()).optional(),
  root_folder_ids: z.array(z.string()).optional(),
  path_mode: z.enum(["path_based", "id_based"]).optional().default("path_based"),
  delete_behavior: z.enum(["ignore", "mark_deleted"]).optional().default("ignore"),
}, async (params) => {
  if (params.destination_source_id) {
    const destination = getSource(params.destination_source_id);
    if (!destination || (destination.type !== "s3" && destination.type !== "local")) {
      return { content: [{ type: "text" as const, text: "Destination source must be an S3 or local source" }], isError: true };
    }
  }

  const machine = getCurrentMachine();
  const config: GoogleDriveConfig = {
    profile: params.profile,
    include_my_drive: params.include_my_drive,
    include_all_shared_drives: params.include_all_shared_drives,
    shared_drive_ids: params.shared_drive_ids?.length ? params.shared_drive_ids : undefined,
    root_folder_ids: params.root_folder_ids?.length ? params.root_folder_ids : undefined,
    destination_source_id: params.destination_source_id,
    path_mode: params.path_mode,
    delete_behavior: params.delete_behavior,
  };
  const source = createSource({
    name: params.name ?? `Google Drive (${params.profile})`,
    type: "google_drive",
    config,
    machine_id: machine.id,
  });
  return { content: [{ type: "text", text: JSON.stringify(source, null, 2) }] };
});

registerTool("list_google_drive_items", "List Google Drive items visible to a Google Drive source", {
  source_id: z.string().describe("Google Drive source ID"),
}, async ({ source_id }) => {
  const source = getSource(source_id);
  if (!source || source.type !== "google_drive") {
    return { content: [{ type: "text" as const, text: "Source must be a Google Drive source" }], isError: true };
  }
  const items = await listGoogleDriveItems(source);
  return { content: [{ type: "text", text: JSON.stringify(items, null, 2) }] };
});

registerTool("preflight_google_drive_sync", "Check Google Drive auth, destination, and visible item scope without uploading", {
  source_id: z.string().describe("Google Drive source ID"),
}, async ({ source_id }) => {
  const source = getSource(source_id);
  if (!source || source.type !== "google_drive") {
    return { content: [{ type: "text" as const, text: "Source must be a Google Drive source" }], isError: true };
  }
  const result = await preflightGoogleDriveSource(source);
  return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
});

registerTool("sync_google_drive", "Sync one Google Drive source, or all enabled Google Drive sources when source_id is omitted", {
  source_id: z.string().optional().describe("Google Drive source ID"),
  agent_id: z.string().optional().describe("Agent ID for activity tracking"),
}, async ({ source_id, agent_id }) => {
  const sources = source_id
    ? [getSource(source_id)].filter(Boolean)
    : listSources().filter((source) => source.enabled && source.type === "google_drive");
  const results = [];
  for (const source of sources) {
    if (!source || source.type !== "google_drive") {
      return { content: [{ type: "text" as const, text: "Source must be a Google Drive source" }], isError: true };
    }
    const stats = await syncGoogleDriveSource(source);
    results.push({ name: source.name, ...stats });
    if (agent_id) logActivity({ agent_id, action: "import", source_id: source.id, metadata: { stats } });
  }
  return { content: [{ type: "text", text: JSON.stringify(results, null, 2) }] };
});

registerTool("remove_source", "Remove a source and all its indexed file records", {
  id: z.string().describe("Source ID"),
}, async ({ id }) => {
  const ok = deleteSource(id);
  return { content: [{ type: "text", text: ok ? `Source ${id} removed` : `Source not found: ${id}` }] };
});

registerTool("index_source", "Re-index a source (or all sources on this machine)", {
  source_id: z.string().optional().describe("Source ID — omit to index all enabled sources"),
  agent_id: z.string().optional().describe("Agent ID for activity tracking"),
}, async ({ source_id, agent_id }) => {
  const machine = getCurrentMachine();
  const toIndex = source_id
    ? [getSource(source_id)].filter(Boolean)
    : listSources(machine.id).filter((s) => s.enabled);

  const results = [];
  for (const source of toIndex) {
    if (!source) continue;
    try {
      const stats = source.type === "s3"
        ? await indexS3Source(source, machine.id)
        : source.type === "google_drive"
          ? await syncGoogleDriveSource(source)
          : await indexLocalSource(source, machine.id);
      results.push({ name: source.name, ...stats });
      if (agent_id) logActivity({ agent_id, action: "index", source_id: source.id, metadata: { stats } });
    } catch (e) {
      results.push({ source_id: source.id, name: source.name, error: (e as Error).message });
    }
  }
  return { content: [{ type: "text", text: JSON.stringify(results, null, 2) }] };
});

// ─── Files ────────────────────────────────────────────────────────────────────

registerTool("list_files", "List indexed files with optional filters. If agent_id is set and agent has a focused project, auto-applies project filter.", {
  source_id: z.string().optional(),
  machine_id: z.string().optional(),
  tag: z.string().optional(),
  collection_id: z.string().optional(),
  project_id: z.string().optional(),
  ext: z.string().optional().describe("File extension filter (e.g. .pdf or pdf)"),
  after: z.string().optional().describe("Modified after this date (ISO 8601, e.g. 2024-01-01)"),
  before: z.string().optional().describe("Modified before this date (ISO 8601)"),
  min_size: z.number().optional().describe("Minimum file size in bytes"),
  max_size: z.number().optional().describe("Maximum file size in bytes"),
  sort: z.enum(["name", "size", "date"]).optional().default("date"),
  sort_dir: z.enum(["asc", "desc"]).optional().default("desc"),
  limit: z.number().optional().default(50),
  offset: z.number().optional().default(0),
  sync_status: z.enum(["local_only", "synced", "conflict"]).optional().describe("Filter by sync status"),
  agent_id: z.string().optional().describe("Agent ID — auto-applies focused project filter if set"),
}, async (opts) => {
  // Workspace scoping: auto-apply agent's focused project
  if (opts.agent_id && !opts.project_id) {
    const agent = getAgent(opts.agent_id);
    if (agent?.project_id) opts.project_id = agent.project_id;
  }
  const files = listFiles(opts);
  return { content: [{ type: "text", text: JSON.stringify(files, null, 2) }] };
});

registerTool("search_files", "Full-text search across file names, paths, and tags", {
  query: z.string().describe("Search query"),
  source_id: z.string().optional(),
  machine_id: z.string().optional(),
  tag: z.string().optional(),
  ext: z.string().optional(),
  limit: z.number().optional().default(20),
  offset: z.number().optional().default(0),
  agent_id: z.string().optional().describe("Agent ID for activity tracking"),
}, async ({ query, source_id, machine_id, tag, ext, limit, offset, agent_id }) => {
  const results = searchFiles(query, { source_id, machine_id, tag, ext, limit, offset });
  if (agent_id) {
    logActivity({ agent_id, action: "search", metadata: { query, results_count: results.length } });
  }
  return { content: [{ type: "text", text: JSON.stringify(results, null, 2) }] };
});

registerTool("build_context_pack", "Build a bounded, cited context pack for explicit file IDs or open-files refs", {
  file_ids: z.array(z.string()).optional().describe("File IDs to include"),
  source_refs: z.array(z.string()).optional().describe("open-files://file or open-files://source/.../path refs to include"),
  max_files: z.number().int().positive().optional(),
  max_excerpts: z.number().int().positive().optional(),
  max_excerpt_chars: z.number().int().positive().optional(),
  max_total_chars: z.number().int().positive().optional(),
  max_bytes_per_file: z.number().int().positive().optional(),
  redact_patterns: z.array(z.string()).optional().describe("Additional regex redaction patterns"),
  output_local_path: z.string().optional().describe("Write full bounded pack JSON to this local path and return a compact pointer"),
  dry_run: z.boolean().optional().default(false).describe("With output_local_path, preview the pointer without writing"),
}, async (params) => {
  try {
    const pack = await buildFilesContextPack({
      file_ids: params.file_ids,
      source_refs: params.source_refs,
      max_files: params.max_files,
      max_excerpts: params.max_excerpts,
      max_excerpt_chars: params.max_excerpt_chars,
      max_total_chars: params.max_total_chars,
      max_bytes_per_file: params.max_bytes_per_file,
      redact_patterns: compileMcpRedactions(params.redact_patterns),
    });
    return mcpContextPackResult("build_context_pack", pack, params.output_local_path, params.dry_run);
  } catch (error) {
    return { content: [{ type: "text" as const, text: error instanceof Error ? error.message : String(error) }], isError: true };
  }
});

registerTool("search_context_pack", "Search files and return a bounded, cited context pack", {
  query: z.string(),
  source_id: z.string().optional(),
  machine_id: z.string().optional(),
  tag: z.string().optional(),
  ext: z.string().optional(),
  search_scope: z.enum(["all", "metadata", "content"]).optional().default("all"),
  offset: z.number().int().nonnegative().optional(),
  max_files: z.number().int().positive().optional(),
  max_excerpts: z.number().int().positive().optional(),
  max_excerpt_chars: z.number().int().positive().optional(),
  max_total_chars: z.number().int().positive().optional(),
  max_bytes_per_file: z.number().int().positive().optional(),
  redact_patterns: z.array(z.string()).optional().describe("Additional regex redaction patterns"),
  output_local_path: z.string().optional().describe("Write full bounded pack JSON to this local path and return a compact pointer"),
  dry_run: z.boolean().optional().default(false).describe("With output_local_path, preview the pointer without writing"),
}, async (params) => {
  try {
    const pack = await buildFilesSearchPack({
      query: params.query,
      source_id: params.source_id,
      machine_id: params.machine_id,
      tag: params.tag,
      ext: params.ext,
      search_scope: params.search_scope,
      offset: params.offset,
      max_files: params.max_files,
      max_excerpts: params.max_excerpts,
      max_excerpt_chars: params.max_excerpt_chars,
      max_total_chars: params.max_total_chars,
      max_bytes_per_file: params.max_bytes_per_file,
      redact_patterns: compileMcpRedactions(params.redact_patterns),
    });
    return mcpContextPackResult("search_context_pack", pack, params.output_local_path, params.dry_run);
  } catch (error) {
    return { content: [{ type: "text" as const, text: error instanceof Error ? error.message : String(error) }], isError: true };
  }
});

registerTool("get_file", "Get full details for a file by ID", {
  id: z.string().describe("File ID"),
}, async ({ id }) => {
  const file = getFile(id);
  if (!file) return { content: [{ type: "text", text: `File not found: ${id}` }], isError: true };
  return { content: [{ type: "text", text: JSON.stringify(file, null, 2) }] };
});

registerTool("download_file", "Download a file from S3 to a local path", {
  id: z.string().describe("File ID"),
  dest: z.string().optional().describe("Destination path (defaults to ~/Downloads/<filename>)"),
  agent_id: z.string().optional().describe("Agent ID for activity tracking"),
}, async ({ id, dest, agent_id }) => {
  let resolved;
  try {
    resolved = resolveFileObject(id);
  } catch (error) {
    return { content: [{ type: "text", text: error instanceof Error ? error.message : String(error) }], isError: true };
  }

  if (resolved.storageSource.type === "local") {
    const fullPath = join(resolved.storageSource.path!, resolved.objectKey);
    if (agent_id) logActivity({ agent_id, action: "read", file_id: id, metadata: { path: fullPath } });
    return { content: [{ type: "text", text: `Local file: ${fullPath}` }] };
  }

  const outPath = dest ?? join(homedir(), "Downloads", resolved.file.name);
  await downloadResolvedFileObject(resolved, outPath);
  if (agent_id) logActivity({ agent_id, action: "download", file_id: id, metadata: { dest: outPath } });
  return { content: [{ type: "text", text: `Downloaded to: ${outPath}` }] };
});

registerTool("upload_file", "Upload a local file to an S3 source", {
  local_path: z.string().describe("Path to local file"),
  source_id: z.string().describe("Target S3 source ID"),
  s3_key: z.string().optional().describe("Custom S3 key (defaults to prefix/filename)"),
  agent_id: z.string().optional().describe("Agent ID for activity tracking"),
}, async ({ local_path, source_id, s3_key, agent_id }) => {
  const source = getSource(source_id);
  if (!source) return { content: [{ type: "text", text: `Source not found: ${source_id}` }], isError: true };
  if (source.type !== "s3") return { content: [{ type: "text", text: "upload_file only works with S3 sources" }], isError: true };
  if (!existsSync(local_path)) return { content: [{ type: "text", text: `File not found: ${local_path}` }], isError: true };

  const machine = getCurrentMachine();
  const key = await uploadToS3(source, local_path, s3_key);
  await indexS3Source(source, machine.id);
  if (agent_id) logActivity({ agent_id, action: "upload", source_id, metadata: { local_path, s3_key: key } });
  return { content: [{ type: "text", text: `Uploaded to s3://${source.bucket}/${key}` }] };
});

// ─── Tags ─────────────────────────────────────────────────────────────────────

registerTool("list_tags", "List all tags", {}, async () => {
  return { content: [{ type: "text", text: JSON.stringify(listTags(), null, 2) }] };
});

registerTool("tag_file", "Add one or more tags to a file", {
  file_id: z.string(),
  tags: z.array(z.string()).describe("Tag names to add"),
  agent_id: z.string().optional().describe("Agent ID for activity tracking"),
}, async ({ file_id, tags, agent_id }) => {
  for (const tag of tags) tagFile(file_id, tag);
  if (agent_id) logActivity({ agent_id, action: "tag", file_id, metadata: { tags } });
  return { content: [{ type: "text", text: `Tagged file ${file_id} with: ${tags.join(", ")}` }] };
});

registerTool("untag_file", "Remove tags from a file", {
  file_id: z.string(),
  tags: z.array(z.string()),
  agent_id: z.string().optional().describe("Agent ID for activity tracking"),
}, async ({ file_id, tags, agent_id }) => {
  for (const tag of tags) untagFile(file_id, tag);
  if (agent_id) logActivity({ agent_id, action: "untag", file_id, metadata: { tags } });
  return { content: [{ type: "text", text: "Tags removed" }] };
});

registerTool("delete_tag", "Delete a tag entirely (removes from all files)", {
  id: z.string().describe("Tag ID"),
}, async ({ id }) => {
  const ok = deleteTag(id);
  return { content: [{ type: "text", text: ok ? `Tag ${id} deleted` : `Tag not found: ${id}` }] };
});

// ─── Collections ──────────────────────────────────────────────────────────────

registerTool("list_collections", "List all collections", {
  parent_id: z.string().optional().describe("Filter by parent collection ID"),
}, async ({ parent_id }) => {
  return { content: [{ type: "text", text: JSON.stringify(listCollections(parent_id), null, 2) }] };
});

registerTool("create_collection", "Create a new collection (supports nesting and auto-rules)", {
  name: z.string(),
  description: z.string().optional().default(""),
  parent_id: z.string().optional().describe("Parent collection ID for nesting"),
  auto_rules: z.object({
    ext: z.array(z.string()).optional().describe("File extensions to auto-include (e.g. [\".pdf\", \".docx\"])"),
    tags: z.array(z.string()).optional().describe("Tags to auto-include"),
    name_pattern: z.string().optional().describe("Glob-like name pattern (e.g. *quarterly*)"),
    source_id: z.string().optional().describe("Limit to a specific source"),
  }).optional().describe("Smart rules to auto-populate the collection"),
}, async ({ name, description, parent_id, auto_rules }) => {
  const c = createCollection(name, description, { parent_id, auto_rules });
  return { content: [{ type: "text", text: JSON.stringify(c, null, 2) }] };
});

registerTool("update_collection", "Update a collection's name, description, parent, or rules", {
  id: z.string().describe("Collection ID"),
  name: z.string().optional(),
  description: z.string().optional(),
  parent_id: z.string().nullable().optional().describe("New parent ID or null to make top-level"),
  auto_rules: z.object({
    ext: z.array(z.string()).optional(),
    tags: z.array(z.string()).optional(),
    name_pattern: z.string().optional(),
    source_id: z.string().optional(),
  }).optional(),
}, async ({ id, name, description, parent_id, auto_rules }) => {
  const c = updateCollection(id, { name, description, parent_id, auto_rules });
  if (!c) return { content: [{ type: "text", text: `Collection not found: ${id}` }], isError: true };
  return { content: [{ type: "text", text: JSON.stringify(c, null, 2) }] };
});

registerTool("get_collection", "Get collection details with file count and child collections", {
  id: z.string().describe("Collection ID"),
}, async ({ id }) => {
  const c = getCollection(id);
  if (!c) return { content: [{ type: "text", text: `Collection not found: ${id}` }], isError: true };
  return { content: [{ type: "text", text: JSON.stringify(c, null, 2) }] };
});

registerTool("auto_populate_collection", "Run a collection's auto-rules and add all matching files", {
  collection_id: z.string().describe("Collection ID"),
}, async ({ collection_id }) => {
  const added = autoPopulateCollection(collection_id);
  return { content: [{ type: "text", text: `Added ${added} file(s) to collection` }] };
});

registerTool("add_to_collection", "Add a file to a collection", {
  collection_id: z.string(),
  file_id: z.string(),
}, async ({ collection_id, file_id }) => {
  addToCollection(collection_id, file_id);
  return { content: [{ type: "text", text: "Added to collection" }] };
});

registerTool("remove_from_collection", "Remove a file from a collection", {
  collection_id: z.string(),
  file_id: z.string(),
}, async ({ collection_id, file_id }) => {
  removeFromCollection(collection_id, file_id);
  return { content: [{ type: "text", text: "Removed from collection" }] };
});

registerTool("delete_collection", "Delete a collection (does not delete files, only the collection)", {
  id: z.string().describe("Collection ID"),
}, async ({ id }) => {
  const ok = deleteCollection(id);
  return { content: [{ type: "text", text: ok ? `Collection ${id} deleted` : `Collection not found: ${id}` }] };
});

// ─── Projects ─────────────────────────────────────────────────────────────────

registerTool("list_projects", "List all projects", {
  status: z.enum(["active", "archived", "completed"]).optional().describe("Filter by status"),
}, async ({ status }) => {
  return { content: [{ type: "text", text: JSON.stringify(listProjects(status), null, 2) }] };
});

registerTool("create_project", "Create a new project", {
  name: z.string(),
  description: z.string().optional().default(""),
  status: z.enum(["active", "archived", "completed"]).optional().default("active"),
}, async ({ name, description, status }) => {
  const p = createProject(name, description, { status });
  return { content: [{ type: "text", text: JSON.stringify(p, null, 2) }] };
});

registerTool("update_project", "Update a project's name, description, status, or metadata", {
  id: z.string().describe("Project ID"),
  name: z.string().optional(),
  description: z.string().optional(),
  status: z.enum(["active", "archived", "completed"]).optional(),
}, async ({ id, name, description, status }) => {
  const p = updateProject(id, { name, description, status });
  if (!p) return { content: [{ type: "text", text: `Project not found: ${id}` }], isError: true };
  return { content: [{ type: "text", text: JSON.stringify(p, null, 2) }] };
});

registerTool("get_project", "Get project details with file count", {
  id: z.string().describe("Project ID"),
}, async ({ id }) => {
  const p = getProject(id);
  if (!p) return { content: [{ type: "text", text: `Project not found: ${id}` }], isError: true };
  return { content: [{ type: "text", text: JSON.stringify(p, null, 2) }] };
});

registerTool("add_to_project", "Add a file to a project", {
  project_id: z.string(),
  file_id: z.string(),
}, async ({ project_id, file_id }) => {
  addToProject(project_id, file_id);
  return { content: [{ type: "text", text: "Added to project" }] };
});

registerTool("remove_from_project", "Remove a file from a project", {
  project_id: z.string(),
  file_id: z.string(),
}, async ({ project_id, file_id }) => {
  removeFromProject(project_id, file_id);
  return { content: [{ type: "text", text: "Removed from project" }] };
});

registerTool("delete_project", "Delete a project (does not delete files, only the project)", {
  id: z.string().describe("Project ID"),
}, async ({ id }) => {
  const ok = deleteProject(id);
  return { content: [{ type: "text", text: ok ? `Project ${id} deleted` : `Project not found: ${id}` }] };
});

// ─── Machines ─────────────────────────────────────────────────────────────────

registerTool("list_machines", "List all known machines that have indexed files", {}, async () => {
  return { content: [{ type: "text", text: JSON.stringify(listMachines(), null, 2) }] };
});

// ─── get_file_url ─────────────────────────────────────────────────────────────

registerTool("get_file_url", "Get a pre-signed URL for temporary access to an S3 file", {
  id: z.string().describe("File ID"),
  expires_in: z.number().optional().default(3600).describe("URL expiry in seconds (default 1 hour)"),
}, async ({ id, expires_in }) => {
  let resolved;
  try {
    resolved = resolveFileObject(id);
  } catch (error) {
    return { content: [{ type: "text", text: error instanceof Error ? error.message : String(error) }], isError: true };
  }
  if (resolved.storageSource.type !== "s3") return { content: [{ type: "text", text: "get_file_url only works with S3-backed files" }], isError: true };
  const expiresIn = Math.min(Math.max(Math.floor(expires_in ?? 600), 1), 3600);
  const url = await getPresignedUrl(resolved.storageSource, resolved.objectKey, expiresIn);
  return { content: [{ type: "text", text: url }] };
});

registerTool("resolve_file_storage", "Resolve a file to its current object storage location", {
  id: z.string().describe("File ID"),
}, ({ id }) => {
  try {
    return { content: [{ type: "text", text: JSON.stringify(resolvedFileObjectSummary(resolveFileObject(id)), null, 2) }] };
  } catch (error) {
    return { content: [{ type: "text", text: error instanceof Error ? error.message : String(error) }], isError: true };
  }
});

// ─── get_file_content ─────────────────────────────────────────────────────────

registerTool("get_file_content", "Read the content of a text file (local or S3 sources, max 1MB)", {
  id: z.string().describe("File ID"),
  max_bytes: z.number().optional().default(102400).describe("Max bytes to read (default 100KB)"),
  agent_id: z.string().optional().describe("Agent ID for activity tracking"),
}, async ({ id, max_bytes, agent_id }) => {
  try {
    const limit = normalizeMcpReadLimit(max_bytes);
    const resolution = await resolveKnowledgeSourceRef(buildOpenFilesFileRef(id), {
      mode: "content",
      purpose: "agent_context",
      max_bytes: limit,
      agent_id,
    });
    const text = resolution.content.text;
    if ((resolution.status !== "ready" && resolution.status !== "too_large") || text === undefined) {
      return mcpError(resolution.status_reason ?? `File content is not readable as text: ${resolution.status}`);
    }
    const truncated = Boolean(resolution.content.truncated);
    const suffix = truncated
      ? `\n\n[truncated - ${resolution.content.bytes_read ?? Buffer.byteLength(text)} bytes read, max ${limit} bytes]`
      : "";
    return { content: [{ type: "text" as const, text: `${text}${suffix}` }] };
  } catch (error) {
    return { content: [{ type: "text", text: error instanceof Error ? error.message : String(error) }], isError: true };
  }
});

registerTool("extract_file_text", "Return chunk-ready extracted text metadata for knowledge indexing", {
  id: z.string().describe("File ID"),
  max_bytes: z.number().optional().default(1048576).describe("Maximum bytes to read"),
  segment_chars: z.number().optional().default(4000).describe("Maximum characters per segment"),
  redact_patterns: z.array(z.string()).optional().describe("Regex patterns to redact from segment text"),
}, async ({ id, max_bytes, segment_chars, redact_patterns }) => {
  try {
    const result = await extractTextFromFile(id, {
      max_bytes,
      max_segment_chars: segment_chars,
      redact_patterns: (redact_patterns as string[] | undefined)?.map((pattern: string) => new RegExp(pattern, "g")),
    });
    return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
  } catch (error) {
    return { content: [{ type: "text", text: error instanceof Error ? error.message : String(error) }], isError: true };
  }
});

registerTool("extract_file_snapshot", "Return a deterministic extraction snapshot for semantic chunking", {
  id: z.string().describe("File ID"),
  max_bytes: z.number().optional().default(1048576).describe("Maximum bytes to read"),
  segment_chars: z.number().optional().default(4000).describe("Maximum characters per source segment"),
  redact_patterns: z.array(z.string()).optional().describe("Regex patterns to redact from snapshot text"),
}, async ({ id, max_bytes, segment_chars, redact_patterns }) => {
  try {
    const result = await extractTextSnapshotFromFile(id, {
      max_bytes,
      max_segment_chars: segment_chars,
      redact_patterns: (redact_patterns as string[] | undefined)?.map((pattern: string) => new RegExp(pattern, "g")),
    });
    return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
  } catch (error) {
    return { content: [{ type: "text", text: error instanceof Error ? error.message : String(error) }], isError: true };
  }
});

registerTool("export_knowledge_manifest", "Export a read-only open-files source manifest for knowledge indexing", {
  source_id: z.string().optional(),
  collection_id: z.string().optional(),
  project_id: z.string().optional(),
  tag: z.string().optional(),
  status: z.enum(["active", "deleted", "moved", "all"]).optional(),
  include_deleted: z.boolean().optional(),
  delta: z.boolean().optional(),
  since_cursor: z.string().optional(),
  since_sync_version: z.number().optional(),
  cursor: z.string().optional(),
  limit: z.number().optional().default(100),
  format: z.enum(["json", "jsonl"]).optional().default("json"),
  output_local_path: z.string().optional(),
  output_s3_source_id: z.string().optional(),
  output_s3_key: z.string().optional(),
  include_acl_summary: z.boolean().optional(),
  include_evidence_assets: z.boolean().optional(),
}, async (params) => {
  try {
    if (params.output_local_path || params.output_s3_source_id || params.output_s3_key) {
      const denied = requireMcpCapability("export_knowledge_manifest", "mutations");
      if (denied) return denied;
    }
    const output = params.output_local_path
      ? { provider: "local" as const, path: params.output_local_path, format: params.format as KnowledgeSourceManifestFormat }
      : params.output_s3_source_id && params.output_s3_key
        ? { provider: "s3" as const, source_id: params.output_s3_source_id, key: params.output_s3_key, format: params.format as KnowledgeSourceManifestFormat }
        : undefined;
    const manifest = await exportKnowledgeSourceManifest({
      source_id: params.source_id,
      collection_id: params.collection_id,
      project_id: params.project_id,
      tag: params.tag,
      status: params.status,
      include_deleted: params.include_deleted,
      delta: params.delta,
      since_cursor: params.since_cursor,
      since_sync_version: params.since_sync_version,
      cursor: params.cursor,
      limit: params.limit,
      format: params.format as KnowledgeSourceManifestFormat,
      output,
      include_acl_summary: params.include_acl_summary,
      include_evidence_assets: params.include_evidence_assets,
    });
    return { content: [{ type: "text", text: JSON.stringify(manifest, null, 2) }] };
  } catch (error) {
    return { content: [{ type: "text", text: error instanceof Error ? error.message : String(error) }], isError: true };
  }
});

registerTool("resolve_knowledge_source", "Resolve an open-files:// source ref with read-only policy", {
  source_ref: z.string().describe("open-files:// source ref"),
  mode: z.enum(["metadata", "content", "extracted_text", "snapshot", "signed_url"]).optional().default("metadata"),
  purpose: z.string().optional().default("knowledge_index"),
  max_bytes: z.number().optional().default(262144),
  segment_chars: z.number().optional().default(4000),
  allowed_mimes: z.array(z.string()).optional(),
  allow_binary: z.boolean().optional(),
  signed_url_expires_in: z.number().optional().default(600),
  agent_id: z.string().optional(),
  session_id: z.string().optional(),
}, async (params) => {
  try {
    const result = await resolveKnowledgeSourceRef(params.source_ref, {
      mode: params.mode as KnowledgeSourceResolveMode,
      purpose: params.purpose,
      max_bytes: params.max_bytes,
      max_segment_chars: params.segment_chars,
      allowed_mimes: params.allowed_mimes,
      allow_binary: params.allow_binary,
      signed_url_expires_in: params.signed_url_expires_in,
      agent_id: params.agent_id,
      session_id: params.session_id,
    });
    return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
  } catch (error) {
    return { content: [{ type: "text", text: error instanceof Error ? error.message : String(error) }], isError: true };
  }
});

registerTool("doctor_knowledge_sources", "Diagnose open-files source refs for knowledge sync readiness", {
  source_refs: z.array(z.string()).optional(),
  source_id: z.string().optional(),
  collection_id: z.string().optional(),
  project_id: z.string().optional(),
  tag: z.string().optional(),
  status: z.enum(["active", "deleted", "moved", "all"]).optional(),
  limit: z.number().optional().default(100),
  purpose: z.string().optional().default("knowledge_index"),
  require_extracted_text: z.boolean().optional().default(true),
  check_extracted_text: z.boolean().optional().default(false),
  max_bytes: z.number().optional().default(262144),
  segment_chars: z.number().optional().default(4000),
}, async (params) => {
  try {
    const result = await doctorKnowledgeSources({
      source_refs: params.source_refs,
      source_id: params.source_id,
      collection_id: params.collection_id,
      project_id: params.project_id,
      tag: params.tag,
      status: params.status,
      limit: params.limit,
      purpose: params.purpose,
      require_extracted_text: params.require_extracted_text,
      check_extracted_text: params.check_extracted_text,
      max_bytes: params.max_bytes,
      max_segment_chars: params.segment_chars,
    });
    return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
  } catch (error) {
    return { content: [{ type: "text", text: error instanceof Error ? error.message : String(error) }], isError: true };
  }
});

registerTool("resolve_extracted_text", "Resolve extracted text for an open-files:// source ref", {
  source_ref: z.string().describe("open-files:// file or revision ref"),
  purpose: z.string().optional().default("knowledge_index"),
  max_bytes: z.number().optional().default(1048576),
  segment_chars: z.number().optional().default(4000),
}, async ({ source_ref, purpose, max_bytes, segment_chars }) => {
  try {
    parseOpenFilesSourceRef(source_ref);
    const result = await resolveKnowledgeSourceRef(source_ref, {
      mode: "extracted_text",
      purpose,
      max_bytes,
      max_segment_chars: segment_chars,
    });
    return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
  } catch (error) {
    return { content: [{ type: "text", text: error instanceof Error ? error.message : String(error) }], isError: true };
  }
});

registerTool("poll_knowledge_outbox", "Poll open-files source change outbox events for reindexing", {
  consumer_id: z.string().optional(),
  after_cursor: z.number().optional(),
  event_types: z.array(z.enum([
    "source_created", "indexed", "updated", "deleted", "moved", "hash_changed",
    "revision_changed", "extraction_ready", "extraction_failed", "extraction_changed",
    "permission_changed", "acl_revoked", "canonical_key_changed",
    "source_disabled", "source_enabled", "source_updated",
  ])).optional(),
  source_id: z.string().optional(),
  file_id: z.string().optional(),
  limit: z.number().optional().default(100),
}, async (params) => {
  try {
    const result = pollKnowledgeSourceOutbox({
      consumer_id: params.consumer_id,
      after_cursor: params.after_cursor,
      event_types: params.event_types,
      source_id: params.source_id,
      file_id: params.file_id,
      limit: params.limit,
    });
    return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
  } catch (error) {
    return { content: [{ type: "text", text: error instanceof Error ? error.message : String(error) }], isError: true };
  }
});

registerTool("ack_knowledge_outbox", "Acknowledge open-files source change outbox progress for a consumer", {
  consumer_id: z.string(),
  cursor: z.number(),
}, async ({ consumer_id, cursor }) => {
  try {
    const checkpoint = acknowledgeKnowledgeSourceOutbox(consumer_id, cursor);
    return { content: [{ type: "text", text: JSON.stringify(checkpoint, null, 2) }] };
  } catch (error) {
    return { content: [{ type: "text", text: error instanceof Error ? error.message : String(error) }], isError: true };
  }
});

// ─── bulk_tag ─────────────────────────────────────────────────────────────────

registerTool("bulk_tag", "Add tags to multiple files at once (by IDs or search query)", {
  tags: z.array(z.string()).describe("Tag names to add"),
  file_ids: z.array(z.string()).optional().describe("List of file IDs to tag"),
  query: z.string().optional().describe("Search query — tag all matching files"),
  source_id: z.string().optional(),
  ext: z.string().optional(),
  agent_id: z.string().optional().describe("Agent ID for activity tracking"),
}, async ({ tags, file_ids, query, source_id, ext, agent_id }) => {
  let ids: string[] = file_ids ?? [];
  if (query) {
    const results = searchFiles(query, { source_id, ext, limit: 500 });
    ids = [...new Set([...ids, ...results.map((f) => f.id)])];
  }
  for (const id of ids) {
    for (const tag of tags) tagFile(id, tag);
  }
  if (agent_id) logActivity({ agent_id, action: "tag", metadata: { tags, file_count: ids.length, query } });
  return { content: [{ type: "text", text: `Tagged ${ids.length} file(s) with: ${tags.join(", ")}` }] };
});

// ─── describe_file ────────────────────────────────────────────────────────────

registerTool("describe_file", "Get file metadata + first lines of content in one call", {
  id: z.string().describe("File ID"),
  lines: z.number().optional().default(50).describe("Number of lines to preview (default 50)"),
}, async ({ id, lines }) => {
  let resolved;
  try {
    resolved = resolveFileObject(id);
  } catch (error) {
    return { content: [{ type: "text", text: error instanceof Error ? error.message : String(error) }], isError: true };
  }

  let preview = "";
  try {
    const resolution = await resolveKnowledgeSourceRef(buildOpenFilesFileRef(id), {
      mode: "content",
      purpose: "agent_context",
      max_bytes: 32 * 1024,
    });
    if (resolution.content.text !== undefined && (resolution.status === "ready" || resolution.status === "too_large")) {
      preview = resolution.content.text.split("\n").slice(0, lines ?? 50).join("\n");
    } else {
      preview = resolution.status_reason ?? "(binary or unreadable)";
    }
  } catch {
    preview = "(binary or unreadable)";
  }

  const result = {
    ...resolved.file,
    source_name: resolved.source.name,
    storage: (resolvedFileObjectSummary(resolved).storage as Record<string, unknown>),
    preview,
  };
  return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
});

// ─── File Operations ─────────────────────────────────────────────────────────

registerTool("move_file", "Move a file to a different path within the same source", {
  file_id: z.string().describe("File ID"),
  dest_path: z.string().describe("New path within the source"),
  agent_id: z.string().optional().describe("Agent ID for activity tracking"),
}, async ({ file_id, dest_path, agent_id }) => {
  let safeDestPath: string;
  try {
    safeDestPath = normalizeManagedRelativePath(dest_path, dest_path);
  } catch (error) {
    return mcpError(error instanceof Error ? error.message : String(error));
  }
  const file = getFile(file_id);
  if (!file) return { content: [{ type: "text" as const, text: `File not found: ${file_id}` }], isError: true };
  const source = getSource(file.source_id);
  if (!source) return { content: [{ type: "text" as const, text: "Source not found" }], isError: true };

  if (source.type === "local") {
    const { renameSync, mkdirSync } = await import("fs");
    const { join: jp, dirname } = await import("path");
    const oldPath = jp(source.path!, file.path);
    const newPath = jp(source.path!, safeDestPath);
    mkdirSync(dirname(newPath), { recursive: true });
    renameSync(oldPath, newPath);
  }
  // Update DB
  const { getDb: getMoveDb } = await import("../db/database.js");
  getMoveDb().run("UPDATE files SET path=?, status='active', sync_version=sync_version+1 WHERE id=?", [safeDestPath, file_id]);
  if (agent_id) logActivity({ agent_id, action: "move", file_id, metadata: { from: file.path, to: safeDestPath } });
  return { content: [{ type: "text" as const, text: `Moved ${file.path} -> ${safeDestPath}` }] };
});

registerTool("copy_file", "Copy a file to another source (local→S3, S3→local, etc.)", {
  file_id: z.string().describe("File ID to copy"),
  dest_source_id: z.string().describe("Destination source ID"),
  dest_path: z.string().optional().describe("Custom destination path"),
  agent_id: z.string().optional().describe("Agent ID for activity tracking"),
}, async ({ file_id, dest_source_id, dest_path, agent_id }) => {
  const file = getFile(file_id);
  if (!file) return { content: [{ type: "text" as const, text: `File not found: ${file_id}` }], isError: true };
  const srcSource = getSource(file.source_id);
  const dstSource = getSource(dest_source_id);
  if (!srcSource || !dstSource) return { content: [{ type: "text" as const, text: "Source not found" }], isError: true };

  let finalDest: string;
  try {
    finalDest = normalizeManagedRelativePath(dest_path, file.name);
  } catch (error) {
    return mcpError(error instanceof Error ? error.message : String(error));
  }
  const { join: jp } = await import("path");

  if (srcSource.type === "local" && dstSource.type === "local") {
    const { copyFileSync, mkdirSync } = await import("fs");
    const { dirname } = await import("path");
    const src = jp(srcSource.path!, file.path);
    const dst = jp(dstSource.path!, finalDest);
    mkdirSync(dirname(dst), { recursive: true });
    copyFileSync(src, dst);
    const machine = getCurrentMachine();
    await indexLocalSource(dstSource, machine.id);
  } else if (srcSource.type === "local" && dstSource.type === "s3") {
    const src = jp(srcSource.path!, file.path);
    await uploadToS3(dstSource, src, finalDest);
    const machine = getCurrentMachine();
    await indexS3Source(dstSource, machine.id);
  } else if (srcSource.type === "s3" && dstSource.type === "local") {
    const { mkdirSync } = await import("fs");
    const { dirname } = await import("path");
    const dst = jp(dstSource.path!, finalDest);
    mkdirSync(dirname(dst), { recursive: true });
    await downloadFromS3(srcSource, file.path, dst);
    const machine = getCurrentMachine();
    await indexLocalSource(dstSource, machine.id);
  }

  if (agent_id) logActivity({ agent_id, action: "copy", file_id, source_id: dest_source_id, metadata: { dest: finalDest } });
  return { content: [{ type: "text" as const, text: `Copied ${file.name} to ${dstSource.name}/${finalDest}` }] };
});

registerTool("rename_file", "Rename a file and regenerate its canonical name", {
  file_id: z.string().describe("File ID"),
  new_name: z.string().describe("New file name"),
  agent_id: z.string().optional().describe("Agent ID for activity tracking"),
}, async ({ file_id, new_name, agent_id }) => {
  let safeName: string;
  try {
    safeName = normalizeManagedRelativePath(new_name, new_name);
    if (safeName.includes("/")) throw new Error("New file name must not contain path separators.");
  } catch (error) {
    return mcpError(error instanceof Error ? error.message : String(error));
  }
  const file = getFile(file_id);
  if (!file) return { content: [{ type: "text" as const, text: `File not found: ${file_id}` }], isError: true };

  const { generateCanonicalName: genCan } = await import("../lib/normalize.js");
  const { extname: en } = await import("path");
  const canonical = genCan(safeName);
  const ext = en(safeName).toLowerCase();
  const { getDb: getRenameDb } = await import("../db/database.js");
  getRenameDb().run(
    "UPDATE files SET name=?, original_name=?, canonical_name=?, ext=?, sync_version=sync_version+1 WHERE id=?",
    [safeName, safeName, canonical, ext, file_id]
  );

  if (agent_id) logActivity({ agent_id, action: "rename", file_id, metadata: { old_name: file.name, new_name: safeName } });
  return { content: [{ type: "text" as const, text: `Renamed to ${safeName} (canonical: ${canonical})` }] };
});

registerTool("delete_file", "Soft-delete a file (or hard-delete from disk/S3)", {
  file_id: z.string().describe("File ID"),
  hard_delete: z.boolean().optional().default(false).describe("true = remove from disk/S3, false = soft delete (default)"),
  agent_id: z.string().optional().describe("Agent ID for activity tracking"),
}, async ({ file_id, hard_delete, agent_id }) => {
  const file = getFile(file_id);
  if (!file) return { content: [{ type: "text" as const, text: `File not found: ${file_id}` }], isError: true };

  if (hard_delete) {
    const denied = requireMcpCapability("delete_file hard_delete", "destructive");
    if (denied) return denied;
    const source = getSource(file.source_id);
    if (source?.type === "local") {
      const { unlinkSync } = await import("fs");
      const { join: jp } = await import("path");
      try { unlinkSync(jp(source.path!, file.path)); } catch {}
    } else if (source?.type === "s3") {
      const { deleteFromS3: delS3 } = await import("../lib/s3.js");
      await delS3(source, file.path);
    }
  }

  const { getDb: getDelDb } = await import("../db/database.js");
  getDelDb().run("UPDATE files SET status='deleted', sync_version=sync_version+1 WHERE id=?", [file_id]);
  if (agent_id) logActivity({ agent_id, action: "delete", file_id, metadata: { hard_delete } });
  return { content: [{ type: "text" as const, text: `${hard_delete ? "Hard" : "Soft"}-deleted ${file.name}` }] };
});

registerTool("restore_file", "Restore a soft-deleted file", {
  file_id: z.string().describe("File ID"),
  agent_id: z.string().optional().describe("Agent ID for activity tracking"),
}, async ({ file_id, agent_id }) => {
  const { getDb: getRestoreDb } = await import("../db/database.js");
  const result = getRestoreDb().run(
    "UPDATE files SET status='active', sync_version=sync_version+1 WHERE id=? AND status='deleted'", [file_id]
  );
  if (result.changes === 0) return { content: [{ type: "text" as const, text: `File not found or not deleted: ${file_id}` }], isError: true };
  if (agent_id) logActivity({ agent_id, action: "restore", file_id });
  return { content: [{ type: "text" as const, text: `Restored file ${file_id}` }] };
});

// ─── find_duplicates ──────────────────────────────────────────────────────────

registerTool("find_duplicates", "Find files with the same BLAKE3 hash (duplicates)", {
  source_id: z.string().optional().describe("Limit to a specific source"),
}, async ({ source_id }) => {
  const { getDb } = await import("../db/database.js");
  const db = getDb();
  const sourceFilter = source_id ? "AND source_id = ?" : "";
  const params = source_id ? [source_id] as import("bun:sqlite").SQLQueryBindings[] : [];
  const groups = db.query<{ hash: string; cnt: number; paths: string }, import("bun:sqlite").SQLQueryBindings[]>(`
    SELECT hash, COUNT(*) as cnt, GROUP_CONCAT(path, ' | ') as paths
    FROM files WHERE status='active' AND hash IS NOT NULL ${sourceFilter}
    GROUP BY hash HAVING cnt > 1
    ORDER BY cnt DESC
  `).all(...params);
  return { content: [{ type: "text", text: JSON.stringify(groups, null, 2) }] };
});

// ─── get_stats ────────────────────────────────────────────────────────────────

registerTool("get_stats", "Get aggregate statistics about all indexed files", {}, async () => {
  const { getDb: getStatsDb } = await import("../db/database.js");
  const db = getStatsDb();

  const totals = db.query<{ total_files: number; total_size: number }, []>(
    "SELECT COUNT(*) as total_files, COALESCE(SUM(size), 0) as total_size FROM files WHERE status='active'"
  ).get()!;

  const by_ext = db.query<{ ext: string; count: number }, []>(
    "SELECT ext, COUNT(*) as count FROM files WHERE status='active' GROUP BY ext ORDER BY count DESC LIMIT 20"
  ).all();

  const by_source = db.query<{ source_id: string; name: string; count: number }, []>(
    "SELECT f.source_id, s.name, COUNT(*) as count FROM files f JOIN sources s ON s.id=f.source_id WHERE f.status='active' GROUP BY f.source_id ORDER BY count DESC"
  ).all();

  const by_machine = db.query<{ machine_id: string; name: string; count: number }, []>(
    "SELECT f.machine_id, m.name, COUNT(*) as count FROM files f JOIN machines m ON m.id=f.machine_id WHERE f.status='active' GROUP BY f.machine_id ORDER BY count DESC"
  ).all();

  const by_tag = db.query<{ tag: string; count: number }, []>(
    "SELECT t.name as tag, COUNT(*) as count FROM file_tags ft JOIN tags t ON t.id=ft.tag_id GROUP BY t.name ORDER BY count DESC LIMIT 20"
  ).all();

  const total_collections = db.query<{ cnt: number }, []>("SELECT COUNT(*) as cnt FROM collections").get()!.cnt;
  const total_projects = db.query<{ cnt: number }, []>("SELECT COUNT(*) as cnt FROM projects").get()!.cnt;
  const total_agents = db.query<{ cnt: number }, []>("SELECT COUNT(*) as cnt FROM agents").get()!.cnt;

  return { content: [{ type: "text" as const, text: JSON.stringify({
    ...totals, by_ext, by_source, by_machine, by_tag, total_collections, total_projects, total_agents,
  }, null, 2) }] };
});

// ─── annotate_file ────────────────────────────────────────────────────────────

registerTool("annotate_file", "Add or update a description/annotation on a file", {
  file_id: z.string().describe("File ID"),
  description: z.string().describe("Description or annotation text"),
  agent_id: z.string().optional().describe("Agent ID for activity tracking"),
}, async ({ file_id, description, agent_id }) => {
  const file = annotateFile(file_id, description);
  if (!file) return { content: [{ type: "text" as const, text: `File not found: ${file_id}` }], isError: true };
  if (agent_id) logActivity({ agent_id, action: "annotate", file_id, metadata: { description } });
  return { content: [{ type: "text" as const, text: JSON.stringify(file, null, 2) }] };
});

// ─── normalize_source ──────────────────────────────────────────────────────────

registerTool("normalize_source", "Batch-generate canonical names for all files in a source that don't have one", {
  source_id: z.string().describe("Source ID"),
  agent_id: z.string().optional().describe("Agent ID for activity tracking"),
}, async ({ source_id, agent_id }) => {
  const { getDb: getNormDb } = await import("../db/database.js");
  const { generateCanonicalName: genCanonical } = await import("../lib/normalize.js");
  const db = getNormDb();
  const rows = db.query<{ id: string; name: string }, [string]>(
    "SELECT id, name FROM files WHERE source_id = ? AND canonical_name IS NULL AND status = 'active'"
  ).all(source_id);
  let count = 0;
  for (const row of rows) {
    const canonical = genCanonical(row.name);
    db.run("UPDATE files SET original_name = ?, canonical_name = ? WHERE id = ?", [row.name, canonical, row.id]);
    count++;
  }
  if (agent_id) logActivity({ agent_id, action: "index", source_id, metadata: { normalized: count } });
  return { content: [{ type: "text" as const, text: `Normalized ${count} file(s) in source ${source_id}` }] };
});

// ─── Import ──────────────────────────────────────────────────────────────────

registerTool("import_from_url", "Import a file from any URL (iCloud, Google Drive, Azure, Dropbox shared links, etc.)", {
  url: z.string().describe("URL to download from"),
  dest_source_id: z.string().describe("Destination source ID (local or S3)"),
  dest_path: z.string().optional().describe("Custom destination path within the source"),
  tags: z.array(z.string()).optional().describe("Tags to apply after import"),
  agent_id: z.string().optional().describe("Agent ID for activity tracking"),
}, async ({ url: fileUrl, dest_source_id, dest_path, tags: importTags, agent_id }) => {
  const source = getSource(dest_source_id);
  if (!source) return { content: [{ type: "text" as const, text: `Source not found: ${dest_source_id}` }], isError: true };

  try {
    const resp = await fetch(fileUrl);
    if (!resp.ok) return { content: [{ type: "text" as const, text: `Failed to fetch URL: HTTP ${resp.status}` }], isError: true };

    // Extract filename from Content-Disposition or URL
    const disposition = resp.headers.get("content-disposition");
    let fileName = "downloaded-file";
    if (disposition) {
      const match = disposition.match(/filename[*]?=["']?([^"';\n]+)/);
      if (match) fileName = match[1]!;
    } else {
      const urlPath = new URL(fileUrl).pathname;
      const urlName = urlPath.split("/").pop();
      if (urlName && urlName.includes(".")) fileName = decodeURIComponent(urlName);
    }

    const { writeFileSync, mkdirSync } = await import("fs");
    const { join: joinPath, dirname } = await import("path");
    const safeFileName = safeTempFileName(fileName);
    const finalRelativePath = normalizeManagedRelativePath(dest_path, safeFileName);
    const body = await readResponseBodyWithLimit(resp, normalizeMcpImportLimit());

    if (source.type === "local") {
      const destDir = source.path!;
      const finalPath = joinPath(destDir, finalRelativePath);
      mkdirSync(dirname(finalPath), { recursive: true });
      writeFileSync(finalPath, body);

      const machine = getCurrentMachine();
      await indexLocalSource(source, machine.id);
    } else if (source.type === "s3") {
      // Write to temp, upload, cleanup
      const tmpPath = `/tmp/files-import-${Date.now()}-${safeFileName}`;
      writeFileSync(tmpPath, body);
      await uploadToS3(source, tmpPath, finalRelativePath);
      const { unlinkSync } = await import("fs");
      try { unlinkSync(tmpPath); } catch {}
      const machine = getCurrentMachine();
      await indexS3Source(source, machine.id);
    }

    // Apply tags if provided
    if (importTags?.length) {
      const { getFileByPath: getByPath } = await import("../db/files.js");
      const file = getByPath(dest_source_id, finalRelativePath);
      if (file) {
        for (const tag of importTags) tagFile(file.id, tag);
      }
    }

    if (agent_id) logActivity({ agent_id, action: "import", source_id: dest_source_id, metadata: { url: fileUrl, fileName: safeFileName, path: finalRelativePath } });
    return { content: [{ type: "text" as const, text: `Imported ${safeFileName} to source ${source.name}` }] };
  } catch (e) {
    return { content: [{ type: "text" as const, text: `Import failed: ${(e as Error).message}` }], isError: true };
  }
});

registerTool("import_from_local", "Import a file from any local path into a managed source", {
  path: z.string().describe("Absolute path to the file (e.g. ~/Downloads/file.pdf, iCloud Drive path, etc.)"),
  dest_source_id: z.string().describe("Destination source ID"),
  dest_path: z.string().optional().describe("Custom path within the source"),
  tags: z.array(z.string()).optional().describe("Tags to apply after import"),
  copy: z.boolean().optional().default(true).describe("true=copy (default), false=move"),
  agent_id: z.string().optional().describe("Agent ID for activity tracking"),
}, async ({ path: srcPath, dest_source_id, dest_path, tags: importTags, copy, agent_id }) => {
  const source = getSource(dest_source_id);
  if (!source) return { content: [{ type: "text" as const, text: `Source not found: ${dest_source_id}` }], isError: true };
  if (!existsSync(srcPath)) return { content: [{ type: "text" as const, text: `File not found: ${srcPath}` }], isError: true };

  const { copyFileSync, renameSync, mkdirSync: mkDir } = await import("fs");
  const { join: joinPath, dirname, basename: baseName } = await import("path");
  const fileName = safeTempFileName(baseName(srcPath));
  let finalRelativePath: string;
  try {
    finalRelativePath = normalizeManagedRelativePath(dest_path, fileName);
  } catch (error) {
    return mcpError(error instanceof Error ? error.message : String(error));
  }

  if (source.type === "local") {
    const finalPath = joinPath(source.path!, finalRelativePath);
    mkDir(dirname(finalPath), { recursive: true });
    if (copy) copyFileSync(srcPath, finalPath);
    else renameSync(srcPath, finalPath);
    const machine = getCurrentMachine();
    await indexLocalSource(source, machine.id);
  } else if (source.type === "s3") {
    await uploadToS3(source, srcPath, finalRelativePath);
    if (!copy) { const { unlinkSync } = await import("fs"); try { unlinkSync(srcPath); } catch {} }
    const machine = getCurrentMachine();
    await indexS3Source(source, machine.id);
  }

  if (importTags?.length) {
    const { getFileByPath: getByPath } = await import("../db/files.js");
    const file = getByPath(dest_source_id, finalRelativePath);
    if (file) {
      for (const tag of importTags) tagFile(file.id, tag);
    }
  }

  if (agent_id) logActivity({ agent_id, action: "import", source_id: dest_source_id, metadata: { src: srcPath, copy, path: finalRelativePath } });
  return { content: [{ type: "text" as const, text: `Imported ${fileName} to source ${source.name}` }] };
});

registerTool("bulk_import", "Import multiple files at once from URLs or local paths", {
  items: z.array(z.object({
    url_or_path: z.string().describe("URL or local file path"),
    tags: z.array(z.string()).optional().describe("Per-file tags"),
  })).describe("List of files to import"),
  dest_source_id: z.string().describe("Destination source ID"),
  agent_id: z.string().optional().describe("Agent ID for activity tracking"),
}, async ({ items, dest_source_id, agent_id }) => {
  let imported = 0;
  let failed = 0;
  const errors: string[] = [];

  for (const item of items) {
    const isUrl = item.url_or_path.startsWith("http://") || item.url_or_path.startsWith("https://");
    try {
      // Use the inner logic directly to avoid MCP re-entry
      if (isUrl) {
        const resp = await fetch(item.url_or_path);
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
        const urlPath = new URL(item.url_or_path).pathname;
        const fileName = safeTempFileName(decodeURIComponent(urlPath.split("/").pop() || "file"));
        const { writeFileSync: ws } = await import("fs");
        const tmpPath = `/tmp/files-import-${Date.now()}-${fileName}`;
        ws(tmpPath, await readResponseBodyWithLimit(resp, normalizeMcpImportLimit()));
        const source = getSource(dest_source_id)!;
        const finalPath = normalizeManagedRelativePath(undefined, fileName);
        if (source.type === "s3") {
          await uploadToS3(source, tmpPath, finalPath);
        } else {
          const { copyFileSync: cpf, mkdirSync: mkd } = await import("fs");
          const { join: jp } = await import("path");
          mkd(source.path!, { recursive: true });
          cpf(tmpPath, jp(source.path!, finalPath));
        }
        const { unlinkSync: ul } = await import("fs"); try { ul(tmpPath); } catch {}
      } else {
        if (!existsSync(item.url_or_path)) throw new Error(`File not found: ${item.url_or_path}`);
        const source = getSource(dest_source_id)!;
        const { basename: bn } = await import("path");
        const fileName = safeTempFileName(bn(item.url_or_path));
        const finalPath = normalizeManagedRelativePath(undefined, fileName);
        if (source.type === "s3") {
          await uploadToS3(source, item.url_or_path, finalPath);
        } else {
          const { copyFileSync: cpf, mkdirSync: mkd } = await import("fs");
          const { join: jp } = await import("path");
          mkd(source.path!, { recursive: true });
          cpf(item.url_or_path, jp(source.path!, finalPath));
        }
      }
      imported++;
    } catch (e) {
      failed++;
      errors.push(`${item.url_or_path}: ${(e as Error).message}`);
    }
  }

  // Re-index the source once after all imports
  const source = getSource(dest_source_id);
  if (source) {
    const machine = getCurrentMachine();
    if (source.type === "s3") await indexS3Source(source, machine.id);
    else await indexLocalSource(source, machine.id);
  }

  if (agent_id) logActivity({ agent_id, action: "import", source_id: dest_source_id, metadata: { imported, failed } });
  return { content: [{ type: "text" as const, text: JSON.stringify({ imported, failed, errors }, null, 2) }] };
});

// ─── QOL Tools ───────────────────────────────────────────────────────────────

registerTool("resolve_id", "Resolve a partial ID to a full ID (prefix matching)", {
  partial: z.string().describe("Partial ID (e.g. 'f_abc' or 'col_x')"),
  type: z.enum(["files", "sources", "collections", "projects", "tags", "machines"]).describe("Entity type"),
}, async ({ partial, type }) => {
  const { resolveId } = await import("../db/resolve.js");
  try {
    const id = resolveId(partial, type);
    if (!id) return { content: [{ type: "text" as const, text: `No ${type.slice(0, -1)} found matching "${partial}"` }], isError: true };
    return { content: [{ type: "text" as const, text: id }] };
  } catch (e) {
    return { content: [{ type: "text" as const, text: (e as Error).message }], isError: true };
  }
});

registerTool("get_file_by_path", "Look up a file by its path within a source", {
  source_id: z.string().describe("Source ID"),
  path: z.string().describe("File path relative to source root"),
}, async ({ source_id, path }) => {
  const file = getFileByPath(source_id, path);
  if (!file) return { content: [{ type: "text" as const, text: `File not found: ${path} in source ${source_id}` }], isError: true };
  const full = getFile(file.id);
  return { content: [{ type: "text" as const, text: JSON.stringify(full, null, 2) }] };
});

registerTool("recent_files", "Get files recently touched by agents (read, upload, tag, annotate, etc.)", {
  agent_id: z.string().optional().describe("Filter by agent ID (omit for all agents)"),
  limit: z.number().optional().default(20),
}, async ({ agent_id, limit }) => {
  const { getDb: getRecentDb } = await import("../db/database.js");
  const db = getRecentDb();
  const lim = limit ?? 20;
  const query = agent_id
    ? "SELECT DISTINCT file_id, MAX(created_at) as last_touched FROM agent_activity WHERE file_id IS NOT NULL AND agent_id = ? GROUP BY file_id ORDER BY last_touched DESC LIMIT ?"
    : "SELECT DISTINCT file_id, MAX(created_at) as last_touched FROM agent_activity WHERE file_id IS NOT NULL GROUP BY file_id ORDER BY last_touched DESC LIMIT ?";
  const params = agent_id ? [agent_id, lim] : [lim];
  const rows = (db.query(query) as any).all(params) as { file_id: string; last_touched: string }[];
  const files = rows.map(r => { const f = getFile(r.file_id); return f ? { ...f, last_touched: r.last_touched } : null; }).filter(Boolean);
  return { content: [{ type: "text" as const, text: JSON.stringify(files, null, 2) }] };
});

registerTool("list_deleted_files", "List soft-deleted files (trash)", {
  source_id: z.string().optional(),
  limit: z.number().optional().default(50),
  offset: z.number().optional().default(0),
}, async ({ source_id, limit, offset }) => {
  const files = listFiles({ source_id, status: "deleted", limit, offset });
  return { content: [{ type: "text" as const, text: JSON.stringify(files, null, 2) }] };
});

registerTool("list_conflicts", "List files with sync conflicts", {
  source_id: z.string().optional(),
  limit: z.number().optional().default(50),
}, async ({ source_id, limit }) => {
  const { getDb: getConflictDb } = await import("../db/database.js");
  const db = getConflictDb();
  const lim = limit ?? 50;
  const query = source_id
    ? "SELECT * FROM files WHERE sync_status = 'conflict' AND source_id = ? LIMIT ?"
    : "SELECT * FROM files WHERE sync_status = 'conflict' LIMIT ?";
  const params = source_id ? [source_id, lim] : [lim];
  const rows = (db.query(query) as any).all(params);
  return { content: [{ type: "text" as const, text: JSON.stringify(rows, null, 2) }] };
});

registerTool("resolve_conflict", "Resolve a sync conflict by picking a side", {
  file_id: z.string().describe("File ID with conflict"),
  resolution: z.enum(["keep_local", "keep_remote", "mark_resolved"]).describe("How to resolve"),
}, async ({ file_id, resolution }) => {
  const { getDb: getResDb } = await import("../db/database.js");
  getResDb().run("UPDATE files SET sync_status = 'synced', sync_version = sync_version + 1 WHERE id = ?", [file_id]);
  return { content: [{ type: "text" as const, text: `Conflict resolved for ${file_id} (${resolution})` }] };
});

registerTool("purge_deleted", "Permanently remove soft-deleted files from the database", {
  source_id: z.string().optional().describe("Limit to a specific source"),
  older_than: z.string().optional().describe("Only purge files deleted before this date (ISO 8601)"),
}, async ({ source_id, older_than }) => {
  const { getDb: getPurgeDb } = await import("../db/database.js");
  const db = getPurgeDb();
  const conditions = ["status = 'deleted'"];
  const params: import("bun:sqlite").SQLQueryBindings[] = [];
  if (source_id) { conditions.push("source_id = ?"); params.push(source_id); }
  if (older_than) { conditions.push("indexed_at <= ?"); params.push(older_than); }
  const result = db.run(`DELETE FROM files WHERE ${conditions.join(" AND ")}`, params);
  return { content: [{ type: "text" as const, text: `Purged ${result.changes} deleted file(s)` }] };
});

registerTool("get_or_create_collection", "Find a collection by name, or create it if it doesn't exist", {
  name: z.string(),
  description: z.string().optional().default(""),
}, async ({ name, description }) => {
  const { getDb: getGocDb } = await import("../db/database.js");
  const db = getGocDb();
  const existing = db.query<{ id: string }, [string]>("SELECT id FROM collections WHERE name = ?").get(name);
  if (existing) {
    const c = getCollection(existing.id);
    return { content: [{ type: "text" as const, text: JSON.stringify(c, null, 2) }] };
  }
  const c = createCollection(name, description);
  return { content: [{ type: "text" as const, text: JSON.stringify(c, null, 2) }] };
});

registerTool("get_or_create_project", "Find a project by name, or create it if it doesn't exist", {
  name: z.string(),
  description: z.string().optional().default(""),
}, async ({ name, description }) => {
  const { getDb: getGopDb } = await import("../db/database.js");
  const db = getGopDb();
  const existing = db.query<{ id: string }, [string]>("SELECT id FROM projects WHERE name = ?").get(name);
  if (existing) {
    const p = getProject(existing.id);
    return { content: [{ type: "text" as const, text: JSON.stringify(p, null, 2) }] };
  }
  const p = createProject(name, description);
  return { content: [{ type: "text" as const, text: JSON.stringify(p, null, 2) }] };
});

// ─── Feedback ────────────────────────────────────────────────────────────────

registerTool(
  "send_feedback",
  "Send feedback about this service",
  {
    message: z.string(),
    email: z.string().optional(),
    category: z.enum(["bug", "feature", "general"]).optional(),
  },
  async (params) => {
    try {
      const { getDb: getFeedbackDb } = await import("../db/database.js");
      const db = getFeedbackDb();
      db.run("INSERT INTO feedback (message, email, category, version) VALUES (?, ?, ?, ?)", [
        params.message, params.email || null, params.category || "general", pkg.version,
      ]);
      return { content: [{ type: "text" as const, text: "Feedback saved. Thank you!" }] };
    } catch (e) {
      return { content: [{ type: "text" as const, text: String(e) }], isError: true };
    }
  },
);

// ─── Agent Tools ──────────────────────────────────────────────────────────────

registerTool("register_agent", "Register an agent session. Returns agent_id. Auto-triggers a heartbeat.", {
  name: z.string(),
  session_id: z.string().optional(),
}, async (params) => {
  const agent = registerAgent(params.name, params.session_id);
  return { content: [{ type: "text" as const, text: JSON.stringify(agent) }] };
});

registerTool("heartbeat", "Update last_seen_at to signal agent is active.", {
  agent_id: z.string(),
}, async (params) => {
  const agent = updateAgentHeartbeat(params.agent_id);
  if (!agent) return { content: [{ type: "text" as const, text: `Agent not found: ${params.agent_id}` }], isError: true };
  return { content: [{ type: "text" as const, text: JSON.stringify({ agent_id: agent.id, last_seen_at: agent.last_seen_at }) }] };
});

registerTool("set_focus", "Set active project context for this agent session.", {
  agent_id: z.string(),
  project_id: z.string().optional(),
}, async (params) => {
  const agent = setAgentFocus(params.agent_id, params.project_id);
  if (!agent) return { content: [{ type: "text" as const, text: `Agent not found: ${params.agent_id}` }], isError: true };
  return { content: [{ type: "text" as const, text: JSON.stringify({ agent_id: agent.id, project_id: agent.project_id ?? null }) }] };
});

registerTool("list_agents", "List all registered agents.", {}, async () => {
  return { content: [{ type: "text" as const, text: JSON.stringify(listDbAgents()) }] };
});

// ─── Watcher ──────────────────────────────────────────────────────────────────

registerTool("watch_source", "Start watching a local source for file changes (real-time indexing)", {
  source_id: z.string().describe("Source ID (must be a local source)"),
}, async ({ source_id }) => {
  const source = getSource(source_id);
  if (!source) return { content: [{ type: "text" as const, text: `Source not found: ${source_id}` }], isError: true };
  if (source.type !== "local") return { content: [{ type: "text" as const, text: "watch_source only works with local sources" }], isError: true };
  const { watchSource } = await import("../lib/watcher.js");
  const machine = getCurrentMachine();
  watchSource(source, machine.id);
  return { content: [{ type: "text" as const, text: `Watching ${source.name} (${source.path})` }] };
});

registerTool("unwatch_source", "Stop watching a source for file changes", {
  source_id: z.string().describe("Source ID"),
}, async ({ source_id }) => {
  const { unwatchSource } = await import("../lib/watcher.js");
  unwatchSource(source_id);
  return { content: [{ type: "text" as const, text: `Stopped watching source ${source_id}` }] };
});

// ─── Activity ─────────────────────────────────────────────────────────────────

registerTool("get_file_history", "Get all agent activity for a file", {
  file_id: z.string().describe("File ID"),
  after: z.string().optional().describe("Filter: activity after this date (ISO 8601)"),
  before: z.string().optional().describe("Filter: activity before this date (ISO 8601)"),
  action: z.string().optional().describe("Filter by action type (upload, download, tag, etc.)"),
  limit: z.number().optional().default(50),
  offset: z.number().optional().default(0),
}, async ({ file_id, after, before, action, limit, offset }) => {
  const history = getFileHistory(file_id, { after, before, action: action as any, limit, offset });
  return { content: [{ type: "text" as const, text: JSON.stringify(history, null, 2) }] };
});

registerTool("get_agent_activity", "Get all activity by a specific agent", {
  agent_id: z.string().describe("Agent ID"),
  after: z.string().optional().describe("Filter: activity after this date (ISO 8601)"),
  before: z.string().optional().describe("Filter: activity before this date (ISO 8601)"),
  action: z.string().optional().describe("Filter by action type"),
  limit: z.number().optional().default(50),
  offset: z.number().optional().default(0),
}, async ({ agent_id, after, before, action, limit, offset }) => {
  const activity = getAgentActivity(agent_id, { after, before, action: action as any, limit, offset });
  return { content: [{ type: "text" as const, text: JSON.stringify(activity, null, 2) }] };
});

registerTool("get_session_activity", "Get all activity within a session", {
  session_id: z.string().describe("Session ID"),
  after: z.string().optional().describe("Filter: activity after this date (ISO 8601)"),
  before: z.string().optional().describe("Filter: activity before this date (ISO 8601)"),
  action: z.string().optional().describe("Filter by action type"),
  limit: z.number().optional().default(50),
  offset: z.number().optional().default(0),
}, async ({ session_id, after, before, action, limit, offset }) => {
  const activity = getSessionActivity(session_id, { after, before, action: action as any, limit, offset });
  return { content: [{ type: "text" as const, text: JSON.stringify(activity, null, 2) }] };
});

  return server;
}

function printHelp(): void {
  console.log(`Usage: files-mcp [options]

Runs the open-files MCP server (stdio by default).

Options:
  --http            Serve MCP over Streamable HTTP (127.0.0.1)
  --port <number>   HTTP port (default: 8818, env: MCP_HTTP_PORT)
  -h, --help        Show this help text`);
}

async function main(): Promise<void> {
  if (process.argv.includes("-h") || process.argv.includes("--help")) {
    printHelp();
    return;
  }

  const { isStdioMode, resolveMcpHttpPort, startMcpHttpServer } = await import("./http.js");

  if (isStdioMode()) {
    const server = buildServer();
    const transport = new StdioServerTransport();
    await server.connect(transport);
    return;
  }

  // Default: shared Streamable HTTP server (one process per MCP, many agents).
  const handle = await startMcpHttpServer(buildServer, {
    port: resolveMcpHttpPort(),
  });
  process.on("SIGINT", () => void handle.close().finally(() => process.exit(0)));
  process.on("SIGTERM", () => void handle.close().finally(() => process.exit(0)));
}

if (import.meta.main) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
