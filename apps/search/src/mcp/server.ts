import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { PROVIDER_NAMES, SearchProviderNameSchema, ExportFormatSchema } from "../types/index.js";
import { unifiedSearch, searchSingleProvider } from "../lib/search.js";
import { exportResults } from "../lib/export.js";
import { getConfig, setConfig } from "../lib/config.js";
import { listSearches, getSearch, deleteSearch, getSearchStats } from "../db/searches.js";
import { countResults, listResults, getResult, searchResultsFts } from "../db/results.js";
import {
  createSavedSearch,
  listSavedSearches,
  getSavedSearch,
  deleteSavedSearch,
  updateSavedSearchLastRun,
} from "../db/saved-searches.js";
import {
  listProviders,
  enableProvider,
  disableProvider,
  updateProvider,
  isProviderConfigured,
} from "../db/providers.js";
import { listProfiles, createProfile, deleteProfile } from "../db/profiles.js";
import {
  transcribeVideo,
  searchTranscripts,
  isTranscriberAvailable,
} from "../lib/providers/transcriber.js";
import { findLocal, type FindKind } from "../lib/local/find.js";
import {
  addRoot,
  getRoot,
  indexRoot,
  indexAllRoots,
  listRoots,
  removeRoot,
  type IndexRoot,
} from "../lib/local/indexer.js";
import {
  DEFAULT_COMPACT_LIMIT,
  clampLimit,
  compactEnvelope,
  compactProfile,
  compactProvider,
  compactResult,
  compactSavedSearch,
  compactSearch,
  truncateMiddle,
  truncateText,
} from "../lib/compact-output.js";
import { registerSearchStorageTools } from "./storage-tools.js";

const pkg = require("../../package.json") as { version: string };

export const MCP_NAME = "search";
export const VERSION = pkg.version;

interface AgentRegistration {
  id: string;
  name: string;
  last_seen_at: string;
  project_id?: string;
}

const agentRegistry = new Map<string, AgentRegistration>();

function jsonText(value: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(value) }] };
}

function plainText(text: string, isError = false) {
  return { content: [{ type: "text" as const, text }], ...(isError ? { isError: true as const } : {}) };
}

function mcpLimit(limit: number | undefined, fallback = DEFAULT_COMPACT_LIMIT): number {
  return clampLimit(limit, fallback);
}

function mcpOffset(offset: number | undefined): number {
  return Number.isInteger(offset) && offset! >= 0 ? offset! : 0;
}

function compactIndexRoot(root: IndexRoot & { staleMinutes?: number | null }): Record<string, unknown> {
  return {
    id: root.id,
    name: root.name,
    path: truncateMiddle(root.path, 120),
    status: root.status,
    fileCount: root.fileCount,
    lastIndexedAt: root.lastIndexedAt,
    staleMinutes: root.staleMinutes ?? null,
    error: root.error ? truncateText(root.error, 160) : null,
  };
}

function compactSearchResults(
  results: import("../types/index.js").SearchResult[],
  verbose: boolean | undefined,
): unknown[] {
  return verbose ? results : results.slice(0, DEFAULT_COMPACT_LIMIT).map(compactResult);
}

function searchHint(
  total: number,
  returned: number,
  moreHint = "Use a narrower query to reduce rows.",
): string {
  const detail = "Use verbose:true for full result records.";
  return returned < total ? `${detail} ${moreHint}` : detail;
}

