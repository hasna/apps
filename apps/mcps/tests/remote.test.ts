import { describe, it, expect, beforeEach, afterAll, mock, spyOn } from "bun:test";
import "./setup";
import { searchRegistry, getRegistryServer, installFromRegistry } from "../src/lib/remote";
import { getServer, removeServer } from "../src/lib/registry";
import { getDb, closeDb } from "../src/lib/db";

// Mock registry API response
const MOCK_REGISTRY = {
  servers: [
    {
      server: {
        name: "test/server-alpha",
        description: "Alpha server for testing",
        repository: { url: "https://github.com/test/alpha", source: "github" },
        version: "1.0.0",
        packages: [
          {
            registryType: "npm",
            identifier: "@test/server-alpha",
            transport: { type: "stdio" },
          },
        ],
      },
      _meta: {},
    },
    {
      server: {
        name: "test/server-beta",
        description: "Beta server with SSE",
        repository: { url: "https://github.com/test/beta", source: "github" },
        version: "2.0.0",
        packages: [
          {
            registryType: "oci",
            identifier: "docker.io/test/beta:2.0.0",
            transport: { type: "sse" },
          },
        ],
      },
      _meta: {},
    },
    {
      server: {
        name: "test/server-gamma",
        description: "Gamma with no packages",
        repository: { url: "https://github.com/test/gamma", source: "github" },
        version: "0.1.0",
      },
      _meta: {},
    },
  ],
};

function mockFetchSuccess() {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () =>
    new Response(JSON.stringify(MOCK_REGISTRY), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    })) as any;
  return () => {
    globalThis.fetch = originalFetch;
  };
}

function mockFetchError(status: number) {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () =>
    new Response("error", { status, statusText: "Server Error" })) as any;
  return () => {
    globalThis.fetch = originalFetch;
  };
}

function clearDb() {
  const db = getDb();
  db.exec("DELETE FROM tool_cache");
  db.exec("DELETE FROM servers");
}

describe("remote", () => {
  beforeEach(() => {
    clearDb();
  });

  afterAll(() => {
    closeDb();
  });

  // ── searchRegistry ──

  describe("searchRegistry", () => {
    it("returns matching servers by name", async () => {
      const restore = mockFetchSuccess();
      try {
        const results = await searchRegistry("alpha");
        expect(results).toHaveLength(1);
        expect(results[0].name).toBe("test/server-alpha");
        expect(results[0].id).toBe("test/server-alpha");
      } finally {
        restore();
      }
    });

    it("returns matching servers by description", async () => {
      const restore = mockFetchSuccess();
      try {
        const results = await searchRegistry("SSE");
        expect(results).toHaveLength(1);
        expect(results[0].name).toBe("test/server-beta");
      } finally {
        restore();
      }
    });

    it("is case-insensitive", async () => {
      const restore = mockFetchSuccess();
      try {
        const results = await searchRegistry("ALPHA");
        expect(results).toHaveLength(1);
      } finally {
        restore();
      }
    });

    it("returns multiple matches", async () => {
      const restore = mockFetchSuccess();
      try {
        const results = await searchRegistry("server");
        expect(results).toHaveLength(3);
      } finally {
        restore();
      }
    });

    it("returns empty array when no matches", async () => {
      const restore = mockFetchSuccess();
      try {
        const results = await searchRegistry("nonexistent");
        expect(results).toHaveLength(0);
      } finally {
        restore();
      }
    });

    it("throws on API error", async () => {
      const restore = mockFetchError(500);
      try {
        await expect(searchRegistry("test")).rejects.toThrow("Registry API error");
      } finally {
        restore();
      }
    });
  });

  // ── getRegistryServer ──

  describe("getRegistryServer", () => {
    it("returns server by ID", async () => {
      const restore = mockFetchSuccess();
      try {
        const server = await getRegistryServer("test/server-alpha");
        expect(server).not.toBeNull();
        expect(server!.name).toBe("test/server-alpha");
        expect(server!.packages).toHaveLength(1);
      } finally {
        restore();
      }
    });

    it("returns null for non-existent ID", async () => {
      const restore = mockFetchSuccess();
      try {
        const server = await getRegistryServer("non/existent");
        expect(server).toBeNull();
      } finally {
        restore();
      }
    });

    it("throws on API error", async () => {
      const restore = mockFetchError(403);
      try {
        await expect(getRegistryServer("test")).rejects.toThrow("Registry API error");
      } finally {
        restore();
      }
    });
  });

  // ── installFromRegistry ──

  describe("installFromRegistry", () => {
    it("requires local stdio command consent for npm package servers", async () => {
      const restore = mockFetchSuccess();
      try {
        await expect(installFromRegistry("test/server-alpha")).rejects.toThrow(
          /local stdio command approval is required/i,
        );
      } finally {
        restore();
      }
    });

    it("installs an npm package server after local stdio consent", async () => {
      const restore = mockFetchSuccess();
      try {
        const entry = await installFromRegistry("test/server-alpha", {
          localCommandConsent: { approved: true, source: "test" },
        });
        expect(entry.name).toBe("test/server-alpha");
        expect(entry.command).toBe("npx");
        expect(entry.args).toEqual(["-y", "@test/server-alpha"]);
        expect(entry.source).toBe("registry");
        expect(entry.transport).toBe("stdio");
        expect(entry.description).toBe("Alpha server for testing");

        // Verify it's in the database
        const fromDb = getServer(entry.id);
        expect(fromDb).not.toBeNull();
        expect(fromDb!.source).toBe("registry");
      } finally {
        restore();
      }
    });

    it("installs a non-npm package server (uses identifier as command)", async () => {
      const restore = mockFetchSuccess();
      try {
        const entry = await installFromRegistry("test/server-beta");
        expect(entry.command).toBe("docker.io/test/beta:2.0.0");
        expect(entry.args).toEqual([]);
        expect(entry.transport).toBe("sse");
      } finally {
        restore();
      }
    });

    it("handles server with no packages", async () => {
      const restore = mockFetchSuccess();
      try {
        const entry = await installFromRegistry("test/server-gamma", {
          localCommandConsent: { approved: true, source: "test" },
        });
        expect(entry.command).toBe("npx");
        expect(entry.args).toEqual([]);
      } finally {
        restore();
      }
    });

    it("throws for non-existent registry server", async () => {
      const restore = mockFetchSuccess();
      try {
        await expect(installFromRegistry("non/existent")).rejects.toThrow(
          'Server "non/existent" not found in registry'
        );
      } finally {
        restore();
      }
    });
  });
});
