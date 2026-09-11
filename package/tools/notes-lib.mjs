import { randomUUID } from 'node:crypto';
import { copyFile, mkdir, readdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { constants as fsConstants, copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { homedir, hostname } from 'node:os';
import { dirname, join } from 'node:path';
import {
  beginNoteCreatedIntent,
  cancelNoteCreatedIntent,
  commitNoteCreatedIntent,
} from './notes-events.mjs';
import { hasnaEnv } from './notes-env.mjs';
import { getDataRoot, getExactDataRoot } from '../server/paths.mjs';

export function dataRoot() {
  // Fleet law: app data lives at ~/.hasna/<app>/ — never a nested
  // ~/.hasna/apps/<app> segment. Path resolution routes through the
  // @hasna/paths resolver (XDG / macOS home layout): the resolver data home
  // (~/.local/share/hasna/notes on Linux) is adopted only when HASNA_DATA_HOME
  // is set or the store has already been physically migrated there, otherwise
  // the legacy ~/.hasna/notes root stays effective (an existing store never
  // becomes invisible on upgrade). An exact-app override
  // (HASNA_NOTES_HOME / HASNA_NOTES_ROOT / NOTES_HOME) wins unconditionally and
  // skips the migration. The pre-rename nested root is migrated forward once
  // (copy-only) unless an explicit override is in use.
  const explicit = getExactDataRoot();
  const root = getDataRoot();
  if (!explicit) migrateLegacyRootOnce(root);
  return root;
}

/** The pre-rename nested-apps root this app's data used to live under. */
export function legacyDataRoot() {
  return join(process.env.HOME || homedir(), '.hasna', 'apps', 'notes');
}

const LEGACY_ROOT_MIGRATION_RECEIPT = '.legacy-root-migration.json';

/**
 * One-time copy-forward from the legacy nested-apps root (~/.hasna/apps/notes)
 * into the canonical root (~/.hasna/notes). Copy-only: the source is preserved
 * and never deleted; entries that already exist at the destination are skipped,
 * which makes the copy resumable and idempotent. Writes a receipt marker when
 * the copy completes. A no-op when the legacy root is absent, when the receipt
 * already exists, or when `root` is itself the legacy root.
 */
export function migrateLegacyRootOnce(root) {
  const legacy = legacyDataRoot();
  if (!root || root === legacy || !existsSync(legacy)) return;
  if (existsSync(join(root, LEGACY_ROOT_MIGRATION_RECEIPT))) return;
  mkdirSync(root, { recursive: true, mode: 0o700 });
  for (const entry of readdirSync(legacy)) {
    copyTreeSync(join(legacy, entry), join(root, entry));
  }
  writeFileSync(
    join(root, LEGACY_ROOT_MIGRATION_RECEIPT),
    JSON.stringify({ migratedFrom: legacy, migratedAt: new Date().toISOString() }, null, 2),
    { mode: 0o600 },
  );
}

// Merge-copy: directories merge entry-by-entry so a partially-copied
// destination is completed without touching what already landed; files that
// already exist at the destination are never overwritten.
function copyTreeSync(src, dst) {
  const st = statSync(src);
  if (st.isDirectory()) {
    mkdirSync(dst, { recursive: true, mode: 0o700 });
    for (const entry of readdirSync(src)) copyTreeSync(join(src, entry), join(dst, entry));
    return;
  }
  if (existsSync(dst)) return;
  try {
    // COPYFILE_EXCL: never overwrite an entry that raced into existence.
    copyFileSync(src, dst, fsConstants.COPYFILE_EXCL);
  } catch (err) {
    if (err?.code !== 'EEXIST') throw err;
  }
}

export function notesDir(root = dataRoot()) {
  return join(root, 'notes');
}

function labelsFile(root = dataRoot()) {
  return join(root, 'labels.json');
}

function settingsFile(root = dataRoot()) {
  return join(root, 'settings.json');
}

export const DEFAULT_TRASH_RETENTION_DAYS = 30;
export const CONTENT_FORMAT_MARKDOWN = 'markdown';

// Frontmatter schema v2: fixed key set and order. `rev` is a per-note monotonic
// integer bumped on every local mutation — note versions are ordered by rev,
// never by updatedAt wall clocks. `machine`/`machineFriendlyName` are plain
// informational attribution ("which note belongs to what machine"); the
// retired FleetSync/move provenance keys (sourceMachine, originMachine,
// previousMachine, targetMachineFriendlyName, openedFrom, sourceContext,
// trashMachine, movedAt) are v1-only and dropped by `migrateStoreToV2`.
export const FRONTMATTER_V2_KEYS = [
  'id', 'title', 'labels', 'status', 'folder', 'contentFormat',
  'titleLocked', 'titleSource', 'titleContentFingerprint',
  'rev', 'createdAt', 'updatedAt',
  'author', 'agent', 'machine', 'machineFriendlyName',
  'createdByActorType', 'createdByName',
  'archivedAt', 'trashedAt', 'trashExpiresAt', 'restoredAt',
];

export function revFrom(value) {
  const n = Number(value);
  return Number.isFinite(n) && n >= 1 ? Math.floor(n) : 1;
}

export function normalizeLabels(labels) {
  const seen = new Set();
  const out = [];
  for (const raw of labels || []) {
    const label = String(raw || '').trim();
    const key = label.toLowerCase();
    if (!label || seen.has(key)) continue;
    seen.add(key);
    out.push(label);
  }
  return out;
}

function parsePositiveInt(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
}

function objectValue(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function hasObjectKeys(value) {
  return value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).length > 0;
}

function paginationFrom(value, fallback = {}) {
  const p = objectValue(value);
  const limit = parsePositiveInt(p.limit, parsePositiveInt(fallback.limit, 10));
  const offset = Math.max(0, Number(p.offset ?? fallback.offset ?? 0));
  const total = Math.max(0, Number(p.total ?? fallback.total ?? 0));
  const count = Math.max(0, Number(p.count ?? fallback.count ?? 0));
  const nextOffsetRaw = p.nextOffset ?? p.next_offset ?? fallback.nextOffset;
  const nextOffset = Number.isFinite(Number(nextOffsetRaw)) ? Number(nextOffsetRaw) : offset + count;
  const hasMore = typeof p.hasMore === 'boolean' ? p.hasMore
    : typeof p.has_more === 'boolean' ? p.has_more
      : offset + count < total;
  return {
    limit,
    offset,
    total,
    count,
    hasMore,
    nextOffset,
    has_more: hasMore,
    next_offset: nextOffset,
    order: p.order || fallback.order || 'updated_at_desc',
  };
}

// Any UUID-SHAPED id is accepted as a stable identity (8-4-4-4-12 hex), not just
// strict RFC-4122 v1-v5: requiring the version/variant nibbles made parseNote
// reject foreign ids like 11111111-2222-3333-4444-555555555555 and mint a fresh
// random fallback id on EVERY read (a different id per list call), while the
// v1→v2 migrator and Swift's Foundation UUID(uuidString:) both accept them.
// New notes still always get RFC-4122 v4 ids from randomUUID().
function isUUID(value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(value || ''));
}

function splitTopLevelCommas(s) {
  const out = [];
  let cur = '', inQuotes = false, escaped = false;
  for (const ch of s) {
    if (escaped) { cur += ch; escaped = false; continue; }
    if (ch === '\\' && inQuotes) { cur += ch; escaped = true; continue; }
    if (ch === '"') { inQuotes = !inQuotes; cur += ch; continue; }
    if (ch === ',' && !inQuotes) { out.push(cur); cur = ''; continue; }
    cur += ch;
  }
  out.push(cur);
  return out;
}

function unquote(value) {
  const v = String(value || '').trim();
  if (v.length >= 2 && v.startsWith('"') && v.endsWith('"')) {
    // Unescape in a single left-to-right pass (kept in lockstep with
    // MarkdownStore.unescapeDoubleQuoted). Sequential regex replaces would
    // fire `\n` on the second backslash of an escaped pair, corrupting e.g.
    // "C:\\notes" into "C:\" + a real newline. Recognizes `\\`, `\"`, `\n`;
    // any other `\x` keeps `x`; a trailing lone backslash is kept.
    const inner = v.slice(1, -1);
    let out = '';
    for (let i = 0; i < inner.length; i += 1) {
      const ch = inner[i];
      if (ch !== '\\') { out += ch; continue; }
      const next = inner[i + 1];
      if (next === undefined) { out += '\\'; break; }
      i += 1;
      out += next === 'n' ? '\n' : next;
    }
    return out;
  }
  if (v.length >= 2 && v.startsWith("'") && v.endsWith("'")) return v.slice(1, -1);
  return v;
}

function yamlScalar(value) {
  const v = String(value ?? '');
  // Kept in lockstep with MarkdownStore.yamlScalar: a value already wrapped in
  // single quotes (a title typed as `'hello'`) must be double-quoted too, or
  // unquote would strip the user's quotes on read.
  const needs = !v || /[:#[\],"\n\\]/.test(v) || /^\s|\s$/.test(v)
    || (v.length >= 2 && v.startsWith("'") && v.endsWith("'"));
  if (!needs) return v;
  return '"' + v.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n') + '"';
}

function parseList(value) {
  let v = String(value || '').trim();
  if (v.startsWith('[')) v = v.slice(1);
  if (v.endsWith(']')) v = v.slice(0, -1);
  return normalizeLabels(splitTopLevelCommas(v).map(x => unquote(x.trim())));
}

function parseFrontmatter(lines) {
  const fields = {};
  for (const line of lines) {
    const i = line.indexOf(':');
    if (i < 0) continue;
    const key = line.slice(0, i).trim();
    const value = line.slice(i + 1).trim();
    if (key) fields[key] = value;
  }
  return fields;
}

export const MARKDOWN_COMMANDS = [
  { id: 'bold', label: 'Bold', type: 'inline', markdown: '**text**' },
  { id: 'italic', label: 'Italic', type: 'inline', markdown: '*text*' },
  { id: 'code', label: 'Inline code', type: 'inline', markdown: '`text`' },
  { id: 'link', label: 'Link', type: 'inline', markdown: '[text](url)' },
  { id: 'h1', label: 'Heading 1', type: 'block', markdown: '# text' },
  { id: 'h2', label: 'Heading 2', type: 'block', markdown: '## text' },
  { id: 'h3', label: 'Heading 3', type: 'block', markdown: '### text' },
  { id: 'paragraph', label: 'Paragraph', type: 'block', markdown: 'text' },
  { id: 'bullet-list', label: 'Bullet list', type: 'block', markdown: '- text' },
  { id: 'numbered-list', label: 'Numbered list', type: 'block', markdown: '1. text' },
  { id: 'quote', label: 'Quote', type: 'block', markdown: '> text' },
  { id: 'code-block', label: 'Code block', type: 'block', markdown: '```\ntext\n```' },
  { id: 'checklist', label: 'Checklist', type: 'block', markdown: '- [ ] text' },
  { id: 'divider', label: 'Divider', type: 'insert', markdown: '---' },
];

export function markdownSafeText(text) {
  return String(text || '')
    .replace(/\\/g, '\\\\')
    .replace(/([`*_{}\[\]()#+\-.!>|])/g, '\\$1');
}

function escapeHTML(text) {
  return String(text || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function safeURL(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  if (/[\u0000-\u001f\u007f\\]/.test(raw)) return '';
  if (raw.startsWith('//')) return '';
  if (/^(https?:|mailto:)/i.test(raw)) return raw;
  if (/^(\/(?!\/)|[?#]|\.\.?\/)/.test(raw)) return raw;
  return '';
}

function stripMarkdownEscapes(text) {
  return String(text || '').replace(/\\([\\`*_{}\[\]()#+\-.!>|])/g, '$1');
}

export function markdownPlainText(markdown) {
  let text = String(markdown || '').replace(/\r\n/g, '\n');
  text = text.replace(/```[\s\S]*?```/g, block => block.replace(/^```[^\n]*\n?|\n?```$/g, ''));
  text = text.replace(/`([^`]+)`/g, '$1');
  text = text.replace(/!\[([^\]]*)\]\([^)]+\)/g, '$1');
  text = text.replace(/\[([^\]]+)\]\([^)]+\)/g, '$1');
  text = text.replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, ' ');
  text = text.replace(/<!--[\s\S]*?-->/g, ' ');
  text = text.replace(/<[^>\n]+>/g, ' ');
  text = text.replace(/^#{1,6}\s+/gm, '');
  text = text.replace(/^\s{0,3}>\s?/gm, '');
  text = text.replace(/^\s*[-*+]\s+\[[ xX]\]\s+/gm, '');
  text = text.replace(/^\s*[-*+]\s+/gm, '');
  text = text.replace(/^\s*\d+[.)]\s+/gm, '');
  text = text.replace(/^\s*---+\s*$/gm, ' ');
  text = text.replace(/[*_~#]+/g, '');
  return stripMarkdownEscapes(text).replace(/\s+/g, ' ').trim();
}

function renderInlineMarkdown(text) {
  const placeholders = [];
  const hold = html => {
    const token = `\u0000${placeholders.length}\u0000`;
    placeholders.push(html);
    return token;
  };
  const restore = value => {
    let out = value;
    for (let pass = 0; pass <= placeholders.length; pass += 1) {
      const before = out;
      placeholders.forEach((html, i) => { out = out.replaceAll(`\u0000${i}\u0000`, html); });
      if (out === before) break;
    }
    return out;
  };
  let out = String(text || '').replace(/\\([\\`*_{}\[\]()#+\-.!>|])/g, (_, ch) => hold(escapeHTML(ch)));
  out = out.replace(/`([^`]+)`/g, (_, code) => hold(`<code>${escapeHTML(code)}</code>`));
  out = out.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, (_, label) => hold(escapeHTML(label)));
  out = out.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_, label, href) => {
    const safe = safeURL(href);
    return safe ? hold(`<a href="${escapeHTML(safe)}" rel="nofollow noopener noreferrer">${escapeHTML(label)}</a>`) : hold(escapeHTML(label));
  });
  out = escapeHTML(out);
  out = out.replace(/\*\*\*([^*]+)\*\*\*/g, '<strong><em>$1</em></strong>');
  out = out.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  out = out.replace(/\*([^*]+)\*/g, '<em>$1</em>');
  return restore(out);
}

export function renderMarkdownSafe(markdown) {
  const lines = String(markdown || '').replace(/\r\n/g, '\n').split('\n');
  const html = [];
  let paragraph = [];
  let list = null;
  let inCode = false;
  let code = [];
  let quote = [];

  const closeParagraph = () => {
    if (!paragraph.length) return;
    html.push(`<p>${renderInlineMarkdown(paragraph.join(' '))}</p>`);
    paragraph = [];
  };
  const closeList = () => {
    if (!list) return;
    html.push(`<${list.type}>${list.items.join('')}</${list.type}>`);
    list = null;
  };
  const closeQuote = () => {
    if (!quote.length) return;
    html.push(`<blockquote>${quote.map(renderInlineMarkdown).join('<br>')}</blockquote>`);
    quote = [];
  };
  const closeBlocks = () => { closeParagraph(); closeList(); closeQuote(); };

  for (const line of lines) {
    if (/^\s*```/.test(line)) {
      if (inCode) {
        html.push(`<pre><code>${escapeHTML(code.join('\n'))}</code></pre>`);
        inCode = false;
        code = [];
      } else {
        closeBlocks();
        inCode = true;
      }
      continue;
    }
    if (inCode) {
      code.push(line);
      continue;
    }
    if (!line.trim()) {
      closeBlocks();
      continue;
    }
    if (/^\s*---+\s*$/.test(line)) {
      closeBlocks();
      html.push('<hr>');
      continue;
    }
    const heading = /^(#{1,6})\s+(.+)$/.exec(line);
    if (heading) {
      closeBlocks();
      html.push(`<h${heading[1].length}>${renderInlineMarkdown(heading[2])}</h${heading[1].length}>`);
      continue;
    }
    const quoted = /^\s{0,3}>\s?(.*)$/.exec(line);
    if (quoted) {
      closeParagraph();
      closeList();
      quote.push(quoted[1]);
      continue;
    }
    const checklist = /^\s*[-*+]\s+\[([ xX])\]\s+(.+)$/.exec(line);
    if (checklist) {
      closeParagraph();
      closeQuote();
      if (!list || list.type !== 'ul') { closeList(); list = { type: 'ul', items: [] }; }
      const checked = checklist[1].toLowerCase() === 'x' ? ' checked' : '';
      list.items.push(`<li><input type="checkbox" disabled${checked}> ${renderInlineMarkdown(checklist[2])}</li>`);
      continue;
    }
    const bullet = /^\s*[-*+]\s+(.+)$/.exec(line);
    if (bullet) {
      closeParagraph();
      closeQuote();
      if (!list || list.type !== 'ul') { closeList(); list = { type: 'ul', items: [] }; }
      list.items.push(`<li>${renderInlineMarkdown(bullet[1])}</li>`);
      continue;
    }
    const numbered = /^\s*\d+[.)]\s+(.+)$/.exec(line);
    if (numbered) {
      closeParagraph();
      closeQuote();
      if (!list || list.type !== 'ol') { closeList(); list = { type: 'ol', items: [] }; }
      list.items.push(`<li>${renderInlineMarkdown(numbered[1])}</li>`);
      continue;
    }
    closeList();
    closeQuote();
    paragraph.push(line.trim());
  }
  if (inCode) html.push(`<pre><code>${escapeHTML(code.join('\n'))}</code></pre>`);
  closeBlocks();
  return html.join('\n');
}

function selectedRange(text, start, end) {
  const length = String(text || '').length;
  const s = Math.max(0, Math.min(length, Number(start ?? length)));
  const e = Math.max(0, Math.min(length, Number(end ?? s)));
  return [Math.min(s, e), Math.max(s, e)];
}

function lineRangeForSelection(text, start, end) {
  const before = text.lastIndexOf('\n', Math.max(0, start - 1));
  const lineStart = before < 0 ? 0 : before + 1;
  const after = text.indexOf('\n', end);
  const lineEnd = after < 0 ? text.length : after;
  return [lineStart, lineEnd];
}

function stripBlockPrefix(line) {
  return line
    .replace(/^\s{0,3}#{1,6}\s+/, '')
    .replace(/^\s{0,3}>\s?/, '')
    .replace(/^\s*[-*+]\s+\[[ xX]\]\s+/, '')
    .replace(/^\s*[-*+]\s+/, '')
    .replace(/^\s*\d+[.)]\s+/, '');
}

function replaceRange(text, start, end, value, selectionStart, selectionEnd) {
  return {
    markdown: text.slice(0, start) + value + text.slice(end),
    selectionStart,
    selectionEnd,
  };
}

export function applyMarkdownCommand(markdown, input = {}) {
  const text = String(markdown || '');
  const commandId = String(input.commandId || input.id || '');
  let [start, end] = selectedRange(text, input.selectionStart, input.selectionEnd);
  const selected = text.slice(start, end);
  const fallback = selected || 'text';
  const wrapInline = (prefix, suffix = prefix) => {
    const next = prefix + fallback + suffix;
    return replaceRange(text, start, end, next, start + prefix.length, start + prefix.length + fallback.length);
  };

  if (commandId === 'bold') return wrapInline('**');
  if (commandId === 'italic') return wrapInline('*');
  if (commandId === 'code') return wrapInline('`');
  if (commandId === 'link') {
    const label = markdownSafeText(selected || input.label || 'link');
    const href = safeURL(input.href || input.url || '') || 'https://';
    const next = `[${label}](${href})`;
    return replaceRange(text, start, end, next, start + 1, start + 1 + String(label).length);
  }
  if (commandId === 'code-block') {
    const language = String(input.language || '').replace(/[`\s]/g, '');
    const body = selected || '';
    const next = '```' + language + '\n' + body + '\n```';
    return replaceRange(text, start, end, next, start + 4 + language.length, start + 4 + language.length + body.length);
  }
  if (commandId === 'divider') {
    // Insert AFTER the selection end — a divider must never replace selected text.
    const prefix = end > 0 && text[end - 1] !== '\n' ? '\n' : '';
    const suffix = end < text.length && text[end] !== '\n' ? '\n' : '';
    const next = `${prefix}---${suffix}`;
    return replaceRange(text, end, end, next, end + next.length, end + next.length);
  }

  const [lineStart, lineEnd] = lineRangeForSelection(text, start, end);
  const lines = text.slice(lineStart, lineEnd).split('\n');
  const transformed = lines.map((line, index) => {
    const content = stripBlockPrefix(line);
    if (commandId === 'h1') return '# ' + content;
    if (commandId === 'h2') return '## ' + content;
    if (commandId === 'h3') return '### ' + content;
    if (commandId === 'paragraph') return content;
    if (commandId === 'bullet-list') return '- ' + content;
    if (commandId === 'numbered-list') return `${index + 1}. ${content}`;
    if (commandId === 'quote') return '> ' + content;
    if (commandId === 'checklist') return '- [ ] ' + content;
    return line;
  }).join('\n');
  return replaceRange(text, lineStart, lineEnd, transformed, lineStart, lineStart + transformed.length);
}

export function parseNote(raw, fallbackID = randomUUID()) {
  const text = String(raw || '').replace(/\r\n/g, '\n');
  if (!text.startsWith('---\n')) {
    const first = text.split('\n').find(l => l.trim()) || 'Untitled Note';
    return noteFromFields({ id: fallbackID, title: first.replace(/^#+\s*/, '').slice(0, 80), body: text });
  }
  const lines = text.split('\n');
  const close = lines.findIndex((line, i) => i > 0 && line === '---');
  if (close < 0) return noteFromFields({ id: fallbackID, body: text });
  const fields = parseFrontmatter(lines.slice(1, close));
  const body = lines.slice(close + 1).join('\n');
  const parsedID = unquote(fields.id || '');
  return noteFromFields({
    id: isUUID(parsedID) ? parsedID : fallbackID,
    title: unquote(fields.title || 'Untitled Note'),
    labels: fields.labels ? parseList(fields.labels) : parseList(fields.tags || ''),
    status: fields.status || 'active',
    folder: unquote(fields.folder || ''),
    titleSource: fields.titleSource || (isDefaultTitle(unquote(fields.title || '')) ? 'default' : 'manual'),
    titleLocked: fields.titleLocked == null ? undefined : /^(true|1|yes)$/i.test(fields.titleLocked || ''),
    titleContentFingerprint: unquote(fields.titleContentFingerprint || ''),
    contentFormat: unquote(fields.contentFormat || fields.contentType || CONTENT_FORMAT_MARKDOWN),
    // v2 auto-detect: v1 files (no `rev` key) read as rev 1 without migration.
    rev: revFrom(fields.rev),
    createdAt: fields.createdAt || new Date().toISOString(),
    updatedAt: fields.updatedAt || fields.createdAt || new Date().toISOString(),
    author: unquote(fields.author || process.env.USER || 'unknown'),
    agent: unquote(fields.agent || 'notes-app'),
    machine: unquote(fields.machine || machineIdentity()),
    machineFriendlyName: machineFriendlyNameFromFields(fields),
    createdByActorType: unquote(fields.createdByActorType || ''),
    createdByName: unquote(fields.createdByName || ''),
    archivedAt: unquote(fields.archivedAt || ''),
    trashedAt: unquote(fields.trashedAt || ''),
    trashExpiresAt: unquote(fields.trashExpiresAt || ''),
    restoredAt: unquote(fields.restoredAt || ''),
    body,
  });
}

function noteFromFields(fields) {
  const title = fields.title || 'Untitled Note';
  const titleSource = fields.titleSource || (isDefaultTitle(title) ? 'default' : 'manual');
  const machine = fields.machine || fields.targetMachine || machineIdentity();
  // Actor provenance defaults apply ONLY when the field is absent (a new local
  // note). An explicit empty string — a parsed file or a pulled sync row whose
  // origin recorded no provenance — is preserved as-is; default-filling it
  // here made replica frontmatter drift from the origin file on every pull
  // (and diverges from the Swift store, which preserves the empty value).
  const actorType = fields.createdByActorType
    ?? fields.actorType
    ?? (process.env.HASNA_NOTES_ACTOR_TYPE || 'human');
  const actorName = fields.createdByName
    ?? fields.actorName
    ?? (process.env.HASNA_NOTES_ACTOR_NAME || fields.author || process.env.USER || 'unknown');
  return {
    id: isUUID(fields.id) ? String(fields.id).toLowerCase() : randomUUID(),
    title,
    labels: normalizeLabels(fields.labels || []),
    status: fields.status || 'active',
    folder: fields.folder || '',
    titleLocked: fields.titleLocked == null ? (titleSource === 'manual' && !isDefaultTitle(title)) : !!fields.titleLocked,
    titleSource,
    titleContentFingerprint: fields.titleContentFingerprint || '',
    // Preserve a non-markdown contentFormat through load→save (lockstep with
    // Note.swift: legacy formats must survive the round trip).
    contentFormat: fields.contentFormat || CONTENT_FORMAT_MARKDOWN,
    rev: revFrom(fields.rev),
    createdAt: fields.createdAt || new Date().toISOString(),
    updatedAt: fields.updatedAt || new Date().toISOString(),
    author: fields.author || process.env.USER || 'unknown',
    agent: fields.agent || 'notes-app',
    machine,
    machineFriendlyName: fields.machineFriendlyName || '',
    createdByActorType: actorType,
    createdByName: actorName,
    archivedAt: fields.archivedAt || '',
    trashedAt: fields.trashedAt || '',
    trashExpiresAt: fields.trashExpiresAt || '',
    restoredAt: fields.restoredAt || '',
    body: fields.body || '',
  };
}

/// v2 reads `machineFriendlyName` directly; v1 files fall back to the legacy
/// source/origin friendly names when they described the note's own machine.
function machineFriendlyNameFromFields(fields) {
  // An explicit v2 key wins even when empty (matches the Swift parser).
  if (fields.machineFriendlyName != null) return unquote(fields.machineFriendlyName);
  const machine = unquote(fields.machine || '');
  const sourceMachine = unquote(fields.sourceMachine || '');
  const sourceName = unquote(fields.sourceMachineFriendlyName || '');
  if (sourceName && (!sourceMachine || sourceMachine === machine)) return sourceName;
  const originMachine = unquote(fields.originMachine || '');
  const originName = unquote(fields.originMachineFriendlyName || '');
  if (originName && originMachine === machine) return originName;
  return '';
}

/// Stable machine identity for note attribution — never a cosmetic display
/// name. Resolution order:
///   1. $HASNA_NOTES_MACHINE (explicit override),
///   2. `machine` in the notes config (~/.config/hasna-notes/config.json
///      or $HASNA_NOTES_CONFIG) — the configured identity,
///   3. short hostname (pre-first-dot), else 'unknown'.
export function machineIdentity() {
  const override = String(hasnaEnv('MACHINE') || '').trim();
  if (override) return override;
  try {
    const configPath = hasnaEnv('CONFIG') || join(homedir(), '.config', 'hasna-notes', 'config.json');
    const configured = String(JSON.parse(readFileSync(configPath, 'utf8')).machine || '').trim();
    if (configured) return configured;
  } catch { /* not configured — fall through to the hostname */ }
  const short = String(hostname() || '').split('.')[0].trim();
  return short || 'unknown';
}

export function serializeNote(note) {
  const n = noteFromFields(note);
  // Schema v2 — key order is FRONTMATTER_V2_KEYS (kept in lockstep with
  // HasnaNotesCore/MarkdownStore.serialize).
  const lines = [
    '---',
    `id: ${n.id.toLowerCase()}`,
    `title: ${yamlScalar(n.title)}`,
    `labels: [${normalizeLabels(n.labels).map(yamlScalar).join(', ')}]`,
    `status: ${n.status}`,
    `folder: ${yamlScalar(n.folder)}`,
    `contentFormat: ${yamlScalar(n.contentFormat || CONTENT_FORMAT_MARKDOWN)}`,
    `titleLocked: ${n.titleLocked ? 'true' : 'false'}`,
    `titleSource: ${n.titleSource}`,
    `titleContentFingerprint: ${yamlScalar(n.titleContentFingerprint)}`,
    `rev: ${revFrom(n.rev)}`,
    `createdAt: ${n.createdAt}`,
    `updatedAt: ${n.updatedAt}`,
    `author: ${yamlScalar(n.author)}`,
    `agent: ${yamlScalar(n.agent)}`,
    `machine: ${yamlScalar(n.machine)}`,
    `machineFriendlyName: ${yamlScalar(n.machineFriendlyName)}`,
    `createdByActorType: ${yamlScalar(n.createdByActorType)}`,
    `createdByName: ${yamlScalar(n.createdByName)}`,
    `archivedAt: ${yamlScalar(n.archivedAt)}`,
    `trashedAt: ${yamlScalar(n.trashedAt)}`,
    `trashExpiresAt: ${yamlScalar(n.trashExpiresAt)}`,
    `restoredAt: ${yamlScalar(n.restoredAt)}`,
    '---',
  ];
  return lines.join('\n') + '\n' + n.body;
}

export async function loadNotes(root = dataRoot()) {
  const dir = notesDir(root);
  await mkdir(dir, { recursive: true });
  const files = await readdir(dir).catch(() => []);
  const notes = [];
  for (const file of files) {
    if (!file.endsWith('.md')) continue;
    const raw = await readFile(join(dir, file), 'utf8').catch(() => null);
    if (raw == null) continue;
    notes.push(parseNote(raw, file.replace(/\.md$/, '')));
  }
  return notes.sort((a, b) => Date.parse(b.updatedAt || 0) - Date.parse(a.updatedAt || 0));
}

/**
 * Strict note-store snapshot for reconciliation and other correctness-critical
 * callers. Unlike loadNotes(), this never turns an enumeration, read, or parse
 * failure into a partial list. Normal interactive reads intentionally retain
 * their historical tolerant behaviour through loadNotes().
 */
export async function loadNotesStrict(root = dataRoot(), options = {}) {
  const dir = notesDir(root);
  await mkdir(dir, { recursive: true });
  const readDirectory = options.readdir ?? readdir;
  const readNote = options.readFile ?? readFile;
  const parse = options.parseNote ?? parseNote;
  const files = await readDirectory(dir);
  const notes = [];
  for (const file of [...files].sort()) {
    if (!file.endsWith('.md')) continue;
    const fallbackID = file.replace(/\.md$/, '');
    if (!isUUID(fallbackID)) throw new Error('invalid_note_filename');
    const raw = await readNote(join(dir, file), 'utf8');
    const normalized = String(raw).replace(/\r\n/g, '\n');
    if (normalized.startsWith('---\n')) {
      const lines = normalized.split('\n');
      if (!lines.some((line, index) => index > 0 && line === '---')) {
        throw new Error('invalid_note_document');
      }
    }
    const parsed = await parse(raw, fallbackID);
    if (!parsed || !isUUID(parsed.id) || parsed.id.toLowerCase() !== fallbackID.toLowerCase()) {
      throw new Error('invalid_note_document');
    }
    notes.push(parsed);
  }
  return notes.sort((a, b) => Date.parse(b.updatedAt || 0) - Date.parse(a.updatedAt || 0));
}

export async function saveNote(note, root = dataRoot(), opts = {}) {
  const dir = notesDir(root);
  await mkdir(dir, { recursive: true });
  const n = noteFromFields(note);
  const path = join(dir, `${n.id.toLowerCase()}.md`);
  const existingRaw = await readFile(path, 'utf8').catch((error) => {
    if (error?.code === 'ENOENT') return null;
    throw error;
  });
  // The shared save boundary is authoritative: every absent target is a create,
  // including direct library callers that do not know about event plumbing.
  // eventContext remains optional call-site provenance and never gates emission.
  const isCreatedEvent = existingRaw == null;
  let hasCreatedIntent = false;
  if (isCreatedEvent) {
    // At least one metadata-only intent location must be durable before the
    // note rename. beginNoteCreatedIntent falls back to a private directory on
    // the note-store filesystem when <root>/events is unavailable.
    await beginNoteCreatedIntent(n, root);
    hasCreatedIntent = true;
  }
  if (!opts.preserveRev) {
    // Every local mutation bumps the per-note monotonic `rev` past whatever is on
    // disk, so sync can order versions without trusting wall clocks. New files keep
    // their initial rev (default 1). Sync-applied writes pass `preserveRev: true`.
    if (existingRaw != null) {
      n.rev = Math.max(revFrom(n.rev), revFrom(parseNote(existingRaw, n.id).rev)) + 1;
    }
  }
  const tmp = join(dir, `.${n.id}.${randomUUID()}.tmp`);
  try {
    await writeFile(tmp, serializeNote(n), 'utf8');
    await rename(tmp, path);
  } catch (error) {
    if (hasCreatedIntent) await cancelNoteCreatedIntent(n.id, root).catch(() => {});
    throw error;
  }
  if (isCreatedEvent) await commitNoteCreatedIntent(n, root);
  return n;
}

export async function deleteNote(id, root = dataRoot()) {
  const path = join(notesDir(root), `${String(id).toLowerCase()}.md`);
  if (existsSync(path)) await rm(path);
}

export async function listNotes(opts = {}, root = dataRoot()) {
  const limit = Math.max(1, Number(opts.limit || 10));
  const offset = Math.max(0, Number(opts.offset || 0));
  const q = String(opts.query || '').toLowerCase();
  const all = (await loadNotes(root)).filter(n => {
    if (opts.label && !n.labels.includes(opts.label)) return false;
    if (opts.machine && n.machine !== opts.machine) return false;
    if (opts.status && n.status !== opts.status) return false;
    if (!opts.status && !opts.includeArchived && n.status === 'archived') return false;
    if (!opts.status && !opts.includeTrash && n.status === 'trash') return false;
    if (q && !(`${n.title} ${n.body} ${n.labels.join(' ')}`.toLowerCase().includes(q))) return false;
    return true;
  });
  const items = all.slice(offset, offset + limit);
  return { items, limit, offset, total: all.length, hasMore: offset + items.length < all.length, nextOffset: offset + items.length };
}

export async function loadLabelList(root = dataRoot()) {
  const labels = JSON.parse(await readFile(labelsFile(root), 'utf8').catch(() => '{"labels":[]}')).labels || [];
  const fromNotes = (await loadNotes(root)).flatMap(n => n.labels);
  return normalizeLabels([...labels, ...fromNotes]).sort((a, b) => a.localeCompare(b));
}

export async function saveLabelList(labels, root = dataRoot()) {
  const file = labelsFile(root);
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, JSON.stringify({ labels: normalizeLabels(labels) }, null, 2) + '\n');
}

export async function loadSettings(root = dataRoot()) {
  const raw = await readFile(settingsFile(root), 'utf8').catch(() => '{}');
  let parsed = {};
  try { parsed = JSON.parse(raw); } catch {}
  return {
    trashRetentionDays: parsePositiveInt(parsed.trashRetentionDays, DEFAULT_TRASH_RETENTION_DAYS),
  };
}

export async function saveSettings(settings, root = dataRoot()) {
  const file = settingsFile(root);
  await mkdir(dirname(file), { recursive: true });
  const next = {
    trashRetentionDays: parsePositiveInt(settings?.trashRetentionDays, DEFAULT_TRASH_RETENTION_DAYS),
  };
  await writeFile(file, JSON.stringify(next, null, 2) + '\n');
  return next;
}

function addDays(isoOrDate, days) {
  const d = isoOrDate instanceof Date ? isoOrDate : new Date(isoOrDate || Date.now());
  return new Date(d.getTime() + days * 86400000).toISOString();
}

async function mutateNote(id, mutate, root = dataRoot()) {
  const note = await getNote(id, root);
  if (!note) throw new Error('note_not_found');
  mutate(note);
  note.updatedAt = new Date().toISOString();
  // Return the saved copy — saveNote assigns the bumped monotonic rev.
  return saveNote(note, root);
}

/// Re-attribute a note to another machine. In schema v2 this is a plain
/// informational update of `machine` (+ optional friendly name) — no move
/// provenance trail is kept.
export async function moveNoteToMachine(id, targetMachine, opts = {}, root = dataRoot()) {
  const target = String(targetMachine || '').trim();
  if (!target) throw new Error('target_machine_required');
  return mutateNote(id, (note) => {
    const changed = note.machine !== target;
    const friendlyName = opts.machineFriendlyName || opts.targetMachineFriendlyName || '';
    note.machine = target;
    // A stale friendly name must not describe the old machine.
    note.machineFriendlyName = friendlyName || (changed ? '' : note.machineFriendlyName);
  }, root);
}

export async function archiveNote(id, root = dataRoot()) {
  return mutateNote(id, (note) => {
    note.status = 'archived';
    note.archivedAt = new Date().toISOString();
    note.trashedAt = '';
    note.trashExpiresAt = '';
  }, root);
}

export async function trashNote(id, opts = {}, root = dataRoot()) {
  const settings = await loadSettings(root);
  const retentionDays = parsePositiveInt(opts.retentionDays, settings.trashRetentionDays);
  return mutateNote(id, (note) => {
    note.status = 'trash';
    note.trashedAt = new Date().toISOString();
    note.trashExpiresAt = addDays(note.trashedAt, retentionDays);
  }, root);
}

export async function restoreNote(id, root = dataRoot()) {
  return mutateNote(id, (note) => {
    note.status = 'active';
    note.archivedAt = '';
    note.trashedAt = '';
    note.trashExpiresAt = '';
    note.restoredAt = new Date().toISOString();
  }, root);
}

export async function purgeExpiredTrash(root = dataRoot(), now = new Date()) {
  const settings = await loadSettings(root);
  const purged = [];
  for (const note of await loadNotes(root)) {
    if (note.status !== 'trash') continue;
    // Legacy trash (no trashExpiresAt stamp) falls back to trashedAt + retention.
    const expires = note.trashExpiresAt
      || (note.trashedAt ? addDays(note.trashedAt, settings.trashRetentionDays) : '');
    if (!expires) continue;
    if (Date.parse(expires) <= now.getTime()) {
      await deleteNote(note.id, root);
      purged.push(note.id);
    }
  }
  return { purged, count: purged.length };
}

export async function renameLabel(oldName, newName, root = dataRoot()) {
  const oldKey = String(oldName).toLowerCase();
  const labels = (await loadLabelList(root)).map(l => l.toLowerCase() === oldKey ? newName : l);
  await saveLabelList(labels, root);
  for (const note of await loadNotes(root)) {
    if (!note.labels.some(l => l.toLowerCase() === oldKey)) continue;
    note.labels = normalizeLabels(note.labels.map(l => l.toLowerCase() === oldKey ? newName : l));
    note.updatedAt = new Date().toISOString();
    await saveNote(note, root);
  }
}

export async function deleteLabelEverywhere(name, root = dataRoot()) {
  const key = String(name).toLowerCase();
  await saveLabelList((await loadLabelList(root)).filter(l => l.toLowerCase() !== key), root);
  for (const note of await loadNotes(root)) {
    if (!note.labels.some(l => l.toLowerCase() === key)) continue;
    note.labels = note.labels.filter(l => l.toLowerCase() !== key);
    note.updatedAt = new Date().toISOString();
    await saveNote(note, root);
  }
}

export async function assignLabel(id, label, root = dataRoot()) {
  const note = (await loadNotes(root)).find(n => n.id.toLowerCase() === String(id).toLowerCase());
  if (!note) throw new Error('note_not_found');
  note.labels = normalizeLabels([...note.labels, label]);
  note.updatedAt = new Date().toISOString();
  const saved = await saveNote(note, root);
  await saveLabelList([...(await loadLabelList(root)), label], root);
  return saved;
}

export async function unassignLabel(id, label, root = dataRoot()) {
  const note = (await loadNotes(root)).find(n => n.id.toLowerCase() === String(id).toLowerCase());
  if (!note) throw new Error('note_not_found');
  const key = String(label).toLowerCase();
  note.labels = note.labels.filter(l => l.toLowerCase() !== key);
  note.updatedAt = new Date().toISOString();
  return saveNote(note, root);
}

export function isDefaultTitle(title) {
  return ['', 'New Note', 'Untitled Note'].includes(String(title || '').trim());
}

export function contentFingerprint(text) {
  let hash = 0xcbf29ce484222325n;
  const bytes = new TextEncoder().encode(String(text || '').slice(0, 4000));
  for (const byte of bytes) {
    hash ^= BigInt(byte);
    hash = BigInt.asUintN(64, hash * 0x100000001b3n);
  }
  return hash.toString(16);
}

export function cleanGeneratedTitle(value) {
  let title = String(value || '').trim();
  title = title.replace(/\s+/g, ' ');
  title = title.replace(/^["'“”‘’]+/, '').replace(/["'“”‘’]+$/, '').trim();
  title = title.replace(/[.\s]+$/, '').trim();
  const words = title.split(/\s+/).filter(Boolean);
  if (words.length > 4) title = words.slice(0, 4).join(' ');
  if (/^(untitled|new note|note|summary)$/i.test(title)) return '';
  return title;
}

export function heuristicTitle(text) {
  const readable = markdownPlainText(text);
  const words = readable
    .split(/\s+/)
    .map(w => w.replace(/^[^\w]+|[^\w]+$/g, ''))
    .filter(w => w.length > 2 && !/^(the|and|for|with|this|that|from|into|onto|about|there|their|have|will|your)$/i.test(w));
  const title = words.slice(0, 4).map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
  return cleanGeneratedTitle(title) || 'Untitled Note';
}

export async function generateTitle(text, opts = {}) {
  const readable = markdownPlainText(text) || String(text || '').trim();
  if (opts.sidecar) {
    const token = opts.sidecarToken || process.env.HASNA_NOTES_SIDECAR_TOKEN || '';
    const headers = { 'Content-Type': 'application/json' };
    if (token) {
      headers['X-Hasna-Notes-Token'] = token;
    }
    const res = await fetch(String(opts.sidecar).replace(/\/$/, '') + '/title', {
      method: 'POST',
      headers,
      body: JSON.stringify({ text: readable }),
    });
    if (res.ok) {
      const data = await res.json();
      const title = cleanGeneratedTitle(data.title);
      if (title) return { title, provider: 'sidecar' };
    }
  }
  return { title: heuristicTitle(readable), provider: 'heuristic' };
}

export async function getNote(id, root = dataRoot()) {
  const key = String(id || '').toLowerCase();
  return (await loadNotes(root)).find(n => String(n.id).toLowerCase() === key) || null;
}

// ---------------------------------------------------------------------------
// Frontmatter v1 -> v2 migration (one-shot, idempotent).
// ---------------------------------------------------------------------------

/// Rewrite one note document to schema v2 without touching the body bytes.
/// - v2 files (frontmatter already has `rev`) are returned unchanged.
/// - Files without frontmatter are returned unchanged (readable as-is).
/// - v1 files keep every v2 key verbatim (legacy `tags`/`contentType` fold into
///   `labels`/`contentFormat`), gain `rev: 1`, derive `machineFriendlyName` from
///   the legacy `sourceMachineFriendlyName`/`originMachineFriendlyName` keys
///   (when they described the note's own machine — machineFriendlyNameFromFields),
///   and drop everything else. Dropped keys are reported so the migrator can log
///   them; keys whose value was folded in are consumed, not reported dropped.
export function migrateNoteTextToV2(raw) {
  const text = String(raw || '');
  const open = /^---\r?\n/.exec(text);
  if (!open) return { version: 'bare', changed: false, text, dropped: [] };

  // Walk lines manually so the body after the closing delimiter is preserved
  // byte-for-byte (parseNote normalizes CRLF; the migrator must not).
  let idx = open[0].length;
  const fmLines = [];
  let bodyStart = -1;
  while (idx <= text.length) {
    const nl = text.indexOf('\n', idx);
    const lineEnd = nl < 0 ? text.length : nl;
    const line = text.slice(idx, lineEnd);
    const bare = line.endsWith('\r') ? line.slice(0, -1) : line;
    if (bare === '---') { bodyStart = nl < 0 ? text.length : nl + 1; break; }
    if (nl < 0) break; // unterminated frontmatter
    fmLines.push(bare);
    idx = nl + 1;
  }
  if (bodyStart < 0) return { version: 'bare', changed: false, text, dropped: [] };

  const fields = parseFrontmatter(fmLines);
  if (fields.rev != null && fields.rev !== '') {
    return { version: 'v2', changed: false, text, dropped: [] };
  }

  const body = text.slice(bodyStart);
  const consumed = new Set();
  // Keys absent in the v1 file are emitted with the SAME deterministic default
  // the v2 serializer writes, so a migrated file is key-identical to what a
  // sync replica serializes on another machine (missing keys were permanent
  // cosmetic cross-device diffs). Non-deterministic keys (id, timestamps,
  // author, agent, machine) are never fabricated — they stay absent and the
  // parser fills them at read time.
  const parsedTitle = unquote(fields.title || 'Untitled Note');
  const derivedTitleSource = fields.titleSource || (isDefaultTitle(parsedTitle) ? 'default' : 'manual');
  const defaults = {
    title: 'title: Untitled Note',
    labels: 'labels: []',
    status: 'status: active',
    folder: 'folder: ""',
    contentFormat: `contentFormat: ${CONTENT_FORMAT_MARKDOWN}`,
    titleLocked: `titleLocked: ${derivedTitleSource === 'manual' && !isDefaultTitle(parsedTitle) ? 'true' : 'false'}`,
    titleSource: `titleSource: ${derivedTitleSource}`,
    titleContentFingerprint: 'titleContentFingerprint: ""',
    createdByActorType: 'createdByActorType: ""',
    createdByName: 'createdByName: ""',
    archivedAt: 'archivedAt: ""',
    trashedAt: 'trashedAt: ""',
    trashExpiresAt: 'trashExpiresAt: ""',
    restoredAt: 'restoredAt: ""',
  };
  const lines = ['---'];
  for (const key of FRONTMATTER_V2_KEYS) {
    if (key === 'rev') { lines.push('rev: 1'); continue; }
    if (key === 'machineFriendlyName') {
      const friendly = machineFriendlyNameFromFields(fields);
      consumed.add('machineFriendlyName');
      // A legacy key whose value was folded in is consumed, not dropped — keep
      // the "dropped v1 keys" report honest (same as the tags/contentType folds).
      if (friendly) {
        if (unquote(fields.sourceMachineFriendlyName || '') === friendly) consumed.add('sourceMachineFriendlyName');
        if (unquote(fields.originMachineFriendlyName || '') === friendly) consumed.add('originMachineFriendlyName');
      }
      lines.push(`machineFriendlyName: ${yamlScalar(friendly)}`);
      continue;
    }
    let value = fields[key];
    if (value == null && key === 'labels' && fields.tags != null) { value = fields.tags; consumed.add('tags'); }
    if (value == null && key === 'contentFormat' && fields.contentType != null) { value = fields.contentType; consumed.add('contentType'); }
    if (value == null) {
      if (defaults[key]) lines.push(defaults[key]);
      continue;
    }
    consumed.add(key);
    lines.push(`${key}: ${value}`);
  }
  lines.push('---');

  const dropped = Object.keys(fields).filter(key => !consumed.has(key) && !FRONTMATTER_V2_KEYS.includes(key));
  const next = lines.join('\n') + '\n' + body;
  return { version: 'v1', changed: next !== text, text: next, dropped };
}

/// One-shot store migration: upgrade every v1 note file in `<root>/notes/` to
/// schema v2 in place. Backup-first (originals copied to
/// `<root>/backup-frontmatter-v1/` once), atomic per file (tmp + rename),
/// idempotent (v2 files are skipped), body preserved byte-for-byte.
export async function migrateStoreToV2(root = dataRoot(), opts = {}) {
  const dir = notesDir(root);
  const backupDir = join(root, 'backup-frontmatter-v1');
  const files = (await readdir(dir).catch(() => [])).filter(f => f.endsWith('.md')).sort();
  const summary = {
    root, backupDir, dryRun: !!opts.dryRun,
    scanned: 0, migrated: 0, alreadyV2: 0, skipped: 0,
    droppedKeys: {}, files: [],
  };
  for (const file of files) {
    const path = join(dir, file);
    const raw = await readFile(path, 'utf8').catch(() => null);
    if (raw == null) continue;
    summary.scanned += 1;
    const result = migrateNoteTextToV2(raw);
    if (result.version === 'v2') { summary.alreadyV2 += 1; continue; }
    if (result.version === 'bare' || !result.changed) {
      summary.skipped += 1;
      summary.files.push({ file, action: 'skipped', reason: result.version });
      continue;
    }
    for (const key of result.dropped) {
      summary.droppedKeys[key] = (summary.droppedKeys[key] || 0) + 1;
    }
    if (opts.dryRun) {
      summary.migrated += 1;
      summary.files.push({ file, action: 'would-migrate', dropped: result.dropped });
      continue;
    }
    await mkdir(backupDir, { recursive: true });
    const backupPath = join(backupDir, file);
    if (!existsSync(backupPath)) await copyFile(path, backupPath);
    const tmp = join(dir, `.${file}.${randomUUID()}.tmp`);
    await writeFile(tmp, result.text, 'utf8');
    await rename(tmp, path);
    summary.migrated += 1;
    summary.files.push({ file, action: 'migrated', dropped: result.dropped });
  }
  return summary;
}
