// ─── Gallery and Downloads tools ─────────────────────────────────────────────

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  z,
  json,
  err,
  listEntries,
  getEntry,
  tagEntry,
  untagEntry,
  favoriteEntry,
  deleteEntry,
  searchEntries,
  getGalleryStats,
  diffImages,
  listDownloads,
  getDownload,
  deleteDownload,
  cleanStaleDownloads,
  exportToPath,
  persistFile,
} from "./helpers.js";

export function registerGalleryAndDownloads(server: McpServer) {

// ── Gallery ───────────────────────────────────────────────────────────────────

server.tool(
  "browser_gallery_list",
  "List screenshot gallery entries with optional filters",
  {
    project_id: z.string().optional(),
    session_id: z.string().optional(),
    tag: z.string().optional(),
    is_favorite: z.boolean().optional(),
    date_from: z.string().optional(),
    date_to: z.string().optional(),
    limit: z.number().optional().default(50),
    offset: z.number().optional().default(0),
  },
  async ({ project_id, session_id, tag, is_favorite, date_from, date_to, limit, offset }) => {
    try {
      const entries = listEntries({ projectId: project_id, sessionId: session_id, tag, isFavorite: is_favorite, dateFrom: date_from, dateTo: date_to, limit, offset });
      return json({ entries, count: entries.length });
    } catch (e) { return err(e); }
  }
);

server.tool(
  "browser_gallery_get",
  "Get a gallery entry by id, including thumbnail base64",
  { id: z.string() },
  async ({ id }) => {
    try {
      const entry = getEntry(id);
      if (!entry) return err(new Error(`Gallery entry not found: ${id}`));
      let thumbnail_base64: string | undefined;
      if (entry.thumbnail_path) {
        try { thumbnail_base64 = Buffer.from(await Bun.file(entry.thumbnail_path).arrayBuffer()).toString("base64"); } catch {}
      }
      return json({ entry, thumbnail_base64 });
    } catch (e) { return err(e); }
  }
);

server.tool(
  "browser_gallery_tag",
  "Add a tag to a gallery entry",
  { id: z.string(), tag: z.string() },
  async ({ id, tag }) => {
    try {
      return json({ entry: tagEntry(id, tag) });
    } catch (e) { return err(e); }
  }
);

server.tool(
  "browser_gallery_untag",
  "Remove a tag from a gallery entry",
  { id: z.string(), tag: z.string() },
  async ({ id, tag }) => {
    try {
      return json({ entry: untagEntry(id, tag) });
    } catch (e) { return err(e); }
  }
);

server.tool(
  "browser_gallery_favorite",
  "Mark or unmark a gallery entry as favorite",
  { id: z.string(), favorited: z.boolean() },
  async ({ id, favorited }) => {
    try {
      return json({ entry: favoriteEntry(id, favorited) });
    } catch (e) { return err(e); }
  }
);

server.tool(
  "browser_gallery_delete",
  "Delete a gallery entry",
  { id: z.string() },
  async ({ id }) => {
    try {
      deleteEntry(id);
      return json({ deleted: id });
    } catch (e) { return err(e); }
  }
);

server.tool(
  "browser_gallery_search",
  "Search gallery entries by url, title, notes, or tags",
  { q: z.string(), limit: z.number().optional().default(20) },
  async ({ q, limit }) => {
    try {
      return json({ entries: searchEntries(q, limit) });
    } catch (e) { return err(e); }
  }
);

server.tool(
  "browser_gallery_stats",
  "Get gallery statistics: total, size, favorites, by-format breakdown",
  { project_id: z.string().optional() },
  async ({ project_id }) => {
    try {
      return json(getGalleryStats(project_id));
    } catch (e) { return err(e); }
  }
);

server.tool(
  "browser_gallery_diff",
  "Pixel-diff two gallery screenshots. Returns diff image base64 + changed pixel count.",
  { id1: z.string(), id2: z.string() },
  async ({ id1, id2 }) => {
    try {
      const e1 = getEntry(id1);
      const e2 = getEntry(id2);
      if (!e1) return err(new Error(`Gallery entry not found: ${id1}`));
      if (!e2) return err(new Error(`Gallery entry not found: ${id2}`));
      const result = await diffImages(e1.path, e2.path);
      return json(result);
    } catch (e) { return err(e); }
  }
);

// ── Downloads ─────────────────────────────────────────────────────────────────

server.tool(
  "browser_downloads_list",
  "List all files in the downloads folder",
  { session_id: z.string().optional() },
  async ({ session_id }) => {
    try {
      return json({ downloads: listDownloads(session_id), count: listDownloads(session_id).length });
    } catch (e) { return err(e); }
  }
);

server.tool(
  "browser_downloads_get",
  "Get a downloaded file by id, returning base64 content and metadata",
  { id: z.string(), session_id: z.string().optional() },
  async ({ id, session_id }) => {
    try {
      const file = getDownload(id, session_id);
      if (!file) return err(new Error(`Download not found: ${id}`));
      const base64 = Buffer.from(await Bun.file(file.path).arrayBuffer()).toString("base64");
      return json({ file, base64 });
    } catch (e) { return err(e); }
  }
);

server.tool(
  "browser_downloads_delete",
  "Delete a downloaded file by id",
  { id: z.string(), session_id: z.string().optional() },
  async ({ id, session_id }) => {
    try {
      return json({ deleted: deleteDownload(id, session_id) });
    } catch (e) { return err(e); }
  }
);

server.tool(
  "browser_downloads_clean",
  "Delete all downloaded files older than N days (default 7)",
  { older_than_days: z.number().optional().default(7) },
  async ({ older_than_days }) => {
    try {
      return json({ deleted_count: cleanStaleDownloads(older_than_days) });
    } catch (e) { return err(e); }
  }
);

server.tool(
  "browser_downloads_export",
  "Copy a downloaded file to a target path",
  { id: z.string(), target_path: z.string(), session_id: z.string().optional() },
  async ({ id, target_path, session_id }) => {
    try {
      const finalPath = exportToPath(id, target_path, session_id);
      return json({ path: finalPath });
    } catch (e) { return err(e); }
  }
);

server.tool(
  "browser_persist_file",
  "Persist a file permanently via open-files SDK (or local fallback)",
  { download_id: z.string().optional(), path: z.string().optional(), project_id: z.string().optional(), tags: z.array(z.string()).optional() },
  async ({ download_id, path: filePath, project_id, tags }) => {
    try {
      let localPath = filePath;
      if (download_id) {
        const file = getDownload(download_id);
        if (!file) return err(new Error(`Download not found: ${download_id}`));
        localPath = file.path;
      }
      if (!localPath) return err(new Error("Either download_id or path is required"));
      const result = await persistFile(localPath, { projectId: project_id, tags });
      return json(result);
    } catch (e) { return err(e); }
  }
);

}