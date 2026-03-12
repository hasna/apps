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
import { sendMessage, readMessages, markRead, markSpaceRead, getMessageById, searchMessages, markAllRead, exportMessages, deleteMessage, editMessage, pinMessage, unpinMessage, getPinnedMessages, getUnreadBlockers } from "../lib/messages.js";
import { listSessions } from "../lib/sessions.js";
import { createSpace, updateSpace, archiveSpace, unarchiveSpace, listSpaces, getSpace, joinSpace, leaveSpace, getSpaceMembers } from "../lib/spaces.js";
import { createProject, listProjects, getProject, getProjectByName, updateProject, deleteProject } from "../lib/projects.js";
import { resolveIdentity } from "../lib/identity.js";
import { heartbeat, listAgents, removePresence, renameAgent } from "../lib/presence.js";

import pkg from "../../package.json";

export const server = new McpServer({
  name: "conversations",
  version: pkg.version,
});

// ---- DM Tools ----

server.registerTool("send_message", {
  description: "Send a DM to an agent.",
  inputSchema: {
    to: z.string(),
    content: z.string(),
    from: z.string().optional(),
    priority: z.string().optional(),
    blocking: z.boolean().optional(),
  },
}, async (args: Record<string, any>) => {
  const { from: fromParam, to, content, priority, blocking } = args;
  const from = resolveIdentity(fromParam);

  const msg = sendMessage({
    from,
    to,
    content,
    priority,
    blocking,
  });

  return {
    content: [{ type: "text", text: JSON.stringify(msg) }],
  };
});

server.registerTool("read_messages", {
  description: "Read DMs with optional filters.",
  inputSchema: {
    session_id: z.string().optional(),
    from: z.string().optional(),
    to: z.string().optional(),
    space: z.string().optional(),
    since: z.string().optional(),
    limit: z.number().optional(),
    unread_only: z.boolean().optional(),
  },
}, async (args: Record<string, any>) => {
  const messages = readMessages(args);

  return {
    content: [{ type: "text", text: JSON.stringify(messages) }],
  };
});

server.registerTool("list_sessions", {
  description: "List all sessions by agent.",
  inputSchema: {
    agent: z.string().optional(),
  },
}, async (args: Record<string, any>) => {
  const { agent } = args;
  const sessions = listSessions(agent);

  return {
    content: [{ type: "text", text: JSON.stringify(sessions) }],
  };
});

server.registerTool("reply", {
  description: "Reply to a message by ID.",
  inputSchema: {
    message_id: z.number(),
    content: z.string(),
    from: z.string().optional(),
  },
}, async (args: Record<string, any>) => {
  const { from: fromParam, message_id, content } = args;
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
    space,
  });

  return {
    content: [{ type: "text", text: JSON.stringify(msg) }],
  };
});

server.registerTool("mark_read", {
  description: "Mark messages read by IDs or all.",
  inputSchema: {
    from: z.string().optional(),
    ids: z.array(z.number()).optional(),
    all: z.boolean().optional(),
  },
}, async (args: Record<string, any>) => {
  const { from: fromParam, ids, all } = args;
  const agent = resolveIdentity(fromParam);
  let count: number;

  if (all) {
    count = markAllRead(agent);
  } else if (ids && ids.length > 0) {
    count = markRead(ids, agent);
  } else {
    return {
      content: [{ type: "text", text: "provide ids or set all=true" }],
      isError: true,
    };
  }

  return {
    content: [{ type: "text", text: JSON.stringify({ marked_read: count }) }],
  };
});

server.registerTool("search_messages", {
  description: "Full-text search across messages.",
  inputSchema: {
    query: z.string(),
    space: z.string().optional(),
    from: z.string().optional(),
    to: z.string().optional(),
    limit: z.number().optional(),
  },
}, async (args: Record<string, any>) => {
  const { query, space, from, to, limit } = args;
  const messages = searchMessages({ query, space, from, to, limit });

  return {
    content: [{ type: "text", text: JSON.stringify(messages) }],
  };
});

