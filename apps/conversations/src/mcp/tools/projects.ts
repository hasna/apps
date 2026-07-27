/**
 * Project tools: create_project, list_projects, get_project, update_project, delete_project
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { getStore } from "../../lib/store/index.js";
import { identityFor } from "../identity.js";
import { compactWindowedProjects, jsonText } from "../compact.js";

export function registerProjectTools(server: McpServer): void {
  // Bound to this connection: see ../identity.ts.
  const resolveIdentity = identityFor(server);

  server.registerTool("create_project", {
    description: "Create a project for agent collaboration.",
    inputSchema: {
      name: z.string(),
      from: z.string().optional(),
      description: z.string().optional(),
      path: z.string().optional(),
      repository: z.string().optional(),
      tags: z.string().optional(),
      metadata: z.string().optional(),
      settings: z.string().optional(),
    },
  }, async (args: Record<string, any>) => {
    const store = getStore();
    const { from: fromParam, name, description, path, repository, tags, metadata, settings } = args;
    const agent = resolveIdentity(fromParam);

    let parsedTags: string[] | undefined;
    if (tags) {
      try {
        parsedTags = JSON.parse(tags);
      } catch {
        return {
          content: [{ type: "text", text: "invalid tags JSON (expected array)" }],
          isError: true,
        };
      }
    }

    let parsedMetadata: Record<string, unknown> | undefined;
    if (metadata) {
      try {
        parsedMetadata = JSON.parse(metadata);
      } catch {
        return {
          content: [{ type: "text", text: "invalid JSON" }],
          isError: true,
        };
      }
    }

    let parsedSettings: Record<string, unknown> | undefined;
    if (settings) {
      try {
        parsedSettings = JSON.parse(settings);
      } catch {
        return {
          content: [{ type: "text", text: "invalid JSON" }],
          isError: true,
        };
      }
    }

    try {
      const project = await store.createProject({
        name,
        created_by: agent,
        description,
        path,
        repository,
        tags: parsedTags,
        metadata: parsedMetadata,
        settings: parsedSettings,
      });

      return {
        content: [{ type: "text", text: JSON.stringify(project) }],
      };
    } catch (e: any) {
      if (e.message?.includes("UNIQUE constraint")) {
        return {
          content: [{ type: "text", text: `project "${name}" already exists` }],
          isError: true,
        };
      }
      return {
        content: [{ type: "text", text: e.message }],
        isError: true,
      };
    }
  });

  server.registerTool("list_projects", {
    description: "List all projects.",
    inputSchema: {
      status: z.string().optional(),
      limit: z.coerce.number().optional(),
      cursor: z.coerce.number().optional(),
      verbose: z.coerce.boolean().optional().describe("Return legacy raw project array"),
    },
  }, async (args: Record<string, any>) => {
    const store = getStore();
    const { status } = args;
    const projects = await store.listProjects(status ? { status } : undefined);

    return {
      content: [{ type: "text", text: jsonText(args.verbose ? projects : compactWindowedProjects(projects, args)) }],
    };
  });

  server.registerTool("get_project", {
    description: "Get a project by ID or name.",
    inputSchema: {
      id: z.string(),
    },
  }, async ({ id }) => {
    const store = getStore();
    // Try by ID first, then by name
    let project = await store.getProject(id);
    if (!project) {
      project = await store.getProjectByName(id);
    }

    if (!project) {
      return {
        content: [{ type: "text", text: `project "${id}" not found` }],
        isError: true,
      };
    }

    return {
      content: [{ type: "text", text: JSON.stringify(project) }],
    };
  });

  server.registerTool("update_project", {
    description: "Update project fields by ID.",
    inputSchema: {
      id: z.string(),
      name: z.string().optional(),
      description: z.string().optional(),
      path: z.string().optional(),
      status: z.string().optional(),
      repository: z.string().optional(),
      tags: z.string().optional(),
      metadata: z.string().optional(),
      settings: z.string().optional(),
    },
  }, async (args: Record<string, any>) => {
    const store = getStore();
    const { id, name, description, path, status, repository, tags, metadata, settings } = args;
    const updates: Record<string, unknown> = {};
    if (name !== undefined) updates.name = name;
    if (description !== undefined) updates.description = description;
    if (path !== undefined) updates.path = path;
    if (status !== undefined) updates.status = status;
    if (repository !== undefined) updates.repository = repository;

    if (tags) {
      try {
        updates.tags = JSON.parse(tags);
      } catch {
        return {
          content: [{ type: "text", text: "invalid tags JSON" }],
          isError: true,
        };
      }
    }
    if (metadata) {
      try {
        updates.metadata = JSON.parse(metadata);
      } catch {
        return {
          content: [{ type: "text", text: "invalid JSON" }],
          isError: true,
        };
      }
    }
    if (settings) {
      try {
        updates.settings = JSON.parse(settings);
      } catch {
        return {
          content: [{ type: "text", text: "invalid JSON" }],
          isError: true,
        };
      }
    }

    try {
      const project = await store.updateProject(id, updates as any);
      return {
        content: [{ type: "text", text: JSON.stringify(project) }],
      };
    } catch (e: any) {
      return {
        content: [{ type: "text", text: e.message }],
        isError: true,
      };
    }
  });

  server.registerTool("delete_project", {
    description: "Delete a project permanently.",
    inputSchema: {
      id: z.string(),
    },
  }, async ({ id }) => {
    const store = getStore();
    try {
      const deleted = await store.deleteProject(id);
      if (!deleted) {
        return {
          content: [{ type: "text", text: `project "${id}" not found` }],
          isError: true,
        };
      }
      return {
        content: [{ type: "text", text: JSON.stringify({ id, deleted: true }) }],
      };
    } catch (e: any) {
      return {
        content: [{ type: "text", text: e.message }],
        isError: true,
      };
    }
  });
}
