import { describe, test, expect } from "bun:test";
import {
  INTERNAL_CONNECTOR_DEFINITIONS,
  getInternalConnectorDefinition,
  hasInternalConnectorDefinition,
  listInternalConnectorCatalogEntries,
  listInternalConnectorDefinitions,
} from "./builtins.js";

describe("builtins", () => {
  test("registers migrated internal connectors", () => {
    const names = INTERNAL_CONNECTOR_DEFINITIONS.map((definition) => definition.meta.name).sort();
    expect(names).toEqual(["github", "googledrive", "imessage", "stripe"]);
  });

  test("listInternalConnectorDefinitions returns all migrated connectors", () => {
    const definitions = listInternalConnectorDefinitions();
    expect(definitions.length).toBe(4);
    expect(definitions.every((definition) => definition.meta.displayName.length > 0)).toBe(true);
  });

  test("listInternalConnectorCatalogEntries exposes catalog metadata", () => {
    const entries = listInternalConnectorCatalogEntries();
    expect(entries.map((entry) => entry.name).sort()).toEqual(["github", "googledrive", "imessage", "stripe"]);
    for (const entry of entries) {
      expect(entry.category).toBeTruthy();
      expect(Array.isArray(entry.tags)).toBe(true);
    }
  });

  test("getInternalConnectorDefinition resolves known connectors", () => {
    const stripe = getInternalConnectorDefinition("stripe");
    expect(stripe?.meta.displayName).toBe("Stripe");
    expect(stripe?.commandRuntime?.commands.length).toBeGreaterThan(0);
    expect(Object.keys(stripe?.operations ?? {}).length).toBeGreaterThan(0);
  });

  test("hasInternalConnectorDefinition distinguishes internal vs legacy-only connectors", () => {
    expect(hasInternalConnectorDefinition("github")).toBe(true);
    expect(hasInternalConnectorDefinition("gmail")).toBe(false);
    expect(hasInternalConnectorDefinition("nonexistent-xyz")).toBe(false);
  });

  test("internal github runtime exposes repo and user commands", () => {
    const github = getInternalConnectorDefinition("github");
    const commandNames = github?.commandRuntime?.commands.map((command) => command.name) ?? [];
    expect(commandNames).toContain("repo");
    expect(commandNames).toContain("user");
  });

  test("internal imessage runtime exposes health and message commands", () => {
    const imessage = getInternalConnectorDefinition("imessage");
    const commandNames = imessage?.commandRuntime?.commands.map((command) => command.name) ?? [];
    expect(commandNames).toContain("health");
    expect(commandNames).toContain("message");
  });
});