server.registerTool("export_messages", {
  description: "Export messages as JSON or CSV.",
  inputSchema: {
    space: z.string().optional(),
    session_id: z.string().optional(),
    from: z.string().optional(),
    since: z.string().optional(),
    until: z.string().optional(),
    format: z.string().optional(),
  },
}, async (args: Record<string, any>) => {
  const { space, session_id, from, since, until, format } = args;
  const result = exportMessages({ space, session_id, from, since, until, format });

  return {
    content: [{ type: "text", text: result }],
  };
});

// ---- Space Tools ----

server.registerTool("create_space", {
  description: "Create a space and auto-join.",
  inputSchema: {
    name: z.string(),
    from: z.string().optional(),
    description: z.string().optional(),
    parent_id: z.string().optional(),
    project_id: z.string().optional(),
  },
}, async (args: Record<string, any>) => {
  const { from: fromParam, name, description, parent_id, project_id } = args;
  const agent = resolveIdentity(fromParam);
  try {
    const sp = createSpace(name, agent, { description, parent_id, project_id });
    return {
      content: [{ type: "text", text: JSON.stringify(sp) }],
    };
  } catch (e: any) {
    if (e.message?.includes("UNIQUE constraint")) {
      return {
        content: [{ type: "text", text: `space "${name}" already exists` }],
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
  description: "List spaces with counts.",
  inputSchema: {
    project_id: z.string().optional(),
    parent_id: z.string().optional(),
    include_archived: z.boolean().optional(),
  },
}, async (args: Record<string, any>) => {
  const { project_id, parent_id, include_archived } = args;
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
    content: [{ type: "text", text: JSON.stringify(spaces) }],
  };
});

server.registerTool("send_to_space", {
  description: "Post a message to a space.",
  inputSchema: {
    space: z.string(),
    content: z.string(),
    from: z.string().optional(),
    priority: z.string().optional(),
    blocking: z.boolean().optional(),
  },
}, async (args: Record<string, any>) => {
  const { from: fromParam, space, content, priority, blocking } = args;
  const from = resolveIdentity(fromParam);

  const sp = getSpace(space);
  if (!sp) {
    return {
      content: [{ type: "text", text: `space "${space}" not found` }],
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
    blocking,
  });

  return {
    content: [{ type: "text", text: JSON.stringify(msg) }],
  };
});

server.registerTool("read_space", {
  description: "Read messages from a space.",
  inputSchema: {
    space: z.string(),
    since: z.string().optional(),
    limit: z.number().optional(),
  },
}, async (args: Record<string, any>) => {
  const { space, since, limit } = args;
  const messages = readMessages({ space, since, limit });

  return {
    content: [{ type: "text", text: JSON.stringify(messages) }],
  };
});

server.registerTool("join_space", {
  description: "Join a space as a member.",
  inputSchema: {
    space: z.string(),
    from: z.string().optional(),
  },
}, async (args: Record<string, any>) => {
  const { from: fromParam, space } = args;
  const agent = resolveIdentity(fromParam);
  const ok = joinSpace(space, agent);

  if (!ok) {
    return {
      content: [{ type: "text", text: `space "${space}" not found` }],
      isError: true,
    };
  }

  return {
    content: [{ type: "text", text: JSON.stringify({ space, agent, joined: true }) }],
  };
});

server.registerTool("leave_space", {
  description: "Leave a space.",
  inputSchema: {
    space: z.string(),
    from: z.string().optional(),
  },
}, async (args: Record<string, any>) => {
  const { from: fromParam, space } = args;
  const agent = resolveIdentity(fromParam);
  const left = leaveSpace(space, agent);

  return {
    content: [{ type: "text", text: JSON.stringify({ space, agent, left }) }],
  };
});

server.registerTool("update_space", {
  description: "Update space description or parent.",
  inputSchema: {
    name: z.string(),
    description: z.string().optional(),
    parent_id: z.string().optional(),
    project_id: z.string().optional(),
  },
}, async (args: Record<string, any>) => {
  const { name, description, parent_id, project_id } = args;
  const updates: { description?: string; parent_id?: string | null; project_id?: string | null } = {};
  if (description !== undefined) updates.description = description;
  if (parent_id !== undefined) updates.parent_id = parent_id === "null" ? null : parent_id;
  if (project_id !== undefined) updates.project_id = project_id === "null" ? null : project_id;

  try {
    const sp = updateSpace(name, updates);
    return {
      content: [{ type: "text", text: JSON.stringify(sp) }],
    };
  } catch (e: any) {
    return {
      content: [{ type: "text", text: e.message }],
      isError: true,
    };
  }
});

server.registerTool("archive_space", {
  description: "Archive a space.",
  inputSchema: {
    name: z.string(),
  },
}, async ({ name }) => {
  try {
    const sp = archiveSpace(name);
    return {
      content: [{ type: "text", text: JSON.stringify(sp) }],
    };
  } catch (e: any) {
    return {
      content: [{ type: "text", text: e.message }],
      isError: true,
    };
  }
});

server.registerTool("unarchive_space", {
  description: "Unarchive a space.",
  inputSchema: {
    name: z.string(),
  },
}, async ({ name }) => {
  try {
    const sp = unarchiveSpace(name);
    return {
      content: [{ type: "text", text: JSON.stringify(sp) }],
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
  },
}, async (args: Record<string, any>) => {
  const { status } = args;
  const projects = listProjects(status ? { status } : undefined);

  return {
    content: [{ type: "text", text: JSON.stringify(projects) }],
  };
});

server.registerTool("get_project", {
  description: "Get a project by ID or name.",
  inputSchema: {
    id: z.string(),
  },
}, async ({ id }) => {
  // Try by ID first, then by name
  let project = getProject(id);
  if (!project) {
    project = getProjectByName(id);
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
    const project = updateProject(id, updates as any);
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
  try {
    const deleted = deleteProject(id);
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

// ---- Message Management Tools ----

server.registerTool("delete_message", {
  description: "Delete a message (sender only).",
  inputSchema: {
    id: z.number(),
    from: z.string().optional(),
  },
}, async (args: Record<string, any>) => {
  const { from: fromParam, id } = args;
  const agent = resolveIdentity(fromParam);
  const deleted = deleteMessage(id, agent);

  if (!deleted) {
    return {
      content: [{ type: "text", text: `not found or forbidden` }],
      isError: true,
    };
  }

  return {
    content: [{ type: "text", text: JSON.stringify({ deleted: true }) }],
  };
});

server.registerTool("edit_message", {
  description: "Edit message content (sender only).",
  inputSchema: {
    id: z.number(),
    content: z.string(),
    from: z.string().optional(),
  },
}, async (args: Record<string, any>) => {
  const { from: fromParam, id, content } = args;
  const agent = resolveIdentity(fromParam);
  const msg = editMessage(id, agent, content);

  if (!msg) {
    return {
      content: [{ type: "text", text: `not found or forbidden` }],
      isError: true,
    };
  }

  return {
    content: [{ type: "text", text: JSON.stringify(msg) }],
  };
});

server.registerTool("pin_message", {
  description: "Pin a message.",
  inputSchema: {
    id: z.number(),
  },
}, async ({ id }) => {
  const msg = pinMessage(id);

  if (!msg) {
    return {
      content: [{ type: "text", text: `message #${id} not found` }],
      isError: true,
    };
  }

  return {
    content: [{ type: "text", text: JSON.stringify(msg) }],
  };
});

server.registerTool("unpin_message", {
  description: "Unpin a message.",
  inputSchema: {
    id: z.number(),
  },
}, async ({ id }) => {
  const msg = unpinMessage(id);

  if (!msg) {
    return {
      content: [{ type: "text", text: `message #${id} not found` }],
      isError: true,
    };
  }

  return {
    content: [{ type: "text", text: JSON.stringify(msg) }],
  };
});

server.registerTool("get_pinned_messages", {
  description: "Get pinned messages by space or session.",
  inputSchema: {
    space: z.string().optional(),
    session_id: z.string().optional(),
    limit: z.number().optional(),
  },
}, async (args: Record<string, any>) => {
  const { space, session_id, limit } = args;
  const messages = getPinnedMessages({ space, session_id, limit });

  return {
    content: [{ type: "text", text: JSON.stringify(messages) }],
  };
});

// ---- Presence Tools ----

server.registerTool("heartbeat", {
  description: "Send presence heartbeat.",
  inputSchema: {
    from: z.string().optional(),
    status: z.string().optional(),
  },
}, async (args: Record<string, any>) => {
  const { from: fromParam, status } = args;
  const agent = resolveIdentity(fromParam);
  heartbeat(agent, status);

  return {
    content: [{ type: "text", text: JSON.stringify({ agent, status: status || "online", heartbeat: true }) }],
  };
});

server.registerTool("list_agents", {
  description: "List agents with presence status.",
  inputSchema: {
    online_only: z.boolean().optional(),
  },
}, async (args: Record<string, any>) => {
  const { online_only } = args;
  const agents = listAgents({ online_only });

  return {
    content: [{ type: "text", text: JSON.stringify(agents) }],
  };
});

server.registerTool("get_blockers", {
  description: "Check for unread blocking messages.",
  inputSchema: {
    from: z.string().optional(),
  },
}, async (args: Record<string, any>) => {
  const { from: fromParam } = args;
  const agent = resolveIdentity(fromParam);
  const blockers = getUnreadBlockers(agent);

  return {
    content: [{ type: "text", text: JSON.stringify(blockers) }],
  };
});

server.registerTool("remove_agent", {
  description: "Remove an agent from presence.",
  inputSchema: {
    from: z.string().optional(),
    agent: z.string().optional(),
  },
}, async (args: Record<string, any>) => {
  const { from: fromParam, agent: targetAgent } = args;
  const self = resolveIdentity(fromParam);
  const agent = targetAgent?.trim() || self;

  const removed = removePresence(agent);
  if (!removed) {
    return {
      content: [{ type: "text", text: `agent "${agent}" not found` }],
      isError: true,
    };
  }

  return {
    content: [{ type: "text", text: JSON.stringify({ agent, removed: true }) }],
  };
});

server.registerTool("rename_agent", {
  description: "Rename your agent in presence.",
  inputSchema: {
    new_name: z.string(),
    from: z.string().optional(),
  },
}, async (args: Record<string, any>) => {
  const { from: fromParam, new_name } = args;
  const oldName = resolveIdentity(fromParam);
  const newName = new_name.trim();

  if (!newName) {
    return {
      content: [{ type: "text", text: "new name cannot be empty" }],
      isError: true,
    };
  }

  try {
    const renamed = renameAgent(oldName, newName);
    if (!renamed) {
      return {
        content: [{ type: "text", text: `agent "${oldName}" not found` }],
        isError: true,
      };
    }

    return {
      content: [{ type: "text", text: JSON.stringify({ old_name: oldName, new_name: newName, renamed: true }) }],
    };
  } catch (e: any) {
    return {
      content: [{ type: "text", text: e.message }],
      isError: true,
    };
  }
});

// ---- Meta Tools ----

server.registerTool("search_tools", {
  description: "List tool names by keyword.",
  inputSchema: {
    query: z.string().optional(),
  },
}, async (args: Record<string, any>) => {
  const { query } = args;
  const all = [
    "send_message", "read_messages", "list_sessions", "reply",
    "mark_read", "search_messages", "export_messages",
    "create_space", "list_spaces", "send_to_space", "read_space",
    "join_space", "leave_space", "update_space", "archive_space", "unarchive_space",
    "create_project", "list_projects", "get_project", "update_project", "delete_project",
    "delete_message", "edit_message", "pin_message", "unpin_message", "get_pinned_messages",
    "heartbeat", "list_agents", "get_blockers", "remove_agent", "rename_agent",
    "search_tools", "describe_tools",
  ];
  const q = query?.toLowerCase();
  const matches = q ? all.filter(n => n.includes(q)) : all;
  return { content: [{ type: "text" as const, text: matches.join(", ") }] };
});

server.registerTool("describe_tools", {
  description: "Get descriptions for tools by name.",
  inputSchema: {
    names: z.array(z.string()),
  },
}, async ({ names }) => {
  const descriptions: Record<string, string> = {
    // DM tools
    send_message: "Send DM to agent. Required: to, content. Optional: from?, priority?(low|normal|high|urgent), blocking?",
    read_messages: "Read messages with filters. Optional: session_id?, from?, to?, space?, since?(ISO), limit?, unread_only?",
    list_sessions: "List all DM sessions. Optional: agent?(filter by participant)",
    reply: "Reply to a message in same session. Required: message_id, content. Optional: from?",
    mark_read: "Mark messages as read. Optional: from?, ids?(array), all?(bool — mark all unread)",
    search_messages: "Full-text search messages. Required: query. Optional: space?, from?, to?, limit?",
    export_messages: "Export messages as JSON or CSV. Optional: space?, session_id?, from?, since?, until?, format?(json|csv)",
    // Space tools
    create_space: "Create space and auto-join. Required: name. Optional: from?, description?, parent_id?(max 3 levels), project_id?",
    list_spaces: "List spaces with member/message counts. Optional: project_id?, parent_id?(use 'null' for top-level), include_archived?",
    send_to_space: "Post message to space. Required: space, content. Optional: from?, priority?(low|normal|high|urgent), blocking?",
    read_space: "Read messages in a space. Required: space. Optional: since?(ISO), limit?",
    join_space: "Join a space. Required: space. Optional: from?",
    leave_space: "Leave a space. Required: space. Optional: from?",
    update_space: "Update space fields. Required: name. Optional: description?, parent_id?(use 'null' to remove), project_id?(use 'null' to remove)",
    archive_space: "Archive a space (hidden from default list). Required: name",
    unarchive_space: "Restore archived space. Required: name",
    // Project tools
    create_project: "Create a project. Required: name. Optional: from?, description?, path?, repository?, tags?(JSON array), metadata?(JSON), settings?(JSON)",
    list_projects: "List projects. Optional: status?(active|archived)",
    get_project: "Get project by UUID or name. Required: id",
    update_project: "Update project fields. Required: id. Optional: name?, description?, path?, status?(active|archived), repository?, tags?(JSON), metadata?(JSON), settings?(JSON)",
    delete_project: "Delete project (fails if spaces reference it). Required: id",
    // Message management
    delete_message: "Delete a message (sender only). Required: id. Optional: from?",
    edit_message: "Edit message content (sender only). Required: id, content. Optional: from?",
    pin_message: "Pin a message. Required: id",
    unpin_message: "Unpin a message. Required: id",
    get_pinned_messages: "Get pinned messages. Optional: space?, session_id?, limit?",
    // Presence tools
    heartbeat: "Register/refresh agent presence. Optional: from?, status?(online|busy|idle, default: online)",
    list_agents: "List agents with presence timestamps. Optional: online_only?(only agents seen in last 60s)",
    get_blockers: "Get unread blocking messages for agent. Optional: from?",
    remove_agent: "Remove agent from presence list. Optional: from?, agent?(defaults to self)",
    rename_agent: "Rename agent in presence list. Required: new_name. Optional: from?",
    // Meta tools
    search_tools: "Search tool names by keyword. Optional: query?",
    describe_tools: "Get full descriptions for tools. Required: names(array of tool names)",
  };
  const result = names.map(n => `${n}: ${descriptions[n] || "See tool schema"}`).join("\n");
  return { content: [{ type: "text" as const, text: result }] };
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
