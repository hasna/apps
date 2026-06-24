// ─── Gallery and Downloads tools ─────────────────────────────────────────────

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { clampLimit, clampOffset, compactList, truncateText } from "./compact.js";
import {
  registerTool,
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

registerTool(server,
  "browser_gallery_list",
  "List screenshot gallery entries with optional filters. Compact by default; set verbose=true for full entry records.",
  {
    project_id: z.string().optional(),
    session_id: z.string().optional(),
    tag: z.string().optional(),
    is_favorite: z.boolean().optional(),
    date_from: z.string().optional(),
    date_to: z.string().optional(),
    limit: z.number().optional().default(50),
    offset: z.number().optional().default(0),
    verbose: z.boolean().optional().default(false),
  },
  async ({ project_id, session_id, tag, is_favorite, date_from, date_to, limit, offset, verbose }) => {
    try {
      const safeLimit = clampLimit(limit, 50);
      const safeOffset = clampOffset(offset);
      const entries = listEntries({ projectId: project_id, sessionId: session_id, tag, isFavorite: is_favorite, dateFrom: date_from, dateTo: date_to, limit: safeLimit + 1, offset: safeOffset });
      const visible = entries.slice(0, safeLimit);
      const hasMore = entries.length > safeLimit;
      if (verbose) return json({ entries: visible, count: visible.length, limit: safeLimit, truncated: hasMore, next_offset: hasMore ? safeOffset + safeLimit : undefined });
      const compact = compactList(visible, safeLimit, (entry) => ({
        id: entry.id,
        session_id: entry.session_id,
        project_id: entry.project_id,
        url: truncateText(entry.url, 140) || undefined,
        title: truncateText(entry.title, 100) || undefined,
        format: entry.format,
        size_bytes: entry.compressed_size_bytes ?? entry.original_size_bytes,
        dimensions: entry.width && entry.height ? `${entry.width}x${entry.height}` : undefined,
        tags: entry.tags,
        favorite: entry.is_favorite,
        created_at: entry.created_at,
      }), {
        hint: "Set verbose=true or call browser_gallery_get with include_thumbnail=true for full details.",
      });
      return json({ entries: compact.items, count: compact.count, limit: safeLimit, truncated: hasMore, next_offset: hasMore ? safeOffset + safeLimit : undefined, hint: compact.hint });
    } catch (e) { return err(e); }
  }
);

registerTool(server,
  "browser_gallery_get",
  "Get a gallery entry by id. Thumbnail base64 is omitted unless include_thumbnail=true.",
  { id: z.string(), include_thumbnail: z.boolean().optional().default(false) },
  async ({ id, include_thumbnail }) => {
    try {
      const entry = getEntry(id);
      if (!entry) return err(new Error(`Gallery entry not found: ${id}`));
      let thumbnail_base64: string | undefined;
      if (include_thumbnail && entry.thumbnail_path) {
        try { thumbnail_base64 = Buffer.from(await Bun.file(entry.thumbnail_path).arrayBuffer()).toString("base64"); } catch {}
      }
      return json({ entry, thumbnail_base64 });
    } catch (e) { return err(e); }
  }
);

registerTool(server,
  "browser_gallery_tag",
  "Add a tag to a gallery entry",
  { id: z.string(), tag: z.string() },
  async ({ id, tag }) => {
    try {
      return json({ entry: tagEntry(id, tag) });
    } catch (e) { return err(e); }
  }
);

registerTool(server,
  "browser_gallery_untag",
  "Remove a tag from a gallery entry",
  { id: z.string(), tag: z.string() },
  async ({ id, tag }) => {
    try {
      return json({ entry: untagEntry(id, tag) });
    } catch (e) { return err(e); }
  }
);

registerTool(server,
  "browser_gallery_favorite",
  "Mark or unmark a gallery entry as favorite",
  { id: z.string(), favorited: z.boolean() },
  async ({ id, favorited }) => {
    try {
      return json({ entry: favoriteEntry(id, favorited) });
    } catch (e) { return err(e); }
  }
);

registerTool(server,
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

registerTool(server,
  "browser_gallery_search",
  "Search gallery entries by url, title, notes, or tags. Compact by default; set verbose=true for full entry records.",
  { q: z.string(), limit: z.number().optional().default(20), verbose: z.boolean().optional().default(false) },
  async ({ q, limit, verbose }) => {
    try {
      const safeLimit = clampLimit(limit, 20);
      const entries = searchEntries(q, safeLimit + 1);
      const visible = entries.slice(0, safeLimit);
      const hasMore = entries.length > safeLimit;
      if (verbose) return json({ entries: visible, count: visible.length, limit: safeLimit, truncated: hasMore });
      const compact = compactList(visible, safeLimit, (entry) => ({
        id: entry.id,
        url: truncateText(entry.url, 140) || undefined,
        title: truncateText(entry.title, 100) || undefined,
        format: entry.format,
        tags: entry.tags,
        created_at: entry.created_at,
      }), {
        hint: "Set verbose=true or call browser_gallery_get for full entry details.",
      });
      return json({ entries: compact.items, count: compact.count, limit: safeLimit, truncated: hasMore, hint: compact.hint });
    } catch (e) { return err(e); }
  }
);

registerTool(server,
  "browser_gallery_stats",
  "Get gallery statistics: total, size, favorites, by-format breakdown",
  { project_id: z.string().optional() },
  async ({ project_id }) => {
    try {
      return json(getGalleryStats(project_id));
    } catch (e) { return err(e); }
  }
);

registerTool(server,
  "browser_gallery_diff",
  "Pixel-diff two gallery screenshots. Diff image base64 is omitted unless include_diff_base64=true.",
  { id1: z.string(), id2: z.string(), include_diff_base64: z.boolean().optional().default(false) },
  async ({ id1, id2, include_diff_base64 }) => {
    try {
      const e1 = getEntry(id1);
      const e2 = getEntry(id2);
      if (!e1) return err(new Error(`Gallery entry not found: ${id1}`));
      if (!e2) return err(new Error(`Gallery entry not found: ${id2}`));
      const result = await diffImages(e1.path, e2.path);
      const { diff_base64, ...summary } = result;
      return json({
        ...summary,
        diff_base64: include_diff_base64 && diff_base64.length <= 50000 ? diff_base64 : undefined,
        diff_base64_omitted: !include_diff_base64,
      });
    } catch (e) { return err(e); }
  }
);

// ── Downloads ─────────────────────────────────────────────────────────────────

registerTool(server,
  "browser_downloads_list",
  "List files in the downloads folder. Compact by default; set verbose=true for full metadata.",
  { session_id: z.string().optional(), limit: z.number().optional().default(25), offset: z.number().optional().default(0), verbose: z.boolean().optional().default(false) },
  async ({ session_id, limit, offset, verbose }) => {
    try {
      const downloads = listDownloads(session_id);
      if (verbose) {
        const page = compactList(downloads, limit, (download) => download, { offset });
        return json({ downloads: page.items, count: page.count, total: page.total, limit: page.limit, truncated: page.truncated, next_offset: page.next_offset });
      }
      const compact = compactList(downloads, limit, (download) => ({
        id: download.id,
        filename: truncateText(download.filename, 100),
        type: download.type,
        size_bytes: download.size_bytes,
        session_id: download.session_id,
        created_at: download.created_at,
      }), {
        offset,
        hint: "Set verbose=true or call browser_downloads_get with include_base64=true for file content.",
      });
      return json({ downloads: compact.items, count: compact.count, total: compact.total, limit: compact.limit, truncated: compact.truncated, next_offset: compact.next_offset, hint: compact.hint });
    } catch (e) { return err(e); }
  }
);

registerTool(server,
  "browser_downloads_get",
  "Get a downloaded file by id. Base64 content is omitted unless include_base64=true.",
  { id: z.string(), session_id: z.string().optional(), include_base64: z.boolean().optional().default(false) },
  async ({ id, session_id, include_base64 }) => {
    try {
      const file = getDownload(id, session_id);
      if (!file) return err(new Error(`Download not found: ${id}`));
      const base64 = include_base64 ? Buffer.from(await Bun.file(file.path).arrayBuffer()).toString("base64") : undefined;
      return json({ file, base64 });
    } catch (e) { return err(e); }
  }
);

registerTool(server,
  "browser_downloads_delete",
  "Delete a downloaded file by id",
  { id: z.string(), session_id: z.string().optional() },
  async ({ id, session_id }) => {
    try {
      return json({ deleted: deleteDownload(id, session_id) });
    } catch (e) { return err(e); }
  }
);

registerTool(server,
  "browser_downloads_clean",
  "Delete all downloaded files older than N days (default 7)",
  { older_than_days: z.number().optional().default(7) },
  async ({ older_than_days }) => {
    try {
      return json({ deleted_count: cleanStaleDownloads(older_than_days) });
    } catch (e) { return err(e); }
  }
);

registerTool(server,
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

registerTool(server,
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
