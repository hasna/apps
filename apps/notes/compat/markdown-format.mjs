// Explicit, non-authoritative compatibility surface for legacy Notes markdown.
//
// These functions parse, serialize, migrate, and render caller-supplied text.
// They do not resolve a data root, enumerate files, or expose CRUD. The package
// root and ./sdk remain the authenticated HTTPS client surfaces.
export {
  CONTENT_FORMAT_MARKDOWN,
  FRONTMATTER_V2_KEYS,
  MARKDOWN_COMMANDS,
  applyMarkdownCommand,
  markdownPlainText,
  markdownSafeText,
  migrateNoteTextToV2,
  normalizeLabels,
  parseNote,
  renderMarkdownSafe,
  serializeNote,
} from '../tools/notes-lib.mjs';
