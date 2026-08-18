// OpenAPI 3 document for the search-serve REST API (hasna.service_contract.v1
// sdk generatedFrom target). Describes the routes actually implemented in
// serve.ts: /api/search, /api/search/{provider}, /api/searches,
// /api/searches/{id}, /api/saved-searches, /api/providers, /api/profiles,
// /api/stats, /api/transcribe, /api/config, /api/find, /api/index,
// /api/index/{ref}, /api/export/{id}.

import { getPackageVersion } from "../version.js";

export interface OpenApiDocument {
  openapi: string;
  info: { title: string; version: string; description?: string };
  paths: Record<string, Record<string, unknown>>;
}

export function buildOpenApiDocument(): OpenApiDocument {
  return {
    openapi: "3.0.3",
    info: {
      title: "Hasna Search API",
      version: getPackageVersion(),
      description:
        "Unified search over local file index, web providers, and YouTube transcription. " +
        "Bearer token auth is required when search-serve is bound to a non-loopback host.",
    },
    paths: {
      "/api/search": {
        get: {
          summary: "Run a unified search",
          parameters: [
            { name: "q", in: "query", required: true, schema: { type: "string" } },
            { name: "providers", in: "query", required: false, schema: { type: "string" } },
            { name: "limit", in: "query", required: false, schema: { type: "integer" } },
            { name: "profile", in: "query", required: false, schema: { type: "string" } },
            { name: "smart", in: "query", required: false, schema: { type: "string" } },
          ],
          responses: { "200": { description: "Unified search response" } },
        },
      },
      "/api/search/{provider}": {
        get: {
          summary: "Run a single-provider search",
          parameters: [
            { name: "provider", in: "path", required: true, schema: { type: "string" } },
            { name: "q", in: "query", required: true, schema: { type: "string" } },
            { name: "limit", in: "query", required: false, schema: { type: "integer" } },
          ],
          responses: { "200": { description: "Provider search response" }, "404": { description: "Unknown provider" } },
        },
      },
      "/api/searches": {
        get: {
          summary: "List search history",
          parameters: [
            { name: "limit", in: "query", required: false, schema: { type: "integer" } },
            { name: "offset", in: "query", required: false, schema: { type: "integer" } },
            { name: "q", in: "query", required: false, schema: { type: "string" } },
          ],
          responses: { "200": { description: "Paginated search history" } },
        },
      },
      "/api/searches/{id}": {
        get: {
          summary: "Get one search and its results",
          parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
          responses: { "200": { description: "Search detail" }, "404": { description: "Search not found" } },
        },
      },
      "/api/saved-searches": {
        get: { summary: "List saved searches", responses: { "200": { description: "Saved searches" } } },
        post: { summary: "Create a saved search", responses: { "201": { description: "Created saved search" } } },
      },
      "/api/providers": {
        get: { summary: "List configured search providers", responses: { "200": { description: "Provider list" } } },
      },
      "/api/profiles": {
        get: { summary: "List search profiles", responses: { "200": { description: "Profile list" } } },
        post: { summary: "Create a search profile", responses: { "201": { description: "Created profile" } } },
      },
      "/api/stats": {
        get: { summary: "Search statistics", responses: { "200": { description: "Stats" } } },
      },
      "/api/transcribe": {
        post: { summary: "Transcribe a video", responses: { "200": { description: "Transcript" } } },
      },
      "/api/config": {
        get: { summary: "Read server configuration", responses: { "200": { description: "Config" } } },
        put: { summary: "Update server configuration", responses: { "200": { description: "Updated config" } } },
      },
      "/api/find": {
        get: {
          summary: "Local file search",
          parameters: [
            { name: "q", in: "query", required: true, schema: { type: "string" } },
            { name: "kind", in: "query", required: false, schema: { type: "string" } },
          ],
          responses: { "200": { description: "Local file matches" } },
        },
      },
      "/api/index": {
        get: { summary: "List indexed roots", responses: { "200": { description: "Roots" } } },
        post: { summary: "Add and index a root", responses: { "201": { description: "Root created" } } },
      },
      "/api/index/{ref}": {
        put: { summary: "Re-index a root (or 'all')", parameters: [{ name: "ref", in: "path", required: true, schema: { type: "string" } }], responses: { "200": { description: "Index stats" } } },
        delete: { summary: "Remove a root", parameters: [{ name: "ref", in: "path", required: true, schema: { type: "string" } }], responses: { "200": { description: "Removed" } } },
      },
      "/api/export/{id}": {
        get: {
          summary: "Export search results",
          parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
          responses: { "200": { description: "Export payload" } },
        },
      },
    },
  };
}
