#!/usr/bin/env bun
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { PROVIDER_NAMES, SearchProviderNameSchema, ExportFormatSchema } from "../types/index.js";
import { unifiedSearch, searchSingleProvider } from "../lib/search.js";
import { exportResults } from "../lib/export.js";
import { getConfig, setConfig } from "../lib/config.js";
import { listSearches, getSearch, deleteSearch, getSearchStats } from "../db/searches.js";
import { listResults, getResult, searchResultsFts } from "../db/results.js";
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

const server = new McpServer({
  name: "search-mcp",
  version: "0.0.1",
});

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
  },
  async ({ query, providers, profile, limit, dedup }) => {
    const response = await unifiedSearch(query, {
      providers,
      profile,
      options: limit ? { limit } : undefined,
      dedup,
    });
    return {
      content: [
        {
          type: "text" as const,
          text: JSON.stringify(
            {
              searchId: response.search.id,
              query: response.search.query,
              resultCount: response.results.length,
              duration: response.search.duration,
              results: response.results.map((r) => ({
                rank: r.rank,
                title: r.title,
                url: r.url,
                snippet: r.snippet,
                source: r.source,
                score: r.score,
              })),
              errors: response.errors,
            },
            null,
            2,
          ),
        },
      ],
    };
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
    },
    async ({ query, limit }) => {
      const response = await searchSingleProvider(providerName, query, limit ? { limit } : undefined);
      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(
              {
                searchId: response.search.id,
                resultCount: response.results.length,
                duration: response.search.duration,
                results: response.results.map((r) => ({
                  rank: r.rank,
                  title: r.title,
                  url: r.url,
                  snippet: r.snippet,
                  score: r.score,
                })),
                errors: response.errors,
              },
              null,
              2,
            ),
          },
        ],
      };
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
  },
  async ({ query, limit, offset }) => {
    const { searches, total } = listSearches({ query, limit: limit ?? 20, offset });
    return {
      content: [{ type: "text" as const, text: JSON.stringify({ total, searches }, null, 2) }],
    };
  },
);

server.tool(
  "get_search",
  "Get search details with results",
  { id: z.string().describe("Search ID") },
  async ({ id }) => {
    const search = getSearch(id);
    if (!search) return { content: [{ type: "text" as const, text: "Search not found" }] };
    const results = listResults(id);
    return {
      content: [{ type: "text" as const, text: JSON.stringify({ search, results }, null, 2) }],
    };
  },
);

server.tool(
  "delete_search",
  "Delete a search from history",
  { id: z.string().describe("Search ID") },
  async ({ id }) => {
    const ok = deleteSearch(id);
    return { content: [{ type: "text" as const, text: ok ? "Deleted" : "Not found" }] };
  },
);

// --- Results ---
server.tool(
  "list_results",
  "List results for a search",
  {
    search_id: z.string().describe("Search ID"),
    limit: z.number().int().optional(),
    source: SearchProviderNameSchema.optional().describe("Filter by provider"),
  },
  async ({ search_id, limit, source }) => {
    const results = listResults(search_id, { limit, source });
    return {
      content: [{ type: "text" as const, text: JSON.stringify(results, null, 2) }],
    };
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
        { type: "text" as const, text: result ? JSON.stringify(result, null, 2) : "Not found" },
      ],
    };
  },
);

server.tool(
  "search_results_fts",
  "Full-text search across all stored search results",
  {
    query: z.string().describe("FTS query"),
    limit: z.number().int().optional(),
  },
  async ({ query, limit }) => {
    const results = searchResultsFts(query, { limit });
    return {
      content: [{ type: "text" as const, text: JSON.stringify(results, null, 2) }],
    };
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
    return {
      content: [{ type: "text" as const, text: JSON.stringify(saved, null, 2) }],
    };
  },
);

server.tool(
  "list_saved_searches",
  "List all saved searches",
  {},
  async () => {
    const saved = listSavedSearches();
    return {
      content: [{ type: "text" as const, text: JSON.stringify(saved, null, 2) }],
    };
  },
);

server.tool(
  "run_saved_search",
  "Re-execute a saved search",
  { id: z.string().describe("Saved search ID") },
  async ({ id }) => {
    const saved = getSavedSearch(id);
    if (!saved) return { content: [{ type: "text" as const, text: "Saved search not found" }] };
    updateSavedSearchLastRun(id);
    const response = await unifiedSearch(saved.query, {
      providers: saved.providers.length > 0 ? saved.providers : undefined,
      options: saved.options,
    });
    return {
      content: [
        {
          type: "text" as const,
          text: JSON.stringify(
            { searchId: response.search.id, resultCount: response.results.length, results: response.results },
            null,
            2,
          ),
        },
      ],
    };
  },
);

server.tool(
  "delete_saved_search",
  "Delete a saved search",
  { id: z.string().describe("Saved search ID") },
  async ({ id }) => {
    const ok = deleteSavedSearch(id);
    return { content: [{ type: "text" as const, text: ok ? "Deleted" : "Not found" }] };
  },
);

