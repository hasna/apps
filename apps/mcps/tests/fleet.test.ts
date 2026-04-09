import { afterAll, beforeEach, describe, expect, it } from "bun:test";
import "./setup";
import { addMachine, getMachine } from "../src/lib/machines";
import { closeDb, getDb } from "../src/lib/db";
import { listHasnaMcpCatalog, runFleetHealthCheck, runFleetInstall } from "../src/lib/fleet";

const NPM_SEARCH_URL = "https://registry.npmjs.org/-/v1/search?text=%40hasna&size=250";
const NPM_REGISTRY_BASE = "https://registry.npmjs.org";

const SEARCH_PAYLOAD = {
  objects: [
    {
      package: {
        name: "@hasna/mcps",
        version: "0.0.10",
        description: "Meta MCP registry",
        keywords: ["mcp", "registry"],
      },
    },
    {
      package: {
        name: "@hasna/open-mementos",
        version: "1.0.0",
        description: "Memory service",
        keywords: ["memory"],
      },
    },
    {
      package: {
        name: "@hasna/monitor-mcp",
        version: "1.2.3",
        description: "Machine monitoring MCP",
        keywords: ["mcp", "monitoring"],
      },
    },
  ],
};

const PACKAGE_METADATA: Record<string, unknown> = {
  "@hasna/mcps": {
    "dist-tags": { latest: "0.0.11" },
    versions: {
      "0.0.11": {
        description: "Meta MCP registry",
        keywords: ["mcp", "registry"],
        bin: {
          mcps: "bin/index.js",
          "mcps-mcp": "bin/mcp.js",
        },
        repository: { url: "https://github.com/hasna/open-mcps" },
      },
    },
  },
  "@hasna/monitor-mcp": {
    "dist-tags": { latest: "1.2.3" },
    versions: {
      "1.2.3": {
        description: "Machine monitoring MCP",
        keywords: ["mcp", "monitoring"],
        bin: "bin/index.js",
        repository: { url: "https://github.com/hasna/open-monitor" },
      },
    },
  },
};

function clearDb() {
  const db = getDb();
  db.exec("DELETE FROM machines");
}

