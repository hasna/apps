import { describe, test, expect } from "bun:test";
import { defineConnector } from "./connector.js";
import { ConnectorDefinitionError } from "./errors.js";
import {
  createConnectorDefinitionRegistry,
  getConnectorDefinition,
  hasConnectorDefinition,
  listConnectorCatalogEntries,
  listConnectorDefinitions,
} from "./registry.js";

describe("createConnectorDefinitionRegistry", () => {
  const github = defineConnector({
    meta: {
      name: "github",
      displayName: "GitHub",
      description: "GitHub API",
      category: "Developer Tools",
      version: "0.1.0",
      tags: ["git", "repos"],
    },
    auth: {
      type: "bearer_token",
      supportsProfiles: true,
      fields: [{ key: "token", env: "GITHUB_TOKEN", required: true, secret: true }],
    },
    operations: {
      repos_list: {
        summary: "List repositories",
        execute: () => [],
      },
      users_me: {
        summary: "Current user",
        execute: () => ({ login: "octocat" }),
      },
    },
  });

  const stripe = defineConnector({
    meta: {
      name: "stripe",
      displayName: "Stripe",
      description: "Stripe API",
      category: "Commerce & Finance",
      tags: ["payments"],
    },
    auth: {
      type: "api_key",
      fields: [{ key: "apiKey", env: "STRIPE_API_KEY", required: true, secret: true }],
    },
    operations: {
      customers_list: {
        summary: "List customers",
        execute: () => [],
      },
    },
  });

  test("indexes definitions by name in sorted order", () => {
    const registry = createConnectorDefinitionRegistry([stripe, github]);
    expect(listConnectorDefinitions(registry).map((definition) => definition.meta.name)).toEqual([
      "github",
      "stripe",
    ]);
    expect(getConnectorDefinition(registry, "github")?.meta.displayName).toBe("GitHub");
    expect(hasConnectorDefinition(registry, "stripe")).toBe(true);
  });

  test("rejects duplicate connector names", () => {
    expect(() =>
      createConnectorDefinitionRegistry([github, github])
    ).toThrow(ConnectorDefinitionError);
  });

  test("produces catalog entries for migrated connectors", () => {
    const registry = createConnectorDefinitionRegistry([github, stripe]);
    expect(listConnectorCatalogEntries(registry)).toEqual([
      {
        name: "github",
        displayName: "GitHub",
        description: "GitHub API",
        category: "Developer Tools",
        version: "0.1.0",
        tags: ["git", "repos"],
        authType: "bearer_token",
        supportsProfiles: true,
        operationCount: 2,
      },
      {
        name: "stripe",
        displayName: "Stripe",
        description: "Stripe API",
        category: "Commerce & Finance",
        version: undefined,
        tags: ["payments"],
        authType: "api_key",
        supportsProfiles: false,
        operationCount: 1,
      },
    ]);
  });
});
