import { describe, test, expect } from "bun:test";

describe("library exports", () => {
  test("exports all registry types and functions", async () => {
    const lib = await import("./index.js");

    // Registry exports
    expect(lib.CONNECTORS).toBeDefined();
    expect(Array.isArray(lib.CONNECTORS)).toBe(true);
    expect(lib.CONNECTORS.length).toBeGreaterThan(0);

    expect(lib.CATEGORIES).toBeDefined();
    expect(Array.isArray(lib.CATEGORIES)).toBe(true);
    expect(lib.CATEGORIES.length).toBe(11);

    expect(typeof lib.getConnector).toBe("function");
    expect(typeof lib.getConnectorsByCategory).toBe("function");
    expect(typeof lib.searchConnectors).toBe("function");
    expect(typeof lib.loadConnectorVersions).toBe("function");
  });

  test("exports all installer types and functions", async () => {
    const lib = await import("./index.js");

    expect(typeof lib.installConnector).toBe("function");
    expect(typeof lib.installConnectors).toBe("function");
    expect(typeof lib.getInstalledConnectors).toBe("function");
    expect(typeof lib.removeConnector).toBe("function");
    expect(typeof lib.connectorExists).toBe("function");
    expect(typeof lib.getConnectorPath).toBe("function");
    expect(typeof lib.getConnectorDocs).toBe("function");
  });

  test("registry functions work through library exports", async () => {
    const lib = await import("./index.js");

    // getConnector
    const stripe = lib.getConnector("stripe");
    expect(stripe).toBeDefined();
    expect(stripe!.name).toBe("stripe");
    expect(stripe!.displayName).toBe("Stripe");

    // getConnectorsByCategory
    const aiConnectors = lib.getConnectorsByCategory("AI & ML");
    expect(aiConnectors.length).toBeGreaterThan(0);
    for (const c of aiConnectors) {
      expect(c.category).toBe("AI & ML");
    }

    // searchConnectors
    const results = lib.searchConnectors("payment");
    expect(results.some((c) => c.name === "stripe")).toBe(true);
  });

  test("installer functions work through library exports", async () => {
    const lib = await import("./index.js");

    // connectorExists
    expect(lib.connectorExists("anthropic")).toBe(true);
    expect(lib.connectorExists("nonexistent-xyz-abc")).toBe(false);

    // getConnectorPath
    const path = lib.getConnectorPath("figma");
    expect(path).toContain("connect-figma");

    // getConnectorDocs
    const docs = lib.getConnectorDocs("stripe");
    expect(docs).not.toBeNull();
    expect(docs!.overview).toContain("Stripe");
  });

  test("CONNECTORS array has correct shape", async () => {
    const lib = await import("./index.js");

    for (const c of lib.CONNECTORS) {
      expect(c).toHaveProperty("name");
      expect(c).toHaveProperty("displayName");
      expect(c).toHaveProperty("description");
      expect(c).toHaveProperty("category");
      expect(c).toHaveProperty("tags");
      expect(typeof c.name).toBe("string");
      expect(typeof c.displayName).toBe("string");
      expect(typeof c.description).toBe("string");
      expect(typeof c.category).toBe("string");
      expect(Array.isArray(c.tags)).toBe(true);
    }
  });

  test("CATEGORIES includes all expected categories", async () => {
    const lib = await import("./index.js");
    const categories = lib.CATEGORIES as readonly string[];

    expect(categories).toContain("AI & ML");
    expect(categories).toContain("Developer Tools");
    expect(categories).toContain("Design & Content");
    expect(categories).toContain("Communication");
    expect(categories).toContain("Social Media");
    expect(categories).toContain("Commerce & Finance");
    expect(categories).toContain("Google Workspace");
    expect(categories).toContain("Data & Analytics");
    expect(categories).toContain("Business Tools");
    expect(categories).toContain("Patents & IP");
    expect(categories).toContain("Advertising");
  });

  test("loadConnectorVersions populates version fields", async () => {
    const lib = await import("./index.js");
    lib.loadConnectorVersions();

    const withVersions = lib.CONNECTORS.filter((c) => c.version);
    expect(withVersions.length).toBeGreaterThan(0);

    for (const c of withVersions) {
      expect(c.version).toMatch(/^\d+\.\d+\.\d+/);
    }
  });

  test("getInstalledConnectors returns an array", async () => {
    const lib = await import("./index.js");
    const installed = lib.getInstalledConnectors();
    expect(Array.isArray(installed)).toBe(true);
  });
});