function createFetchMock(): typeof fetch {
  return (async (input: RequestInfo | URL) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    if (url === NPM_SEARCH_URL) {
      return new Response(JSON.stringify(SEARCH_PAYLOAD), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }

    const pkgName = decodeURIComponent(url.replace(`${NPM_REGISTRY_BASE}/`, ""));
    const payload = PACKAGE_METADATA[pkgName];
    if (payload) {
      return new Response(JSON.stringify(payload), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }

    return new Response("not found", { status: 404, statusText: "Not Found" });
  }) as typeof fetch;
}

describe("fleet", () => {
  beforeEach(() => {
    clearDb();
  });

  afterAll(() => {
    closeDb();
  });

  it("discovers only @hasna MCP packages and picks the MCP binary", async () => {
    const catalog = await listHasnaMcpCatalog({
      fetchImpl: createFetchMock(),
      refresh: true,
    });

    expect(catalog.map((entry) => entry.name)).toEqual(["@hasna/mcps", "@hasna/monitor-mcp"]);
    expect(catalog[0]?.mcpBin).toBe("mcps-mcp");
    expect(catalog[1]?.mcpBin).toBe("monitor-mcp");
  });

  it("reports package drift and updates machine runtime metadata", async () => {
    addMachine({ id: "spark01", name: "spark01", host: "spark01" });

    const reports = await runFleetHealthCheck(
      { refreshCatalog: true },
      {
        fetchImpl: createFetchMock(),
        now: () => new Date("2026-04-08T12:00:00.000Z"),
        runRemoteScript: async () => ({
          exitCode: 0,
          stderr: "",
          stdout: JSON.stringify({
            hostname: "spark01",
            platform: "linux",
            arch: "arm64",
            nodePath: "/usr/bin/node",
            npmPath: "/usr/bin/npm",
            bunPath: "/usr/bin/bun",
            installedPackages: {
              "@hasna/mcps": "0.0.10",
            },
            handshakes: {
              "@hasna/mcps": {
                binaryName: "mcps-mcp",
                binaryPath: "/usr/local/bin/mcps-mcp",
                ok: true,
                error: null,
              },
            },
          }),
        }),
      },
    );

    expect(reports).toHaveLength(1);
    expect(reports[0]?.summary).toEqual({
      total: 2,
      current: 0,
      missing: 1,
      outdated: 1,
      unresponsive: 0,
    });
    expect(reports[0]?.packages.map((pkg) => [pkg.packageName, pkg.drift])).toEqual([
      ["@hasna/mcps", "outdated"],
      ["@hasna/monitor-mcp", "missing"],
    ]);

    const machine = getMachine("spark01");
    expect(machine?.last_seen_at).toBe("2026-04-08T12:00:00.000Z");
    expect(machine?.npm_path).toBe("/usr/bin/npm");
    expect(machine?.bun_path).toBe("/usr/bin/bun");
  });

  it("installs missing or outdated packages across machines", async () => {
    addMachine({ id: "spark01", name: "spark01", host: "spark01" });

    const scripts: string[] = [];
    const reports = await runFleetInstall(
      { refreshCatalog: true },
      {
        fetchImpl: createFetchMock(),
        now: () => new Date("2026-04-08T13:00:00.000Z"),
        runRemoteScript: async (_machine, script) => {
          scripts.push(script);
          if (script.includes("protocolVersion")) {
            return {
              exitCode: 0,
              stderr: "",
              stdout: JSON.stringify({
                hostname: "spark01",
                platform: "linux",
                arch: "arm64",
                nodePath: "/usr/bin/node",
                npmPath: "/usr/bin/npm",
                bunPath: "/usr/bin/bun",
                installedPackages: {
                  "@hasna/mcps": "0.0.10",
                },
                handshakes: {
                  "@hasna/mcps": {
                    binaryName: "mcps-mcp",
                    binaryPath: "/usr/local/bin/mcps-mcp",
                    ok: false,
                    error: "initialize timeout",
                  },
                },
              }),
            };
          }

          return {
            exitCode: 0,
            stderr: "",
            stdout: JSON.stringify({
              installer: "bun",
              bunPath: "/usr/bin/bun",
              npmPath: "/usr/bin/npm",
              results: [
                {
                  packageName: "@hasna/mcps",
                  requestedVersion: "0.0.11",
                  installer: "bun",
                  command: "/usr/bin/bun install -g @hasna/mcps@0.0.11",
                  success: true,
                  stdout: "installed",
                  stderr: "",
                },
                {
                  packageName: "@hasna/monitor-mcp",
                  requestedVersion: "1.2.3",
                  installer: "bun",
                  command: "/usr/bin/bun install -g @hasna/monitor-mcp@1.2.3",
                  success: true,
                  stdout: "installed",
                  stderr: "",
                },
              ],
            }),
          };
        },
      },
    );

    expect(scripts).toHaveLength(2);
    expect(reports).toHaveLength(1);
    expect(reports[0]?.installer).toBe("bun");
    expect(reports[0]?.attempted).toBe(2);
    expect(reports[0]?.results.every((result) => result.success)).toBe(true);
    expect(getMachine("spark01")?.last_seen_at).toBe("2026-04-08T13:00:00.000Z");
  });

  it("fails early when the requested packages are not in the catalog", async () => {
    addMachine({ id: "spark01", name: "spark01", host: "spark01" });

    await expect(
      runFleetHealthCheck(
        { refreshCatalog: true, packages: ["@hasna/does-not-exist"] },
        {
          fetchImpl: createFetchMock(),
          runRemoteScript: async () => ({
            exitCode: 0,
            stderr: "",
            stdout: "{}",
          }),
        },
      ),
    ).rejects.toThrow("No matching @hasna MCP packages found");
  });
});
