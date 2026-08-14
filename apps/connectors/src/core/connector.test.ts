import { describe, test, expect } from "bun:test";
import { z } from "zod";
import {
  ConnectorDefinitionError,
  ConnectorOperationNotFoundError,
  defineConnector,
  executeConnectorOperation,
  getConnectorOperation,
  listConnectorOperations,
} from "./index.js";

describe("defineConnector", () => {
  test("normalizes operations and preserves metadata", () => {
    const connector = defineConnector({
      meta: {
        name: "github",
        displayName: "GitHub",
        description: "GitHub API",
        category: "Developer Tools",
        tags: ["git", "code"],
      },
      auth: {
        type: "bearer_token",
        supportsProfiles: true,
        fields: [{ key: "token", env: "GITHUB_TOKEN", required: true, secret: true }],
      },
      commandRuntime: {
        commands: [
          { name: "user", summary: "User information" },
          { name: "repo", summary: "Manage repositories" },
        ],
      },
      operations: {
        repos_list: {
          summary: "List repositories",
          execute: () => [],
        },
      },
    });

    expect(connector.meta.name).toBe("github");
    expect(connector.auth.fields).toHaveLength(1);
    expect(connector.commandRuntime?.commands.map((command) => command.name)).toEqual([
      "repo",
      "user",
    ]);
    expect(connector.operations.repos_list.name).toBe("repos_list");
  });

  test("rejects invalid connector names", () => {
    expect(() =>
      defineConnector({
        meta: {
          name: "GitHub",
          displayName: "GitHub",
          description: "GitHub API",
          category: "Developer Tools",
        },
        auth: { type: "bearer_token" },
        operations: {
          repos_list: {
            summary: "List repositories",
            execute: () => [],
          },
        },
      })
    ).toThrow(ConnectorDefinitionError);
  });

  test("rejects duplicate effective operation names", () => {
    expect(() =>
      defineConnector({
        meta: {
          name: "github",
          displayName: "GitHub",
          description: "GitHub API",
          category: "Developer Tools",
        },
        auth: { type: "bearer_token" },
        operations: {
          repos_list: {
            name: "repos",
            summary: "List repositories",
            execute: () => [],
          },
          repos_search: {
            name: "repos",
            summary: "Search repositories",
            execute: () => [],
          },
        },
      })
    ).toThrow("Duplicate operation name 'repos'");
  });
});

describe("connector operation helpers", () => {
  const connector = defineConnector({
    meta: {
      name: "github",
      displayName: "GitHub",
      description: "GitHub API",
      category: "Developer Tools",
    },
    auth: {
      type: "bearer_token",
      supportsProfiles: true,
      fields: [{ key: "token", env: "GITHUB_TOKEN", required: true, secret: true }],
    },
    createContext: ({ credentials, profile }) => ({
      token: credentials?.token,
      profile,
    }),
    operations: {
      repos_get: {
        summary: "Get a repository",
        inputSchema: z.object({
          owner: z.string(),
          repo: z.string(),
        }),
        execute: ({ context }, input) => ({
          slug: `${input.owner}/${input.repo}`,
          token: context.token,
          profile: context.profile,
        }),
      },
      users_me: {
        name: "users:me",
        summary: "Get the current user",
        execute: () => ({ login: "octocat" }),
      },
    },
  });

  test("lists operations in stable order", () => {
    expect(listConnectorOperations(connector).map((operation) => operation.name)).toEqual([
      "repos_get",
      "users:me",
    ]);
  });

  test("finds operations by effective name", () => {
    const operation = getConnectorOperation(connector, "users:me");
    expect(operation?.summary).toBe("Get the current user");
  });

  test("executes operations with parsed input and context", async () => {
    const result = await executeConnectorOperation(connector, {
      operation: "repos_get",
      input: { owner: "hasna", repo: "connectors" },
      credentials: { token: "secret" },
      profile: "work",
    });

    expect(result).toEqual({
      slug: "hasna/connectors",
      token: "secret",
      profile: "work",
    });
  });

  test("throws when operation is missing", async () => {
    await expect(
      executeConnectorOperation(connector, { operation: "repos_delete" })
    ).rejects.toThrow(ConnectorOperationNotFoundError);
  });

  test("validates input when a schema exists", async () => {
    await expect(
      executeConnectorOperation(connector, {
        operation: "repos_get",
        input: { owner: "hasna" },
      })
    ).rejects.toThrow();
  });
});
