import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { program } from "../src/cli/index.js";
import { createCatalogHandler } from "../src/server/index.js";
import { CatalogStore } from "../src/store.js";

// hasna.contract.json is read by deployment, gateway, and security tooling that
// never opens this repository. If it under-declares a surface, those consumers
// are wrong in the dangerous direction — "catalog opens no listener" while
// `catalog serve --host 0.0.0.0` publishes an unauthenticated read API. These
// tests bind each declaration to the code that has to back it.

interface ServiceEndpoint {
  method: string;
  path: string;
}

interface ServiceSurface {
  name: string;
  kind?: "api" | "sdk" | "mcp" | "cli";
  status: "supported" | "deferred" | "unsupported";
  bin?: string;
  mcpBin?: string;
  authMode: string;
  deferReason?: string;
  health?: ServiceEndpoint;
  readiness?: ServiceEndpoint;
  version?: ServiceEndpoint;
}

const repoRoot = join(import.meta.dir, "..");
const manifest = JSON.parse(readFileSync(join(repoRoot, "hasna.contract.json"), "utf8")) as {
  bins: string[];
  serviceSurfaces: ServiceSurface[];
};
const pkg = JSON.parse(readFileSync(join(repoRoot, "package.json"), "utf8")) as {
  bin: Record<string, string>;
};

function surfaceOfKind(kind: ServiceSurface["kind"]): ServiceSurface | undefined {
  return manifest.serviceSurfaces.find((surface) => surface.kind === kind);
}

function handler(): (request: Request) => Response {
  return createCatalogHandler({ store: new CatalogStore({ dbPath: ":memory:" }) });
}

describe("hasna.contract.json declares the surfaces this repo ships", () => {
  it("declares exactly the bins package.json publishes", () => {
    expect([...manifest.bins].sort()).toEqual(Object.keys(pkg.bin).sort());
  });

  it("binds the cli and mcp surfaces to real bins", () => {
    expect(surfaceOfKind("cli")?.bin).toBe("catalog");
    expect(surfaceOfKind("mcp")?.mcpBin).toBe("catalog-mcp");
  });

  it("declares an api surface because `catalog serve` opens a network listener", () => {
    expect(program.commands.map((command) => command.name())).toContain("serve");
    expect(surfaceOfKind("api")).toBeDefined();
  });

  it("records the api surface as unauthenticated, because the handler is", () => {
    // Every route answers without a credential, so any authMode other than
    // "none" would overstate what `catalog serve` protects.
    const responses = ["/health", "/v1/apps", "/v1/search?q=x"].map((path) =>
      handler()(new Request(`http://localhost${path}`)).status
    );
    expect(responses.every((status) => status !== 401 && status !== 403)).toBe(true);
    expect(surfaceOfKind("api")?.authMode).toBe("none");
  });

  it("only declares HTTP probes the server actually answers", () => {
    const api = surfaceOfKind("api");
    for (const key of ["health", "readiness", "version"] as const) {
      const endpoint = api?.[key];
      if (!endpoint) continue;
      const response = handler()(new Request(`http://localhost${endpoint.path}`));
      expect([key, endpoint.method, response.status]).toEqual([key, "GET", 200]);
    }
  });

  it("keeps every non-supported surface honest about why", () => {
    for (const surface of manifest.serviceSurfaces) {
      if (surface.status === "supported") continue;
      expect([surface.name, (surface.deferReason ?? "").length > 0]).toEqual([surface.name, true]);
    }
  });

  it("would require serve bin, readiness, and version before an api surface may claim support", () => {
    // The contract schema demands bin + health + readiness + version from a
    // supported API surface. Catalog ships none of the last three, so this
    // guards a future flip of status to "supported" without the endpoints.
    for (const surface of manifest.serviceSurfaces) {
      if (surface.kind !== "api" || surface.status !== "supported") continue;
      expect(Object.keys(pkg.bin)).toContain(surface.bin!);
      expect([surface.health?.path, surface.readiness?.path, surface.version?.path]).toEqual([
        "/health",
        "/ready",
        "/version",
      ]);
      for (const path of ["/health", "/ready", "/version"]) {
        expect([path, handler()(new Request(`http://localhost${path}`)).status]).toEqual([path, 200]);
      }
    }
  });
});