export function buildServer(): McpServer {
  const server = new McpServer({
    name: "search-mcp",
    version: VERSION,
  });

  registerSearchStorageTools(server);

// --- Local find (one-call file lookup for agents) ---
server.tool(
  "find",
  "Find files on this machine by name, path, or content in one call — across all indexed workspace roots. Returns ranked absolute paths with line numbers and snippets. Use instead of repeated glob/grep/ls when locating files.",
  {
    query: z.string().describe("File name, path fragment, content to look for — or a regex with regex:true"),
    kind: z.enum(["file", "content", "both"]).optional().describe("Match on file names, file content, or both (default: both)"),
    root: z.string().optional().describe("Limit to one index root (name, path, or id)"),
    ext: z.string().optional().describe("Filter by file extension, e.g. 'ts'"),
    dir: z.string().optional().describe("Filter by directory substring, e.g. 'src/db'"),
    limit: z.number().int().min(1).max(100).optional().describe("Max results (default 20)"),
    regex: z.boolean().optional().describe("Treat query as a regular expression (grep-style, line-based; needs one 3+ char literal)"),
    case_sensitive: z.boolean().optional().describe("Case-sensitive matching (regex mode only)"),
    verbose: z.boolean().optional().describe("Return full paths/snippets/match lines instead of compact rows"),
  },
  async ({ query, kind, root, ext, dir, limit, regex, case_sensitive, verbose }) => {
    const response = findLocal(query, {
      kind: kind as FindKind,
      root,
      ext,
      dir,
      limit: mcpLimit(limit),
      regex,
      caseSensitive: case_sensitive,
    });
    if (!response.indexed) {
      return plainText("No index roots ready. Add one with the index_add tool (e.g. {\"path\": \"~/workspace\"}) or `search index add <path>`.");
    }
    const results = verbose
      ? response.results
      : response.results.map((r) => ({
          path: truncateMiddle(r.path, 140),
          root: r.root,
          kind: r.kind,
          line: r.line,
          score: r.score,
          snippet: truncateText(r.snippet, 180),
        }));
    return jsonText({
      query: response.query,
      kind: response.kind,
      indexed: response.indexed,
      roots: response.roots,
      total: response.total,
      returned: results.length,
      results,
      hint: verbose ? undefined : "Use verbose:true for full paths and additional match lines.",
    });
  },
);

// --- Local index management ---
server.tool(
  "index_add",
  "Register a directory in the local file index and index it (file paths + content)",
  {
    path: z.string().describe("Absolute directory path to index"),
    name: z.string().optional().describe("Friendly root name (default: basename)"),
    content: z.boolean().optional().describe("Index file content too (default: true)"),
    exclude: z.array(z.string()).optional().describe("Extra exclude patterns (gitignore syntax)"),
    verbose: z.boolean().optional().describe("Return the full root record"),
  },
  async ({ path, name, content, exclude, verbose }) => {
    const root = addRoot(path, { name, contentIndexing: content, exclude });
    const stats = indexRoot(root.id);
    const indexedRoot = getRoot(root.id);
    return jsonText({ root: verbose ? indexedRoot : indexedRoot ? compactIndexRoot(indexedRoot) : null, stats });
  },
);

server.tool(
  "index_update",
  "Incrementally re-index one root (or all roots) — only changed files are re-read",
  {
    root: z.string().optional().describe("Root name, path, or id (default: all roots)"),
    force: z.boolean().optional().describe("Re-read content for every file"),
  },
  async ({ root, force }) => {
    if (root) {
      const r = getRoot(root);
      if (!r) return plainText(`Index root not found: ${root}`, true);
      const stats = indexRoot(r.id, { force });
      return jsonText(stats);
    }
    const all = indexAllRoots({ force });
    return jsonText(compactEnvelope("index_stats", all, {
      total: all.length,
      hint: "Use index_status for root details.",
    }));
  },
);

server.tool(
  "index_status",
  "List local index roots with file counts, status, and staleness",
  {
    limit: z.number().int().min(1).max(100).optional().describe("Max roots (default 20)"),
    offset: z.number().int().min(0).optional(),
    verbose: z.boolean().optional().describe("Return full root records"),
  },
  async ({ limit, offset, verbose }) => {
    const pageLimit = mcpLimit(limit);
    const pageOffset = mcpOffset(offset);
    const roots = listRoots().map((r) => ({
      ...r,
      staleMinutes: r.lastIndexedAt
        ? Math.round((Date.now() - Date.parse(r.lastIndexedAt)) / 60_000)
        : null,
    }));
    const page = roots.slice(pageOffset, pageOffset + pageLimit);
    return jsonText(compactEnvelope(
      "index_roots",
      verbose ? page : page.map(compactIndexRoot),
      {
        total: roots.length,
        offset: pageOffset,
        hint: "Use verbose:true for full root records.",
      },
    ));
  },
);

server.tool(
  "index_remove",
  "Remove a root and all its indexed data from the local file index",
  { root: z.string().describe("Root name, path, or id") },
  async ({ root }) => {
    const ok = removeRoot(root);
    if (!ok) {
      return plainText(`Not found: ${root}`, true);
    }
    return plainText("Removed");
  },
);

// --- Unified search ---
server.tool(
  "search",
  "Search across multiple providers simultaneously. Returns normalized, deduplicated results.",
  {
    query: z.string().describe("Search query"),
    providers: z.array(SearchProviderNameSchema).optional().describe("Providers to search (default: all enabled)"),
    profile: z.string().optional().describe("Search profile name (e.g. research, social, code)"),
    limit: z.number().int().min(1).max(100).optional().describe("Max results per provider"),
    dedup: z.boolean().optional().describe("Deduplicate results by URL (default: true)"),
    smart: z.boolean().optional().describe("Route to the best configured providers before searching"),
    verbose: z.boolean().optional().describe("Return full result records instead of compact rows"),
  },
  async ({ query, providers, profile, limit, dedup, smart, verbose }) => {
    const response = await unifiedSearch(query, {
      providers,
      profile,
      options: limit ? { limit } : undefined,
      dedup,
      smart,
    });
    const results = compactSearchResults(response.results, verbose);
    return jsonText({
      searchId: response.search.id,
      query: response.search.query,
      resultCount: response.results.length,
      returned: results.length,
      duration: response.search.duration,
      results,
      errors: response.errors,
      routing: response.routing,
      hint: verbose
        ? undefined
        : searchHint(response.results.length, results.length, "Use provider filters or a narrower query to reduce rows."),
    });
  },
);

// --- Provider-specific searches ---
for (const providerName of PROVIDER_NAMES) {
  server.tool(
    `search_${providerName}`,
    `Search using ${providerName} provider`,
    {
      query: z.string().describe("Search query"),
      limit: z.number().int().min(1).max(100).optional().describe("Max results"),
      verbose: z.boolean().optional().describe("Return full result records instead of compact rows"),
    },
    async ({ query, limit, verbose }) => {
      const response = await searchSingleProvider(providerName, query, limit ? { limit } : undefined);
      const results = compactSearchResults(response.results, verbose);
      return jsonText({
        searchId: response.search.id,
        resultCount: response.results.length,
        returned: results.length,
        duration: response.search.duration,
        results,
        errors: response.errors,
        hint: verbose
          ? undefined
          : searchHint(response.results.length, results.length, "Use a narrower query to reduce rows."),
      });
    },
  );
}

// --- Search history ---
server.tool(
  "list_searches",
  "List search history with optional query filter",
  {
    query: z.string().optional().describe("Filter by query text"),
    limit: z.number().int().min(1).max(100).optional().describe("Max results (default 20)"),
    offset: z.number().int().min(0).optional(),
    verbose: z.boolean().optional().describe("Return full search records instead of compact rows"),
  },
  async ({ query, limit, offset, verbose }) => {
    const pageLimit = mcpLimit(limit);
    const pageOffset = mcpOffset(offset);
    const { searches, total } = listSearches({ query, limit: pageLimit, offset: pageOffset });
    const items: unknown[] = verbose ? searches : searches.map(compactSearch);
    return jsonText(compactEnvelope(
      "searches",
      items,
      {
        total,
        offset: pageOffset,
        hint: "Use get_search with an id, or verbose:true for full search records.",
      },
    ));
  },
);

server.tool(
  "get_search",
  "Get search details with results",
  {
    id: z.string().describe("Search ID"),
    limit: z.number().int().min(1).max(100).optional().describe("Max result rows (default 20)"),
    offset: z.number().int().min(0).optional(),
    verbose: z.boolean().optional().describe("Return full result records instead of compact rows"),
  },
  async ({ id, limit, offset, verbose }) => {
    const search = getSearch(id);
    if (!search) return plainText("Search not found", true);
    const pageLimit = mcpLimit(limit);
    const pageOffset = mcpOffset(offset);
    const results = listResults(id, { limit: pageLimit, offset: pageOffset });
    const items: unknown[] = verbose ? results : results.map(compactResult);
    return jsonText({
      search,
      results: compactEnvelope(
        "results",
        items,
        {
          total: search.resultCount,
          offset: pageOffset,
          hint: verbose ? undefined : "Use verbose:true for full result records.",
        },
      ),
    });
  },
);

server.tool(
  "delete_search",
  "Delete a search from history",
  { id: z.string().describe("Search ID") },
  async ({ id }) => {
    const ok = deleteSearch(id);
    return plainText(ok ? "Deleted" : "Not found", !ok);
  },
);

// --- Results ---
server.tool(
  "list_results",
  "List results for a search",
  {
    search_id: z.string().describe("Search ID"),
    limit: z.number().int().min(1).max(100).optional().describe("Max result rows (default 20)"),
    offset: z.number().int().min(0).optional(),
    source: SearchProviderNameSchema.optional().describe("Filter by provider"),
    verbose: z.boolean().optional().describe("Return full result records instead of compact rows"),
  },
  async ({ search_id, limit, offset, source, verbose }) => {
    const pageLimit = mcpLimit(limit);
    const pageOffset = mcpOffset(offset);
    const results = listResults(search_id, { limit: pageLimit, offset: pageOffset, source });
    const search = source ? null : getSearch(search_id);
    const total = source ? countResults(search_id, { source }) : (search?.resultCount ?? results.length);
    const items: unknown[] = verbose ? results : results.map(compactResult);
    return jsonText(compactEnvelope(
      "results",
      items,
      {
        total,
        offset: pageOffset,
        hint: verbose ? undefined : "Use get_result for one full record, or verbose:true for full listed records.",
      },
    ));
  },
);

server.tool(
  "get_result",
  "Get a single search result by ID",
  { id: z.string().describe("Result ID") },
  async ({ id }) => {
    const result = getResult(id);
    return {
      content: [
        { type: "text" as const, text: result ? JSON.stringify(result) : "Not found" },
      ],
    };
  },
);

server.tool(
  "search_results_fts",
  "Full-text search across all stored search results",
  {
    query: z.string().describe("FTS query"),
    limit: z.number().int().min(1).max(100).optional().describe("Max results (default 20)"),
    verbose: z.boolean().optional().describe("Return full result records instead of compact rows"),
  },
  async ({ query, limit, verbose }) => {
    const results = searchResultsFts(query, { limit: mcpLimit(limit) });
    const items: unknown[] = verbose ? results : results.map(compactResult);
    return jsonText(compactEnvelope(
      "results",
      items,
      {
        hint: verbose ? undefined : "Use get_result for one full record, or verbose:true for full listed records.",
      },
    ));
  },
);

// --- Saved searches ---
server.tool(
  "save_search",
  "Save a search query for later re-execution",
  {
    name: z.string().describe("Name for this saved search"),
    query: z.string().describe("Search query"),
    providers: z.array(SearchProviderNameSchema).optional(),
    profile: z.string().optional(),
  },
  async ({ name, query, providers, profile }) => {
    const saved = createSavedSearch({
      name,
      query,
      providers: providers ?? [],
      profileId: profile,
    });
    return jsonText(saved);
  },
);

server.tool(
  "list_saved_searches",
  "List all saved searches",
  {
    limit: z.number().int().min(1).max(100).optional().describe("Max saved searches (default 20)"),
    offset: z.number().int().min(0).optional(),
    verbose: z.boolean().optional().describe("Return full saved-search records instead of compact rows"),
  },
  async ({ limit, offset, verbose }) => {
    const saved = listSavedSearches();
    const pageLimit = mcpLimit(limit);
    const pageOffset = mcpOffset(offset);
    const page = saved.slice(pageOffset, pageOffset + pageLimit);
    const items: unknown[] = verbose ? page : page.map(compactSavedSearch);
    return jsonText(compactEnvelope(
      "saved_searches",
      items,
      {
        total: saved.length,
        offset: pageOffset,
        hint: "Use run_saved_search with an id, or verbose:true for full saved-search records.",
      },
    ));
  },
);

server.tool(
  "run_saved_search",
  "Re-execute a saved search",
  {
    id: z.string().describe("Saved search ID"),
    limit: z.number().int().min(1).max(100).optional().describe("Override max results per provider"),
    verbose: z.boolean().optional().describe("Return full result records instead of compact rows"),
  },
  async ({ id, limit, verbose }) => {
    const saved = getSavedSearch(id);
    if (!saved) return plainText("Saved search not found", true);
    updateSavedSearchLastRun(id);
    const response = await unifiedSearch(saved.query, {
      providers: saved.providers.length > 0 ? saved.providers : undefined,
      options: { ...saved.options, ...(limit ? { limit } : {}) },
    });
    const results = compactSearchResults(response.results, verbose);
    return jsonText({
      searchId: response.search.id,
      savedSearchId: saved.id,
      resultCount: response.results.length,
      returned: results.length,
      results,
      hint: verbose
        ? undefined
        : searchHint(response.results.length, results.length, "Use provider filters or a narrower query to reduce rows."),
    });
  },
);

server.tool(
  "delete_saved_search",
  "Delete a saved search",
  { id: z.string().describe("Saved search ID") },
  async ({ id }) => {
    const ok = deleteSavedSearch(id);
    return plainText(ok ? "Deleted" : "Not found", !ok);
  },
);

// --- Providers ---
server.tool(
  "list_providers",
  "List all search providers with their configuration and status",
  {
    verbose: z.boolean().optional().describe("Return full provider configuration records"),
  },
  async ({ verbose }) => {
    const providers = listProviders();
    const withStatus = providers.map((p) => ({
      ...p,
      configured: isProviderConfigured(p),
    }));
    return jsonText(compactEnvelope(
      "providers",
      verbose ? withStatus : withStatus.map((p) => compactProvider(p, p.configured)),
      { total: withStatus.length, hint: verbose ? undefined : "Use verbose:true for full provider metadata." },
    ));
  },
);

server.tool(
  "enable_provider",
  "Enable a search provider",
  { name: SearchProviderNameSchema.describe("Provider name") },
  async ({ name }) => {
    const ok = enableProvider(name);
    return plainText(ok ? `${name} enabled` : "Not found", !ok);
  },
);

server.tool(
  "disable_provider",
  "Disable a search provider",
  { name: SearchProviderNameSchema.describe("Provider name") },
  async ({ name }) => {
    const ok = disableProvider(name);
    return plainText(ok ? `${name} disabled` : "Not found", !ok);
  },
);

server.tool(
  "configure_provider",
  "Update provider configuration",
  {
    name: SearchProviderNameSchema.describe("Provider name"),
    api_key_env: z.string().optional().describe("Environment variable for API key"),
    rate_limit: z.number().int().min(0).optional().describe("Requests per minute"),
  },
  async ({ name, api_key_env, rate_limit }) => {
    const updates: Record<string, unknown> = {};
    if (api_key_env) updates.apiKeyEnv = api_key_env;
    if (rate_limit) updates.rateLimit = rate_limit;
    const ok = updateProvider(name, updates);
    return plainText(ok ? `${name} updated` : "Not found", !ok);
  },
);

// --- Profiles ---
server.tool(
  "list_profiles",
  "List all search profiles",
  {
    limit: z.number().int().min(1).max(100).optional().describe("Max profiles (default 20)"),
    offset: z.number().int().min(0).optional(),
    verbose: z.boolean().optional().describe("Return full profile records"),
  },
  async ({ limit, offset, verbose }) => {
    const profiles = listProfiles();
    const pageLimit = mcpLimit(limit);
    const pageOffset = mcpOffset(offset);
    const page = profiles.slice(pageOffset, pageOffset + pageLimit);
    const items: unknown[] = verbose ? page : page.map(compactProfile);
    return jsonText(compactEnvelope(
      "profiles",
      items,
      {
        total: profiles.length,
        offset: pageOffset,
        hint: verbose ? undefined : "Use verbose:true for full profile records.",
      },
    ));
  },
);

server.tool(
  "create_profile",
  "Create a new search profile",
  {
    name: z.string().describe("Profile name"),
    providers: z.array(SearchProviderNameSchema).describe("Providers in this profile"),
    description: z.string().optional(),
  },
  async ({ name, providers, description }) => {
    const profile = createProfile({ name, providers, description });
    return jsonText(profile);
  },
);

server.tool(
  "delete_profile",
  "Delete a search profile",
  { id: z.string().describe("Profile ID") },
  async ({ id }) => {
    const ok = deleteProfile(id);
    return plainText(ok ? "Deleted" : "Not found", !ok);
  },
);

server.tool(
  "search_with_profile",
  "Search using a named profile",
  {
    profile: z.string().describe("Profile name"),
    query: z.string().describe("Search query"),
    limit: z.number().int().min(1).max(100).optional(),
    verbose: z.boolean().optional().describe("Return full result records instead of compact rows"),
  },
  async ({ profile, query, limit, verbose }) => {
    const response = await unifiedSearch(query, {
      profile,
      options: limit ? { limit } : undefined,
    });
    const results = compactSearchResults(response.results, verbose);
    return jsonText({
      searchId: response.search.id,
      profile,
      resultCount: response.results.length,
      returned: results.length,
      results,
      errors: response.errors,
      hint: verbose
        ? undefined
        : searchHint(response.results.length, results.length, "Use provider filters or a narrower query to reduce rows."),
    });
  },
);

// --- YouTube transcription ---
server.tool(
  "transcribe_youtube",
  "Transcribe a YouTube video using microservice-transcriber",
  {
    url: z.string().describe("YouTube video URL"),
    provider: z.string().optional().describe("Transcription provider (elevenlabs, openai, deepgram)"),
    language: z.string().optional().describe("Language code (e.g. en, fr)"),
    verbose: z.boolean().optional().describe("Include the full transcript text"),
  },
  async ({ url, provider, language, verbose }) => {
    const available = await isTranscriberAvailable();
    if (!available) {
      return plainText("Transcriber not available. Ensure microservice-transcriber is running on port 19600 or installed as CLI.", true);
    }
    const result = await transcribeVideo(url, { provider, language });
    if (verbose) return jsonText(result);
    const { transcriptText, ...rest } = result;
    return jsonText({
      ...rest,
      transcriptPreview: truncateText(transcriptText, 600),
      hint: "Use verbose:true for full transcript text.",
    });
  },
);

server.tool(
  "search_transcripts",
  "Search within transcribed YouTube content",
  {
    query: z.string().describe("Search query for transcripts"),
    limit: z.number().int().min(1).max(100).optional().describe("Max transcript matches (default 20)"),
    verbose: z.boolean().optional().describe("Return full snippets"),
  },
  async ({ query, limit, verbose }) => {
    const results = await searchTranscripts(query);
    const pageLimit = mcpLimit(limit);
    const page = results.slice(0, pageLimit);
    return jsonText(compactEnvelope(
      "transcript_matches",
      verbose ? page : page.map((r) => ({ ...r, snippet: truncateText(r.snippet, 220) })),
      {
        total: results.length,
        hint: verbose ? undefined : "Use verbose:true for full transcript snippets.",
      },
    ));
  },
);

// --- Export ---
server.tool(
  "export_results",
  "Export search results in JSON, CSV, or Markdown format",
  {
    search_id: z.string().describe("Search ID to export"),
    format: ExportFormatSchema.describe("Export format: json, csv, md"),
  },
  async ({ search_id, format }) => {
    try {
      const output = exportResults(search_id, format);
      return { content: [{ type: "text" as const, text: output }] };
    } catch (err) {
      return {
        content: [
          { type: "text" as const, text: `Error: ${err instanceof Error ? err.message : err}` },
        ],
        isError: true,
      };
    }
  },
);

// --- Stats ---
server.tool(
  "get_stats",
  "Get search statistics (total searches, results by provider)",
  {},
  async () => {
    const stats = getSearchStats();
    return jsonText(stats);
  },
);

// --- Config ---
server.tool(
  "get_config",
  "Get current search configuration",
  {},
  async () => {
    const config = getConfig();
    return jsonText(config);
  },
);

server.tool(
  "set_config",
  "Update search configuration",
  {
    default_limit: z.number().int().min(1).optional(),
    dedup: z.boolean().optional(),
    max_concurrent: z.number().int().min(1).optional(),
    provider_timeout_ms: z.number().int().min(1).optional(),
    default_profile: z.string().nullable().optional(),
  },
  async (updates) => {
    const config = setConfig({
      ...(updates.default_limit !== undefined && { defaultLimit: updates.default_limit }),
      ...(updates.dedup !== undefined && { dedup: updates.dedup }),
      ...(updates.max_concurrent !== undefined && { maxConcurrent: updates.max_concurrent }),
      ...(updates.provider_timeout_ms !== undefined && { providerTimeoutMs: updates.provider_timeout_ms }),
      ...(updates.default_profile !== undefined && { defaultProfile: updates.default_profile }),
    });
    return jsonText(config);
  },
);

// --- Agent Tools ---

server.tool(
  "register_agent",
  "Register an agent session (idempotent). Auto-updates last_seen_at on re-register.",
  { name: z.string(), session_id: z.string().optional() },
  async (a: { name: string; session_id?: string }) => {
    const existing = [...agentRegistry.values()].find(x => x.name === a.name);
    if (existing) { existing.last_seen_at = new Date().toISOString(); return jsonText(existing); }
    const id = Math.random().toString(36).slice(2, 10);
    const ag = { id, name: a.name, last_seen_at: new Date().toISOString() };
    agentRegistry.set(id, ag);
    return jsonText(ag);
  },
);

server.tool(
  "heartbeat",
  "Update last_seen_at to signal agent is active.",
  { agent_id: z.string() },
  async (a: { agent_id: string }) => {
    const ag = agentRegistry.get(a.agent_id);
    if (!ag) return plainText(`Agent not found: ${a.agent_id}`, true);
    ag.last_seen_at = new Date().toISOString();
    return jsonText({ id: ag.id, name: ag.name, last_seen_at: ag.last_seen_at });
  },
);

server.tool(
  "set_focus",
  "Set active project context for this agent session.",
  { agent_id: z.string(), project_id: z.string().nullable().optional() },
  async (a: { agent_id: string; project_id?: string | null }) => {
    const ag = agentRegistry.get(a.agent_id);
    if (!ag) return plainText(`Agent not found: ${a.agent_id}`, true);
    ag.project_id = a.project_id ?? undefined;
    return plainText(a.project_id ? `Focus: ${a.project_id}` : "Focus cleared");
  },
);

server.tool(
  "list_agents",
  "List all registered agents.",
  {
    limit: z.number().int().min(1).max(100).optional().describe("Max agents (default 20)"),
    offset: z.number().int().min(0).optional(),
  },
  async ({ limit, offset }) => {
    const agents = [...agentRegistry.values()];
    if (agents.length === 0) return plainText("No agents registered.");
    const pageOffset = mcpOffset(offset);
    const page = agents.slice(pageOffset, pageOffset + mcpLimit(limit));
    return jsonText(compactEnvelope("agents", page, { total: agents.length, offset: pageOffset }));
  },
);

// --- Feedback ---

server.tool(
  "send_feedback",
  "Send feedback about this service",
  {
    message: z.string().describe("Feedback message"),
    email: z.string().optional().describe("Contact email (optional)"),
    category: z.enum(["bug", "feature", "general"]).optional().describe("Feedback category"),
  },
  async (params) => {
    const { getDb } = await import("../db/database.js");
    const db = getDb();
    const pkg = require("../../package.json");
    db.run(
      "INSERT INTO feedback (message, email, category, version) VALUES (?, ?, ?, ?)",
      [params.message, params.email || null, params.category || "general", pkg.version]
    );
    return plainText("Feedback saved. Thank you!");
  }
);

  return server;
}
