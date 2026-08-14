import { describe, expect, it } from "bun:test";
import "./setup";
import { buildMcpsStatus } from "../src/lib/status";
import type { McpServerEntry, McpSource, ProviderProfile } from "../src/types";

const server: McpServerEntry = {
  id: "private-server",
  name: "Private Server",
  description: "contains private deployment details",
  command: "/private/bin/server",
  args: ["--token", "raw-token-value"],
  env: {
    API_TOKEN: "raw-env-secret",
  },
  credentialRefs: {
    API_TOKEN: {
      source: "env",
      name: "PRIVATE_API_TOKEN",
      required: true,
    },
  },
  transport: "stdio",
  url: "https://private-mcp.internal/sse",
  source: "local",
  enabled: true,
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-01T00:00:00Z",
  last_connected_at: null,
  last_error: "raw stack trace with raw-token-value",
};

const source: McpSource = {
  id: "private-source",
  name: "Private Source",
  type: "mcp-registry",
  url: "https://registry.internal/private",
  description: "private source",
  enabled: false,
  created_at: "2026-01-01T00:00:00Z",
};

const providerProfile: ProviderProfile = {
  id: "private-provider",
  displayName: "Private Provider",
  description: null,
  endpoint: "https://provider.internal/mcp",
  transport: "streamable-http",
  fallbackEndpoints: [],
  authType: "bearer_token",
  authMetadata: { bearerToken: "required" },
  scopes: ["private.read"],
  tokenMode: "user",
  installFallback: {
    command: "/private/fallback",
    env: { API_TOKEN: "raw-provider-token" },
  },
  docsUrl: "https://docs.internal",
  safety: {},
  provenance: { source: "manual" },
  enabled: true,
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-01T00:00:00Z",
};

describe("buildMcpsStatus", () => {
  it("reports registry and cache metadata without tool configs, tokens, URLs, or paths", () => {
    const status = buildMcpsStatus({
      servers: [server],
      sources: [source],
      providerProfiles: [providerProfile],
      machines: [{ enabled: true }, { enabled: false }],
      toolCounts: new Map([["private-server", 3]]),
      cacheDirectoryPresent: true,
      packageVersion: "0.0.0-test",
    });

    expect(status).toMatchObject({
      service: "mcps",
      schemaVersion: "1.0",
      package: {
        name: "@hasna/mcps",
        version: "0.0.0-test",
      },
      registry: {
        sources: {
          total: 1,
          enabled: 0,
          disabled: 1,
          byType: {
            "mcp-registry": 1,
          },
        },
        providerProfiles: {
          total: 1,
          enabled: 1,
          disabled: 0,
        },
      },
      cache: {
        directoryPresent: true,
        cachedTools: 3,
        serversWithCachedTools: 1,
      },
      counts: {
        servers: {
          total: 1,
          enabled: 1,
          disabled: 0,
          withLastError: 1,
        },
        machines: {
          total: 2,
          enabled: 1,
          disabled: 1,
        },
      },
      health: {
        status: "warn",
        hasRegisteredServers: true,
        hasServerErrors: true,
      },
      safety: {
        includesToolConfigs: false,
        includesCommands: false,
        includesArgs: false,
        includesEnvValues: false,
        includesCredentialRefs: false,
        includesTokens: false,
        includesPrivatePaths: false,
        includesRegistryUrls: false,
        statusOutputIsMetadataOnly: true,
      },
    });

    const serialized = JSON.stringify(status);
    expect(serialized).not.toContain("/private/bin/server");
    expect(serialized).not.toContain("raw-token-value");
    expect(serialized).not.toContain("raw-env-secret");
    expect(serialized).not.toContain("PRIVATE_API_TOKEN");
    expect(serialized).not.toContain("private-mcp.internal");
    expect(serialized).not.toContain("registry.internal");
    expect(serialized).not.toContain("provider.internal");
    expect(serialized).not.toContain("raw-provider-token");
    expect(serialized).not.toContain("raw stack trace");
  });
});
