import { describe, expect, it } from "bun:test";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createCatalogMcpServer } from "../src/mcp/index.js";
import { createCatalogHandler } from "../src/server/index.js";
import { CatalogStore } from "../src/store.js";
import { VERSION } from "../src/version.js";

// Every consumer-facing surface must agree on the shipped version: package.json
// (the publish truth), the VERSION constant, the CLI, /health, and the MCP
// server. They previously drifted (package.json 0.2.0 vs constant 0.1.0), so
// each surface is bound to package.json individually.

const repoRoot = join(import.meta.dir, "..");
const pkgVersion = (JSON.parse(readFileSync(join(repoRoot, "package.json"), "utf8")) as { version: string }).version;

describe("version binding", () => {
  it("the VERSION constant matches package.json", () => {
    expect(VERSION).toBe(pkgVersion);
  });

  it("the CLI --version prints exactly package.json's version", () => {
    const result = spawnSync("bun", [join(repoRoot, "src", "cli", "index.ts"), "--version"], {
      cwd: repoRoot,
      encoding: "utf8",
    });
    expect(result.status).toBe(0);
    expect(result.stdout.trim()).toBe(pkgVersion);
    expect(result.stderr).toBe("");
  });

  it("/health reports the same version", async () => {
    const handler = createCatalogHandler({ store: new CatalogStore({ dbPath: ":memory:" }) });
    const body = (await handler(new Request("http://localhost/health")).json()) as { version: string };
    expect(body.version).toBe(pkgVersion);
  });

  it("the MCP server advertises the same version", async () => {
    const server = createCatalogMcpServer();
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: "catalog-version-test", version: "0.0.0" });
    await server.connect(serverTransport);
    await client.connect(clientTransport);
    expect(client.getServerVersion()?.version).toBe(pkgVersion);
    await client.close();
  });

  it("an explicitly supplied MCP server version is preserved", async () => {
    const server = createCatalogMcpServer({ name: "custom", version: "9.9.9" });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: "catalog-version-test", version: "0.0.0" });
    await server.connect(serverTransport);
    await client.connect(clientTransport);
    expect(client.getServerVersion()).toEqual({ name: "custom", version: "9.9.9" });
    await client.close();
  });
});
