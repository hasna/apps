import { afterAll, beforeEach, describe, expect, it } from "bun:test";
import "./setup";
import { getDb, closeDb } from "../src/lib/db";
import {
  disableProviderProfile,
  enableProviderProfile,
  getProviderProfile,
  installProviderProfile,
  listProviderProfiles,
  removeProviderProfile,
  searchProviderProfiles,
  upsertProviderProfile,
} from "../src/lib/provider-profiles";
import { getServer } from "../src/lib/registry";
import { PG_MIGRATIONS } from "../src/lib/pg-migrations";

function clearDb() {
  const db = getDb();
  db.exec("DELETE FROM provider_profiles");
  db.exec("DELETE FROM servers");
}

describe("provider profiles", () => {
  beforeEach(() => {
    clearDb();
  });

  afterAll(() => {
    closeDb();
  });

  it("stores the curated provider profile fields needed by the platform gateway", () => {
    const profile = upsertProviderProfile({
      id: "notion",
      displayName: "Notion",
      description: "Workspace docs and databases",
      endpoint: "https://mcp.notion.com/mcp",
      transport: "streamable-http",
      fallbackEndpoints: [
        {
          transport: "sse",
          url: "https://mcp.notion.com/sse",
          notes: "Fallback for clients that do not support Streamable HTTP",
        },
      ],
      authType: "oauth2",
      authMetadata: {
        oauthVersion: "2.0",
        pkce: true,
        dynamicClientRegistration: true,
        bearerToken: "none",
      },
      scopes: ["read_content", "read_content", "update_content"],
      tokenMode: "workspace",
      installFallback: {
        command: "npx",
        args: ["-y", "@notionhq/notion-mcp-server"],
        packageName: "@notionhq/notion-mcp-server",
        registryId: "io.notion/notion-mcp-server",
      },
      docsUrl: "https://developers.notion.com/docs/mcp",
      safety: {
        requiresApproval: true,
        sensitiveScopes: ["update_content"],
        dataClasses: ["documents", "databases"],
      },
      provenance: {
        source: "curated",
        sourceUrl: "https://developers.notion.com/docs/mcp",
        packageName: "@notionhq/notion-mcp-server",
        verifiedAt: "2026-05-10",
      },
    });

    expect(profile).toMatchObject({
      id: "notion",
      displayName: "Notion",
      description: "Workspace docs and databases",
      endpoint: "https://mcp.notion.com/mcp",
      transport: "streamable-http",
      fallbackEndpoints: [
        {
          transport: "sse",
          url: "https://mcp.notion.com/sse",
          notes: "Fallback for clients that do not support Streamable HTTP",
        },
      ],
      authType: "oauth2",
      authMetadata: {
        oauthVersion: "2.0",
        pkce: true,
        dynamicClientRegistration: true,
        bearerToken: "none",
      },
      scopes: ["read_content", "update_content"],
      tokenMode: "workspace",
      docsUrl: "https://developers.notion.com/docs/mcp",
      enabled: true,
    });
    expect(profile.installFallback).toEqual({
      command: "npx",
      args: ["-y", "@notionhq/notion-mcp-server"],
      packageName: "@notionhq/notion-mcp-server",
      registryId: "io.notion/notion-mcp-server",
    });
    expect(profile.authMetadata).toEqual({
      oauthVersion: "2.0",
      pkce: true,
      dynamicClientRegistration: true,
      bearerToken: "none",
    });
    expect(profile.safety.requiresApproval).toBe(true);
    expect(profile.provenance.source).toBe("curated");
    expect(profile.created_at).toBeTruthy();
    expect(profile.updated_at).toBeTruthy();

    expect(getProviderProfile("notion")).toEqual(profile);
  });

  it("upserts provider profiles by id", () => {
    upsertProviderProfile({
      id: "linear",
      displayName: "Linear",
      endpoint: "https://mcp.linear.app/mcp",
      transport: "streamable-http",
      authType: "oauth2",
      tokenMode: "user",
      provenance: { source: "curated" },
    });

    const updated = upsertProviderProfile({
      id: "linear",
      displayName: "Linear MCP",
      endpoint: "https://mcp.linear.app/mcp",
      transport: "streamable-http",
      authType: "oauth2",
      scopes: ["read", "write"],
      tokenMode: "workspace",
      provenance: { source: "curated", repositoryUrl: "https://github.com/linear/linear" },
      enabled: false,
    });

    expect(updated.displayName).toBe("Linear MCP");
    expect(updated.scopes).toEqual(["read", "write"]);
    expect(updated.tokenMode).toBe("workspace");
    expect(updated.enabled).toBe(false);
    expect(listProviderProfiles()).toHaveLength(1);
  });

  it("lists profiles sorted by display name and can filter disabled profiles", () => {
    upsertProviderProfile({
      id: "z-provider",
      displayName: "Z Provider",
      transport: "stdio",
      authType: "api_key",
      tokenMode: "service",
      provenance: { source: "manual" },
    });
    upsertProviderProfile({
      id: "a-provider",
      displayName: "A Provider",
      transport: "sse",
      authType: "bearer_token",
      tokenMode: "user",
      provenance: { source: "manual" },
      enabled: false,
    });

    expect(listProviderProfiles().map((profile) => profile.id)).toEqual(["a-provider", "z-provider"]);
    expect(listProviderProfiles({ enabledOnly: true }).map((profile) => profile.id)).toEqual(["z-provider"]);
  });

  it("searches profiles by id, display name, description, and endpoint", () => {
    upsertProviderProfile({
      id: "linear",
      displayName: "Linear",
      description: "Issue tracking",
      endpoint: "https://mcp.linear.app/mcp",
      transport: "streamable-http",
      authType: "oauth2",
      provenance: { source: "curated" },
    });

    expect(searchProviderProfiles("linear").map((profile) => profile.id)).toEqual(["linear"]);
    expect(searchProviderProfiles("issue tracking").map((profile) => profile.id)).toEqual(["linear"]);
    expect(searchProviderProfiles("mcp.linear.app").map((profile) => profile.id)).toEqual(["linear"]);
    expect(searchProviderProfiles("notion")).toEqual([]);
  });

  it("installs provider profiles as direct remote MCP servers by default", () => {
    upsertProviderProfile({
      id: "notion",
      displayName: "Notion",
      endpoint: "https://mcp.notion.com/mcp",
      transport: "streamable-http",
      authType: "oauth2",
      installFallback: {
        command: "npx",
        args: ["-y", "mcp-remote", "https://mcp.notion.com/sse", "--transport", "sse-only"],
        url: "https://mcp.notion.com/sse",
      },
      provenance: { source: "curated" },
    });

    const server = installProviderProfile("notion");
    expect(server.id).toBe("notion");
    expect(server.transport).toBe("streamable-http");
    expect(server.url).toBe("https://mcp.notion.com/mcp");
    expect(server.source).toBe("provider-profile");
    expect(getServer("notion")).toEqual(server);
  });

  it("installs provider profile fallback commands when requested", () => {
    upsertProviderProfile({
      id: "notion",
      displayName: "Notion",
      endpoint: "https://mcp.notion.com/mcp",
      transport: "streamable-http",
      authType: "oauth2",
      installFallback: {
        command: "npx",
        args: ["-y", "mcp-remote", "https://mcp.notion.com/sse", "--transport", "sse-only"],
        url: "https://mcp.notion.com/sse",
      },
      provenance: { source: "curated" },
    });

    expect(() => installProviderProfile("notion", { name: "Notion Fallback", useFallback: true })).toThrow(
      /local stdio command approval is required/i,
    );

    const server = installProviderProfile("notion", {
      name: "Notion Fallback",
      useFallback: true,
      localCommandConsent: { approved: true, source: "test" },
    });
    expect(server.id).toBe("notion-fallback");
    expect(server.transport).toBe("stdio");
    expect(server.args).toEqual(["-y", "mcp-remote", "https://mcp.notion.com/sse", "--transport", "sse-only"]);
    expect(server.url).toBe("https://mcp.notion.com/sse");
  });

  it("enables, disables, and removes profiles", () => {
    upsertProviderProfile({
      id: "github",
      displayName: "GitHub",
      transport: "stdio",
      authType: "api_key",
      provenance: { source: "manual" },
    });

    expect(disableProviderProfile("github").enabled).toBe(false);
    expect(enableProviderProfile("github").enabled).toBe(true);
    removeProviderProfile("github");
    expect(getProviderProfile("github")).toBeNull();
  });

  it("validates stable ids and enum values before storing", () => {
    expect(() =>
      upsertProviderProfile({
        id: "Bad ID",
        displayName: "Bad",
        transport: "stdio",
        authType: "none",
        provenance: { source: "manual" },
      })
    ).toThrow("Provider profile id must be lowercase kebab-case");

    expect(() =>
      upsertProviderProfile({
        id: "bad-transport",
        displayName: "Bad",
        transport: "websocket" as "stdio",
        authType: "none",
        provenance: { source: "manual" },
      })
    ).toThrow("Unknown provider profile transport");
  });

  it("keeps PostgreSQL migrations in parity with SQLite storage", () => {
    const joined = PG_MIGRATIONS.join("\n");
    expect(joined).toContain("CREATE EXTENSION IF NOT EXISTS pgcrypto");
    expect(joined).toContain("credential_refs TEXT NOT NULL DEFAULT '{}'");
    expect(joined).toContain("CREATE TABLE IF NOT EXISTS machines");
    expect(joined).toContain("idx_machines_enabled");
    expect(joined).toContain("CREATE TABLE IF NOT EXISTS provider_profiles");
    expect(joined).toContain("display_name TEXT NOT NULL");
    expect(joined).toContain("fallback_endpoints TEXT NOT NULL DEFAULT '[]'");
    expect(joined).toContain("auth_metadata TEXT NOT NULL DEFAULT '{}'");
    expect(joined).toContain("install_fallback TEXT NOT NULL DEFAULT '{}'");
    expect(joined).toContain(`provenance TEXT NOT NULL DEFAULT '{"source":"manual"}'`);
    expect(joined).toContain("idx_provider_profiles_enabled");
  });
});
