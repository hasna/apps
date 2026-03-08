#!/usr/bin/env bun
/**
 * MCP server for conversations.
 * Exposes tools for sending, reading, and managing messages, spaces, and projects between agents.
 *
 * Usage:
 *   conversations mcp          # Start MCP server on stdio
 *   conversations-mcp          # Direct binary
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { sendMessage, readMessages, markRead, markSpaceRead, getMessageById, searchMessages, markAllRead, exportMessages, deleteMessage, editMessage, pinMessage, unpinMessage, getPinnedMessages } from "../lib/messages.js";
import { listSessions } from "../lib/sessions.js";
import { createSpace, updateSpace, archiveSpace, unarchiveSpace, listSpaces, getSpace, joinSpace, leaveSpace, getSpaceMembers } from "../lib/spaces.js";
import { createProject, listProjects, getProject, getProjectByName, updateProject, deleteProject } from "../lib/projects.js";
import { resolveIdentity } from "../lib/identity.js";
import { heartbeat, listAgents } from "../lib/presence.js";

export const server = new McpServer({
  name: "conversations",
  version: "0.1.0",
});

// ---- DM Tools ----

server.registerTool("send_message", {
  title: "Send Message",
  description: "Send a direct message to another agent. Pass 'from' to identify yourself, or it falls back to CONVERSATIONS_AGENT_ID env var.",
  inputSchema: {
    from: z.string().optional().describe("Your agent ID (e.g. 'claude-1', 'assistant'). Falls back to CONVERSATIONS_AGENT_ID env var."),
    to: z.string().describe("Recipient agent ID"),
    content: z.string().describe("Message content"),
    session_id: z.string().optional().describe("Session ID (auto-generated if omitted)"),
    priority: z.enum(["low", "normal", "high", "urgent"]).optional().describe("Message priority"),
    working_dir: z.string().optional().describe("Working directory context"),
    repository: z.string().optional().describe("Repository context"),
    branch: z.string().optional().describe("Branch context"),
    metadata: z.string().optional().describe("JSON metadata string"),
  },
}, async ({ from: fromParam, to, content, session_id, priority, working_dir, repository, branch, metadata }) => {
  const from = resolveIdentity(fromParam);
  let parsedMetadata: Record<string, unknown> | undefined;
  if (metadata) {
    try {
      parsedMetadata = JSON.parse(metadata);
    } catch {
      return {
        content: [{ type: "text", text: "Invalid metadata JSON." }],
        isError: true,
      };
    }
  }

  const msg = sendMessage({
    from,
    to,
    content,
    session_id,
    priority,
    working_dir,
    repository,
    branch,
    metadata: parsedMetadata,
  });

  return {
    content: [{ type: "text", text: JSON.stringify(msg, null, 2) }],
  };
});

server.registerTool("read_messages", {
  title: "Read Messages",
  description: "Read messages with optional filters. Returns messages sorted by time.",
  inputSchema: {
    session_id: z.string().optional().describe("Filter by session ID"),
    from: z.string().optional().describe("Filter by sender agent ID"),
    to: z.string().optional().describe("Filter by recipient agent ID"),
    space: z.string().optional().describe("Filter by space name"),
    since: z.string().optional().describe("Messages after this ISO timestamp"),
    limit: z.number().optional().describe("Max messages to return"),
    unread_only: z.boolean().optional().describe("Only return unread messages"),
  },
}, async (opts) => {
  const messages = readMessages(opts);

  return {
    content: [{ type: "text", text: JSON.stringify(messages, null, 2) }],
  };
});

server.registerTool("list_sessions", {
  title: "List Sessions",
  description: "List conversation sessions, optionally filtered to a specific agent.",
  inputSchema: {
    agent: z.string().optional().describe("Filter sessions involving this agent"),
  },
}, async ({ agent }) => {
  const sessions = listSessions(agent);

  return {
    content: [{ type: "text", text: JSON.stringify(sessions, null, 2) }],
  };
});

server.registerTool("reply", {
  title: "Reply to Message",
  description: "Reply to a message by its ID. Automatically uses the same session and sends to the original sender.",
  inputSchema: {
    from: z.string().optional().describe("Your agent ID. Falls back to CONVERSATIONS_AGENT_ID env var."),
    message_id: z.number().describe("ID of the message to reply to"),
    content: z.string().describe("Reply content"),
    priority: z.enum(["low", "normal", "high", "urgent"]).optional().describe("Message priority"),
  },
}, async ({ from: fromParam, message_id, content, priority }) => {
  const original = getMessageById(message_id);
  if (!original) {
    return {
      content: [{ type: "text", text: `Message #${message_id} not found` }],
      isError: true,
    };
  }

  const from = resolveIdentity(fromParam);
  const space =
    original.space ||
    (original.session_id?.startsWith("space:") ? original.session_id.slice(6) : undefined);
  const to = space
    ? space
    : (original.from_agent === from ? original.to_agent : original.from_agent);
  const msg = sendMessage({
    from,
    to,
    content,
    session_id: original.session_id,
    priority,
    space,
  });

  return {
    content: [{ type: "text", text: JSON.stringify(msg, null, 2) }],
  };
});

server.registerTool("mark_read", {
  title: "Mark Read",
  description: "Mark message IDs as read for the current agent. Set 'all' to true to mark all unread messages as read.",
  inputSchema: {
    from: z.string().optional().describe("Your agent ID. Falls back to CONVERSATIONS_AGENT_ID env var."),
    ids: z.array(z.number()).optional().describe("Message IDs to mark as read"),
    all: z.boolean().optional().describe("Mark all unread messages as read"),
  },
}, async ({ from: fromParam, ids, all }) => {
  const agent = resolveIdentity(fromParam);
  let count: number;

  if (all) {
    count = markAllRead(agent);
  } else if (ids && ids.length > 0) {
    count = markRead(ids, agent);
  } else {
    return {
      content: [{ type: "text", text: "Provide message IDs or set 'all' to true." }],
      isError: true,
    };
  }

  return {
    content: [{ type: "text", text: JSON.stringify({ marked_read: count }, null, 2) }],
  };
});

server.registerTool("search_messages", {
  title: "Search Messages",
  description: "Full-text search across message content. Returns matching messages ordered by newest first.",
  inputSchema: {
    query: z.string().describe("Search query string"),
    space: z.string().optional().describe("Filter by space name"),
    from: z.string().optional().describe("Filter by sender agent ID"),
    to: z.string().optional().describe("Filter by recipient agent ID"),
    limit: z.number().optional().describe("Max results to return (default 50)"),
  },
}, async ({ query, space, from, to, limit }) => {
  const messages = searchMessages({ query, space, from, to, limit });

  return {
    content: [{ type: "text", text: JSON.stringify(messages, null, 2) }],
  };
});

server.registerTool("export_messages", {
  title: "Export Messages",
  description: "Export messages as JSON or CSV with optional filters.",
  inputSchema: {
    space: z.string().optional().describe("Filter by space name"),
    session_id: z.string().optional().describe("Filter by session ID"),
    from: z.string().optional().describe("Filter by sender agent ID"),
    since: z.string().optional().describe("Messages after this ISO date"),
    until: z.string().optional().describe("Messages before this ISO date"),
    format: z.enum(["json", "csv"]).optional().describe("Output format (default: json)"),
  },
}, async ({ space, session_id, from, since, until, format }) => {
  const result = exportMessages({ space, session_id, from, since, until, format });

  return {
    content: [{ type: "text", text: result }],
  };
});

// ---- Space Tools ----

server.registerTool("create_space", {
  title: "Create Space",
  description: "Create a new space. The creator is auto-joined. Spaces can be nested (max 3 levels) and associated with a project.",
  inputSchema: {
    from: z.string().optional().describe("Your agent ID. Falls back to CONVERSATIONS_AGENT_ID env var."),
    name: z.string().describe("Space name (e.g. 'deployments', 'code-review')"),
    description: z.string().optional().describe("Space description"),
    parent_id: z.string().optional().describe("Parent space name for nesting (max 3 levels deep)"),
    project_id: z.string().optional().describe("Project ID to associate this space with"),
  },
}, async ({ from: fromParam, name, description, parent_id, project_id }) => {
  const agent = resolveIdentity(fromParam);
  try {
    const sp = createSpace(name, agent, { description, parent_id, project_id });
    return {
      content: [{ type: "text", text: JSON.stringify(sp, null, 2) }],
    };
  } catch (e: any) {
    if (e.message?.includes("UNIQUE constraint")) {
      return {
        content: [{ type: "text", text: `Space #${name} already exists` }],
        isError: true,
      };
    }
    return {
      content: [{ type: "text", text: e.message }],
      isError: true,
    };
  }
});

server.registerTool("list_spaces", {
  title: "List Spaces",
  description: "List all available spaces with member and message counts. Can filter by project or parent. Archived spaces are excluded by default.",
  inputSchema: {
    project_id: z.string().optional().describe("Filter by project ID"),
    parent_id: z.string().optional().describe("Filter by parent space name. Use 'null' for top-level only."),
    include_archived: z.boolean().optional().describe("Include archived spaces (default: false)"),
  },
}, async ({ project_id, parent_id, include_archived }) => {
  const opts: { project_id?: string; parent_id?: string | null; include_archived?: boolean } = {};
  if (project_id) opts.project_id = project_id;
  if (parent_id === "null") {
    opts.parent_id = null;
  } else if (parent_id) {
    opts.parent_id = parent_id;
  }
  if (include_archived) opts.include_archived = true;

  const spaces = listSpaces(opts);

  return {
    content: [{ type: "text", text: JSON.stringify(spaces, null, 2) }],
  };
});

server.registerTool("send_to_space", {
  title: "Send to Space",
  description: "Send a message to a space. All members can see it.",
  inputSchema: {
    from: z.string().optional().describe("Your agent ID. Falls back to CONVERSATIONS_AGENT_ID env var."),
    space: z.string().describe("Space name"),
    content: z.string().describe("Message content"),
    priority: z.enum(["low", "normal", "high", "urgent"]).optional().describe("Message priority"),
  },
}, async ({ from: fromParam, space, content, priority }) => {
  const from = resolveIdentity(fromParam);

  const sp = getSpace(space);
  if (!sp) {
    return {
      content: [{ type: "text", text: `Space #${space} not found` }],
      isError: true,
    };
  }

  const msg = sendMessage({
    from,
    to: space,
    content,
    space,
    session_id: `space:${space}`,
    priority,
  });

  return {
    content: [{ type: "text", text: JSON.stringify(msg, null, 2) }],
  };
});

server.registerTool("read_space", {
  title: "Read Space",
  description: "Read messages from a space.",
  inputSchema: {
    space: z.string().describe("Space name"),
    since: z.string().optional().describe("Messages after this ISO timestamp"),
    limit: z.number().optional().describe("Max messages to return"),
  },
}, async ({ space, since, limit }) => {
  const messages = readMessages({ space, since, limit });

  return {
    content: [{ type: "text", text: JSON.stringify(messages, null, 2) }],
  };
});

server.registerTool("join_space", {
  title: "Join Space",
  description: "Join a space to receive messages.",
  inputSchema: {
    from: z.string().optional().describe("Your agent ID. Falls back to CONVERSATIONS_AGENT_ID env var."),
    space: z.string().describe("Space name to join"),
  },
}, async ({ from: fromParam, space }) => {
  const agent = resolveIdentity(fromParam);
  const ok = joinSpace(space, agent);

  if (!ok) {
    return {
      content: [{ type: "text", text: `Space #${space} not found` }],
      isError: true,
    };
  }

  return {
    content: [{ type: "text", text: JSON.stringify({ space, agent, joined: true }, null, 2) }],
  };
});

server.registerTool("leave_space", {
  title: "Leave Space",
  description: "Leave a space.",
  inputSchema: {
    from: z.string().optional().describe("Your agent ID. Falls back to CONVERSATIONS_AGENT_ID env var."),
    space: z.string().describe("Space name to leave"),
  },
}, async ({ from: fromParam, space }) => {
  const agent = resolveIdentity(fromParam);
  const left = leaveSpace(space, agent);

  return {
    content: [{ type: "text", text: JSON.stringify({ space, agent, left }, null, 2) }],
  };
});

server.registerTool("update_space", {
  title: "Update Space",
  description: "Update a space's description, parent, or project association.",
  inputSchema: {
    name: z.string().describe("Space name to update"),
    description: z.string().optional().describe("New description"),
    parent_id: z.string().optional().describe("New parent space name (use 'null' to remove parent)"),
    project_id: z.string().optional().describe("New project ID (use 'null' to remove project)"),
  },
}, async ({ name, description, parent_id, project_id }) => {
  const updates: { description?: string; parent_id?: string | null; project_id?: string | null } = {};
  if (description !== undefined) updates.description = description;
  if (parent_id !== undefined) updates.parent_id = parent_id === "null" ? null : parent_id;
  if (project_id !== undefined) updates.project_id = project_id === "null" ? null : project_id;

  try {
    const sp = updateSpace(name, updates);
    return {
      content: [{ type: "text", text: JSON.stringify(sp, null, 2) }],
    };
  } catch (e: any) {
    return {
      content: [{ type: "text", text: e.message }],
      isError: true,
    };
  }
});

server.registerTool("archive_space", {
  title: "Archive Space",
  description: "Archive a space. Archived spaces are hidden from list by default.",
  inputSchema: {
    name: z.string().describe("Space name to archive"),
  },
}, async ({ name }) => {
  try {
    const sp = archiveSpace(name);
    return {
      content: [{ type: "text", text: JSON.stringify(sp, null, 2) }],
    };
  } catch (e: any) {
    return {
      content: [{ type: "text", text: e.message }],
      isError: true,
    };
  }
});

server.registerTool("unarchive_space", {
  title: "Unarchive Space",
  description: "Unarchive a previously archived space.",
  inputSchema: {
    name: z.string().describe("Space name to unarchive"),
  },
}, async ({ name }) => {
  try {
    const sp = unarchiveSpace(name);
    return {
      content: [{ type: "text", text: JSON.stringify(sp, null, 2) }],
    };
  } catch (e: any) {
    return {
      content: [{ type: "text", text: e.message }],
      isError: true,
    };
  }
});

// ---- Project Tools ----

server.registerTool("create_project", {
  title: "Create Project",
  description: "Create a new project. Projects organize spaces and provide context for agent collaboration.",
  inputSchema: {
    from: z.string().optional().describe("Your agent ID. Falls back to CONVERSATIONS_AGENT_ID env var."),
    name: z.string().describe("Project name (unique)"),
    description: z.string().optional().describe("Project description"),
    path: z.string().optional().describe("Absolute path to project on disk"),
    repository: z.string().optional().describe("Repository URL"),
    tags: z.string().optional().describe("JSON array of tags (e.g. '[\"backend\", \"api\"]')"),
    metadata: z.string().optional().describe("JSON metadata string"),
    settings: z.string().optional().describe("JSON settings string"),
  },
}, async ({ from: fromParam, name, description, path, repository, tags, metadata, settings }) => {
  const agent = resolveIdentity(fromParam);

  let parsedTags: string[] | undefined;
  if (tags) {
    try {
      parsedTags = JSON.parse(tags);
    } catch {
      return {
        content: [{ type: "text", text: "Invalid tags JSON. Expected array of strings." }],
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
        content: [{ type: "text", text: "Invalid metadata JSON." }],
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
        content: [{ type: "text", text: "Invalid settings JSON." }],
        isError: true,
      };
    }
  }

  try {
    const project = createProject({
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
      content: [{ type: "text", text: JSON.stringify(project, null, 2) }],
    };
  } catch (e: any) {
    if (e.message?.includes("UNIQUE constraint")) {
      return {
        content: [{ type: "text", text: `Project "${name}" already exists` }],
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
  title: "List Projects",
  description: "List all registered projects.",
  inputSchema: {
    status: z.enum(["active", "archived"]).optional().describe("Filter by project status"),
  },
}, async ({ status }) => {
  const projects = listProjects(status ? { status } : undefined);

  return {
    content: [{ type: "text", text: JSON.stringify(projects, null, 2) }],
  };
});

server.registerTool("get_project", {
  title: "Get Project",
  description: "Get full details of a project by ID or name.",
  inputSchema: {
    id: z.string().describe("Project ID (UUID) or name"),
  },
}, async ({ id }) => {
  // Try by ID first, then by name
  let project = getProject(id);
  if (!project) {
    project = getProjectByName(id);
  }

  if (!project) {
    return {
      content: [{ type: "text", text: `Project "${id}" not found` }],
      isError: true,
    };
  }

  return {
    content: [{ type: "text", text: JSON.stringify(project, null, 2) }],
  };
});

server.registerTool("update_project", {
  title: "Update Project",
  description: "Update a project's fields.",
  inputSchema: {
    id: z.string().describe("Project ID (UUID)"),
    name: z.string().optional().describe("New project name"),
    description: z.string().optional().describe("New description"),
    path: z.string().optional().describe("New path"),
    status: z.enum(["active", "archived"]).optional().describe("New status"),
    repository: z.string().optional().describe("New repository URL"),
    tags: z.string().optional().describe("JSON array of tags"),
    metadata: z.string().optional().describe("JSON metadata string"),
    settings: z.string().optional().describe("JSON settings string"),
  },
}, async ({ id, name, description, path, status, repository, tags, metadata, settings }) => {
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
        content: [{ type: "text", text: "Invalid tags JSON." }],
        isError: true,
      };
    }
  }
  if (metadata) {
    try {
      updates.metadata = JSON.parse(metadata);
    } catch {
      return {
        content: [{ type: "text", text: "Invalid metadata JSON." }],
        isError: true,
      };
    }
  }
  if (settings) {
    try {
      updates.settings = JSON.parse(settings);
    } catch {
      return {
        content: [{ type: "text", text: "Invalid settings JSON." }],
        isError: true,
      };
    }
  }

  try {
    const project = updateProject(id, updates as any);
    return {
      content: [{ type: "text", text: JSON.stringify(project, null, 2) }],
    };
  } catch (e: any) {
    return {
      content: [{ type: "text", text: e.message }],
      isError: true,
    };
  }
});

server.registerTool("delete_project", {
  title: "Delete Project",
  description: "Delete a project permanently. Fails if spaces still reference it.",
  inputSchema: {
    id: z.string().describe("Project ID (UUID)"),
  },
}, async ({ id }) => {
  try {
    const deleted = deleteProject(id);
    if (!deleted) {
      return {
        content: [{ type: "text", text: `Project "${id}" not found` }],
        isError: true,
      };
    }
    return {
      content: [{ type: "text", text: JSON.stringify({ id, deleted: true }, null, 2) }],
    };
  } catch (e: any) {
    return {
      content: [{ type: "text", text: e.message }],
      isError: true,
    };
  }
});

// ---- Message Management Tools ----

server.registerTool("delete_message", {
  title: "Delete Message",
  description: "Delete a message. Only the sender can delete their own messages.",
  inputSchema: {
    from: z.string().optional().describe("Your agent ID. Falls back to CONVERSATIONS_AGENT_ID env var."),
    id: z.number().describe("Message ID to delete"),
  },
}, async ({ from: fromParam, id }) => {
  const agent = resolveIdentity(fromParam);
  const deleted = deleteMessage(id, agent);

  if (!deleted) {
    return {
      content: [{ type: "text", text: `Message #${id} not found or not your message` }],
      isError: true,
    };
  }

  return {
    content: [{ type: "text", text: JSON.stringify({ deleted: true }, null, 2) }],
  };
});

server.registerTool("edit_message", {
  title: "Edit Message",
  description: "Edit a message's content. Only the sender can edit their own messages.",
  inputSchema: {
    from: z.string().optional().describe("Your agent ID. Falls back to CONVERSATIONS_AGENT_ID env var."),
    id: z.number().describe("Message ID to edit"),
    content: z.string().describe("New message content"),
  },
}, async ({ from: fromParam, id, content }) => {
  const agent = resolveIdentity(fromParam);
  const msg = editMessage(id, agent, content);

  if (!msg) {
    return {
      content: [{ type: "text", text: `Message #${id} not found or not your message` }],
      isError: true,
    };
  }

  return {
    content: [{ type: "text", text: JSON.stringify(msg, null, 2) }],
  };
});

server.registerTool("pin_message", {
  title: "Pin Message",
  description: "Pin a message. Pinned messages can be retrieved with get_pinned_messages.",
  inputSchema: {
    id: z.number().describe("Message ID to pin"),
  },
}, async ({ id }) => {
  const msg = pinMessage(id);

  if (!msg) {
    return {
      content: [{ type: "text", text: `Message #${id} not found` }],
      isError: true,
    };
  }

  return {
    content: [{ type: "text", text: JSON.stringify(msg, null, 2) }],
  };
});

server.registerTool("unpin_message", {
  title: "Unpin Message",
  description: "Unpin a previously pinned message.",
  inputSchema: {
    id: z.number().describe("Message ID to unpin"),
  },
}, async ({ id }) => {
  const msg = unpinMessage(id);

  if (!msg) {
    return {
      content: [{ type: "text", text: `Message #${id} not found` }],
      isError: true,
    };
  }

  return {
    content: [{ type: "text", text: JSON.stringify(msg, null, 2) }],
  };
});

server.registerTool("get_pinned_messages", {
  title: "Get Pinned Messages",
  description: "Retrieve pinned messages, optionally filtered by space or session.",
  inputSchema: {
    space: z.string().optional().describe("Filter by space name"),
    session_id: z.string().optional().describe("Filter by session ID"),
    limit: z.number().optional().describe("Max messages to return"),
  },
}, async ({ space, session_id, limit }) => {
  const messages = getPinnedMessages({ space, session_id, limit });

  return {
    content: [{ type: "text", text: JSON.stringify(messages, null, 2) }],
  };
});

// ---- Presence Tools ----

server.registerTool("heartbeat", {
  title: "Heartbeat",
  description: "Send a heartbeat to indicate agent is alive. Optionally set a status.",
  inputSchema: {
    from: z.string().optional().describe("Your agent ID. Falls back to CONVERSATIONS_AGENT_ID env var."),
    status: z.string().optional().describe("Agent status (e.g. 'online', 'busy', 'idle'). Defaults to 'online'."),
  },
}, async ({ from: fromParam, status }) => {
  const agent = resolveIdentity(fromParam);
  heartbeat(agent, status);

  return {
    content: [{ type: "text", text: JSON.stringify({ agent, status: status || "online", heartbeat: true }, null, 2) }],
  };
});

server.registerTool("list_agents", {
  title: "List Agents",
  description: "List all agents with their presence status. Returns agent name, status, last seen time, and whether they are online.",
  inputSchema: {
    online_only: z.boolean().optional().describe("Only return agents that are currently online (seen within last 60 seconds)"),
  },
}, async ({ online_only }) => {
  const agents = listAgents({ online_only });

  return {
    content: [{ type: "text", text: JSON.stringify(agents, null, 2) }],
  };
});

// ---- Start server ----

export async function startMcpServer() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

// If run directly (not imported)
const isDirectRun = import.meta.url === `file://${process.argv[1]}` ||
  process.argv[1]?.endsWith("mcp.js") ||
  process.argv[1]?.endsWith("mcp.ts");

if (isDirectRun) {
  startMcpServer().catch((error) => {
    console.error("MCP server error:", error);
    process.exit(1);
  });
}
