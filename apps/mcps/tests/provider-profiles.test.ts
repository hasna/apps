import { afterAll, beforeEach, describe, expect, it } from "bun:test";
import "./setup";
import { getDb, closeDb } from "../src/lib/db";
import {
  disableProviderProfile,
  enableProviderProfile,
  getProviderProfile,
  listProviderProfiles,
  removeProviderProfile,
  upsertProviderProfile,
} from "../src/lib/provider-profiles";
import { PG_MIGRATIONS } from "../src/lib/pg-migrations";

function clearDb() {
  const db = getDb();
  db.exec("DELETE FROM provider_profiles");
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
      authType: "oauth2",
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
      authType: "oauth2",
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
    expect(joined).toContain("CREATE TABLE IF NOT EXISTS provider_profiles");
    expect(joined).toContain("display_name TEXT NOT NULL");
    expect(joined).toContain("install_fallback TEXT NOT NULL DEFAULT '{}'");
    expect(joined).toContain(`provenance TEXT NOT NULL DEFAULT '{"source":"manual"}'`);
    expect(joined).toContain("idx_provider_profiles_enabled");
  });
});
