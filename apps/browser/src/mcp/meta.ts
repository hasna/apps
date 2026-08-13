// ─── Agent, project, gallery, downloads, integration, and meta tools ─────────

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerAgentsAndProjects } from "./agents.js";
import { registerGalleryAndDownloads } from "./gallery.js";
import { registerIntegrationAndMeta } from "./integration.js";

export function register(server: McpServer) {
  registerAgentsAndProjects(server);
  registerGalleryAndDownloads(server);
  registerIntegrationAndMeta(server);
}
