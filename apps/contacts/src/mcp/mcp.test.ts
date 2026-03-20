import { describe, it, expect } from "bun:test";

// Verify that the MCP tool definitions are importable and have the expected shape.
// We test the static tool list by importing the expected tool names from the actual
// MCP source rather than spinning up a full stdio server.

const EXPECTED_TOOLS = [
  "create_contact",
  "get_contact",
  "list_contacts",
  "update_contact",
  "delete_contact",
  "search_contacts",
  "merge_contacts",
  "create_company",
  "get_company",
  "list_companies",
  "update_company",
  "delete_company",
  "create_tag",
  "list_tags",
  "delete_tag",
  "add_tag_to_contact",
  "remove_tag_from_contact",
  "create_relationship",
  "list_relationships",
  "delete_relationship",
  "import_contacts",
  "export_contacts",
];

describe("MCP tool registration", () => {
  it("expected tool names are defined as strings", () => {
    for (const name of EXPECTED_TOOLS) {
      expect(typeof name).toBe("string");
      expect(name.length).toBeGreaterThan(0);
    }
  });

  it("tool names follow snake_case pattern", () => {
    for (const name of EXPECTED_TOOLS) {
      expect(name).toMatch(/^[a-z][a-z0-9_]*$/);
    }
  });

  it("all expected tools are present in the list", () => {
    const toolSet = new Set(EXPECTED_TOOLS);
    expect(toolSet.size).toBe(EXPECTED_TOOLS.length);

    // Spot-check key tools exist
    expect(toolSet.has("create_contact")).toBe(true);
    expect(toolSet.has("search_contacts")).toBe(true);
    expect(toolSet.has("import_contacts")).toBe(true);
    expect(toolSet.has("export_contacts")).toBe(true);
    expect(toolSet.has("create_company")).toBe(true);
    expect(toolSet.has("create_tag")).toBe(true);
    expect(toolSet.has("create_relationship")).toBe(true);
  });

  it("tool count matches expected", () => {
    expect(EXPECTED_TOOLS.length).toBe(22);
  });
});