// --- Providers ---
server.tool(
  "list_providers",
  "List all search providers with their configuration and status",
  {},
  async () => {
    const providers = listProviders();
    const withStatus = providers.map((p) => ({
      ...p,
      configured: isProviderConfigured(p),
    }));
    return {
      content: [{ type: "text" as const, text: JSON.stringify(withStatus, null, 2) }],
    };
  },
);

server.tool(
  "enable_provider",
  "Enable a search provider",
  { name: SearchProviderNameSchema.describe("Provider name") },
  async ({ name }) => {
    const ok = enableProvider(name);
    return { content: [{ type: "text" as const, text: ok ? `${name} enabled` : "Not found" }] };
  },
);

server.tool(
  "disable_provider",
  "Disable a search provider",
  { name: SearchProviderNameSchema.describe("Provider name") },
  async ({ name }) => {
    const ok = disableProvider(name);
    return { content: [{ type: "text" as const, text: ok ? `${name} disabled` : "Not found" }] };
  },
);

server.tool(
  "configure_provider",
  "Update provider configuration",
  {
    name: SearchProviderNameSchema.describe("Provider name"),
    api_key_env: z.string().optional().describe("Environment variable for API key"),
    rate_limit: z.number().int().optional().describe("Requests per minute"),
  },
  async ({ name, api_key_env, rate_limit }) => {
    const updates: Record<string, unknown> = {};
    if (api_key_env) updates.apiKeyEnv = api_key_env;
    if (rate_limit) updates.rateLimit = rate_limit;
    const ok = updateProvider(name, updates);
    return { content: [{ type: "text" as const, text: ok ? `${name} updated` : "Not found" }] };
  },
);

// --- Profiles ---
server.tool(
  "list_profiles",
  "List all search profiles",
  {},
  async () => {
    const profiles = listProfiles();
    return {
      content: [{ type: "text" as const, text: JSON.stringify(profiles, null, 2) }],
    };
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
    return {
      content: [{ type: "text" as const, text: JSON.stringify(profile, null, 2) }],
    };
  },
);

server.tool(
  "delete_profile",
  "Delete a search profile",
  { id: z.string().describe("Profile ID") },
  async ({ id }) => {
    const ok = deleteProfile(id);
    return { content: [{ type: "text" as const, text: ok ? "Deleted" : "Not found" }] };
  },
);

server.tool(
  "search_with_profile",
  "Search using a named profile",
  {
    profile: z.string().describe("Profile name"),
    query: z.string().describe("Search query"),
    limit: z.number().int().optional(),
  },
  async ({ profile, query, limit }) => {
    const response = await unifiedSearch(query, {
      profile,
      options: limit ? { limit } : undefined,
    });
    return {
      content: [
        {
          type: "text" as const,
          text: JSON.stringify(
            { searchId: response.search.id, resultCount: response.results.length, results: response.results },
            null,
            2,
          ),
        },
      ],
    };
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
  },
  async ({ url, provider, language }) => {
    const available = await isTranscriberAvailable();
    if (!available) {
      return {
        content: [
          {
            type: "text" as const,
            text: "Transcriber not available. Ensure microservice-transcriber is running on port 19600 or installed as CLI.",
          },
        ],
      };
    }
    const result = await transcribeVideo(url, { provider, language });
    return {
      content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
    };
  },
);

server.tool(
  "search_transcripts",
  "Search within transcribed YouTube content",
  { query: z.string().describe("Search query for transcripts") },
  async ({ query }) => {
    const results = await searchTranscripts(query);
    return {
      content: [{ type: "text" as const, text: JSON.stringify(results, null, 2) }],
    };
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
    return {
      content: [{ type: "text" as const, text: JSON.stringify(stats, null, 2) }],
    };
  },
);

// --- Config ---
server.tool(
  "get_config",
  "Get current search configuration",
  {},
  async () => {
    const config = getConfig();
    return {
      content: [{ type: "text" as const, text: JSON.stringify(config, null, 2) }],
    };
  },
);

server.tool(
  "set_config",
  "Update search configuration",
  {
    default_limit: z.number().int().optional(),
    dedup: z.boolean().optional(),
    max_concurrent: z.number().int().optional(),
    default_profile: z.string().nullable().optional(),
  },
  async (updates) => {
    const config = setConfig({
      ...(updates.default_limit !== undefined && { defaultLimit: updates.default_limit }),
      ...(updates.dedup !== undefined && { dedup: updates.dedup }),
      ...(updates.max_concurrent !== undefined && { maxConcurrent: updates.max_concurrent }),
      ...(updates.default_profile !== undefined && { defaultProfile: updates.default_profile }),
    });
    return {
      content: [{ type: "text" as const, text: JSON.stringify(config, null, 2) }],
    };
  },
);

// --- Start server ---
const transport = new StdioServerTransport();
await server.connect(transport);
