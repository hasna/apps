// ===================== Hasna Notes desktop UI — real notes app =====================
//
// This is a REAL notes app rendered from data, in the approved visual
// style. Data arrives one of two ways:
//
//   1. Native macOS host (WKWebView): the Swift shell injects `window.__BOOT__` at
//      document-start (notes + labels + settings) fetched from the HOSTED
//      notes API (cloud-only storage — no local note files), and later calls
//      `window.HasnaNotes.hydrate(boot)` after any
//      save/create/delete so the UI re-renders from fresh data. Writes are sent back
//      to Swift via `window.webkit.messageHandlers.notes.postMessage({action,note})`.
//
//   2. Plain browser / Playwright: no `__BOOT__`, so we boot empty and keep the model
//      in memory — writes just mutate the in-memory model + re-render, so the whole
//      UI is testable headless (tests hydrate their own fixtures).
//
// Navigation is hash-free for the editor and chat (selection is in-memory); only
// Settings uses a hash (#settings) so a screenshot harness can deep-link to it.
(function () {
  'use strict';

  // ------------------------------------------------------------------ model state
  const ALL = '__all__';
  // Default titles that are eligible for AI auto-titling (Feature 6).
  const DEFAULT_TITLES = ['', 'New Note', 'Untitled Note'];
  const state = {
    notes: [],            // [{id,title,body,labels,status,folder,machine,updatedAt,createdAt}]
    labels: [],           // persisted labels from labels.json; note labels are still source for counts
    selectedId: null,     // currently-open note id (or null = empty state)
    labelFilter: ALL,     // ALL or a label name (UI-only forward-compatible filter)
    screen: 'home',       // 'home' | 'chat' | 'notes' | 'noteslist' | 'settings' | 'compact'
    settingsReturnScreen: 'home', // screen to restore when leaving Settings via "Back to app"
    statusFilter: 'active', // active | archived | trash | all
    noteListLimit: 10,    // sidebar Notes list (contract: latest 10); "View more" opens the full Notes page
    recentLimit: 3,       // Home recent rows — kept deliberately light (no inline expand)
    settings: { trashRetentionDays: 30 },
    chat: {
      id: 'chat-local',
      status: 'ready',
      messages: [],
      toolCalls: [],
      sources: [],
      pendingConfirmations: [],
      error: '',
      goal: null,
    },
  };

  // Sidebar section collapse state (Notes / Labels) — session-only UI state.
  const collapsedSections = { notes: false, labels: false };
  // Chat chrome is session-only: the conversation state remains the source of truth,
  // while these flags only control its view and inspector panel.
  let chatPanelOpen = true;
  let chatWideView = false;
  let chatMoreOpen = false;
  // Screen to restore when leaving compact mode (defect 20: never force Home).
  let compactReturnScreen = 'home';

  // Per-note flag: once the user edits a title by hand, never auto-title that note again.
  // Keyed by note id. Lives only in this session (a fresh manual edit re-sets it).
  const titleManuallyEdited = Object.create(null);
  // Per-note auto-title state so we only fire once per default-titled note.
  const autoTitled = Object.create(null);

  const native = () =>
    !!(window.webkit && window.webkit.messageHandlers && window.webkit.messageHandlers.notes);

  // The native `window` message channel (compact-mode control).
  const nativeWindow = () =>
    !!(window.webkit && window.webkit.messageHandlers && window.webkit.messageHandlers.window);

  // AI sidecar config injected by the host as window.__AI__ = {port, available}.
  // In a plain browser it's absent, so AI features are unavailable (and can be faked
  // for screenshots by setting window.__AI__ before load).
  function ai() {
    const a = window.__AI__ || {};
    return {
      port: a.port || 0,
      available: !!a.available,
      realtime: !!a.realtime,
      realtimeProvider: a.realtimeProvider || 'openai',
      token: a.token || '',
    };
  }
  function aiURL(path) {
    const { port } = ai();
    return 'http://127.0.0.1:' + port + path;
  }
  function aiHeaders(extra) {
    const headers = Object.assign({ 'Content-Type': 'application/json' }, extra || {});
    const token = ai().token;
    if (token) {
      headers['X-Hasna-Notes-Token'] = token;
    }
    return headers;
  }

  // ------------------------------------------------------------------ dom helpers
  const $ = id => document.getElementById(id);
  function el(tag, cls, text) {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }
  // Rule 14 / WCAG 2.1.1 — content rows are DIVs (they host nested controls and the
  // inline rename input, which a <button> could not contain), so each clickable row is
  // made keyboard-reachable here: Tab focuses it (tabindex=0 + role=button, drawing the
  // standard :focus-visible ring), Enter/Space activates its click action. Keys arriving
  // from nested controls (row action buttons, the rename field) are left alone.
  function keyboardRow(row, label) {
    row.tabIndex = 0;
    row.setAttribute('role', 'button');
    if (label) row.setAttribute('aria-label', label);
    row.addEventListener('keydown', (e) => {
      if (e.target !== row) return;                  // a nested control owns its keys
      if (e.key !== 'Enter' && e.key !== ' ') return;
      e.preventDefault();
      row.click();
    });
    return row;
  }
  // The one relative-time formatter. Default: "just now", "8m ago", "3h ago",
  // "yesterday", "Jun 3". Short (note rows): "now", "8m", "3h", "Yesterday", "Jun 3".
  function relTime(iso, short) {
    if (!iso) return '';
    const t = Date.parse(iso);
    if (isNaN(t)) return '';
    const min = Math.floor((Date.now() - t) / 60000);
    if (min < 1) return short ? 'now' : 'just now';
    if (min < 60) return min + 'm' + (short ? '' : ' ago');
    const hr = Math.floor(min / 60);
    if (hr < 24) return hr + 'h' + (short ? '' : ' ago');
    const day = Math.floor(hr / 24);
    if (day === 1) return short ? 'Yesterday' : 'yesterday';
    if (day < 7) return day + 'd' + (short ? '' : ' ago');
    return new Date(t).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  }
  const relTimeShort = iso => relTime(iso, true);

  // Labels for a note: forward-compatible — prefer `note.labels`, fall back to `note.tags`.
  function noteLabels(n) {
    const raw = (n && Array.isArray(n.labels) && n.labels.length) ? n.labels : (n && n.tags) || [];
    return Array.isArray(raw) ? raw.filter(Boolean).map(String) : [];
  }

  function normalizeLabelList(labels) {
    const seen = Object.create(null);
    const out = [];
    (labels || []).forEach(raw => {
      const label = String(raw || '').trim();
      const key = label.toLowerCase();
      if (!label || seen[key]) return;
      seen[key] = true;
      out.push(label);
    });
    return out;
  }

  function defaultProvenance() {
    return {
      rev: 1,
      machineFriendlyName: '',
      createdByActorType: 'human',
      createdByName: '',
      archivedAt: '',
      trashedAt: '',
      trashExpiresAt: '',
      restoredAt: '',
    };
  }

  function addDaysISO(iso, days) {
    const d = new Date(iso || Date.now());
    d.setDate(d.getDate() + Math.max(1, Number(days || 30)));
    return d.toISOString();
  }

  const MARKDOWN_COMMANDS = [
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

  const CHAT_TOOL_SCHEMAS = [
    chatTool('list_notes', 'List latest notes with filters and pagination.', true, false),
    chatTool('search_notes', 'Search note titles, labels, and Markdown body text.', true, false),
    chatTool('read_note', 'Read one note by id.', true, false),
    chatTool('note_info', 'Read friendly note provenance and metadata by id.', true, false),
    chatTool('create_note', 'Create a new note with agent provenance.', false, false),
    chatTool('update_note', 'Replace title and/or body for one note.', false, true),
    chatTool('append_note', 'Append Markdown text to one note.', false, true),
    chatTool('label_note', 'Assign one label to one note.', false, false),
    chatTool('unlabel_note', 'Remove one label from one note.', false, false),
    chatTool('archive_note', 'Archive one note.', false, true),
    chatTool('trash_note', 'Move one note to Trash.', false, true),
    chatTool('restore_note', 'Restore one note.', false, true),
    chatTool('summarize_notes', 'Summarize selected, searched, or all visible notes.', true, false),
    chatTool('find_related_notes', 'Find notes related to a note id or query.', true, false),
    chatTool('consolidate_notes', 'Preview or create a larger consolidated note from several notes.', false, true),
  ];

  function chatTool(name, description, readOnly, requiresConfirmation) {
    return {
      name,
      description,
      safety: { readOnly: !!readOnly, mutates: !readOnly, requiresConfirmation: !!requiresConfirmation },
    };
  }

  function markdownSafeText(text) {
    return String(text || '').replace(/\\/g, '\\\\').replace(/([`*_{}\[\]()#+\-.!>|])/g, '\\$1');
  }

  // Spoken transcripts are plain prose, NOT markdown the user typed — they must be
  // stored verbatim. Running them through markdownSafeText() inserted stray backslashes
  // before ordinary punctuation ("3.5" → "3\.5", "well-being" → "well\-being",
  // "(note)" → "\(note\)"), which is the transcription-backslash bug. Normalize CRLF
  // and trim the ends, but otherwise preserve the text and its line breaks byte-for-byte.
  function transcriptToNoteBody(text) {
    return String(text || '').replace(/\r\n/g, '\n').trim();
  }

  function escapeHTML(text) {
    return String(text || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function stripMarkdownEscapes(text) {
    return String(text || '').replace(/\\([\\`*_{}\[\]()#+\-.!>|])/g, '$1');
  }

  function safeMarkdownURL(value) {
    const raw = String(value || '').trim();
    if (!raw) return '';
    if (/[\u0000-\u001f\u007f\\]/.test(raw)) return '';
    if (raw.startsWith('//')) return '';
    if (/^(https?:|mailto:)/i.test(raw)) return raw;
    if (/^(\/(?!\/)|[?#]|\.\.?\/)/.test(raw)) return raw;
    return '';
  }

  function markdownPlainText(markdown) {
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
      const token = '\u0000' + placeholders.length + '\u0000';
      placeholders.push(html);
      return token;
    };
    const restore = value => {
      let out = value;
      for (let pass = 0; pass <= placeholders.length; pass += 1) {
        const before = out;
        placeholders.forEach((html, i) => { out = out.replaceAll('\u0000' + i + '\u0000', html); });
        if (out === before) break;
      }
      return out;
    };
    // Strip NUL bytes first: they are the placeholder token delimiter, so pasted
    // content containing NUL<digit>NUL could otherwise spoof a token and render
    // another span's (already-sanitized) HTML in its place. NUL is never meaningful
    // text content — dropping it keeps the token space collision-free.
    let out = String(text || '').replace(/\u0000/g, '').replace(/\\([\\`*_{}\[\]()#+\-.!>|])/g, (_, ch) => hold(escapeHTML(ch)));
    out = out.replace(/`([^`]+)`/g, (_, code) => hold('<code>' + escapeHTML(code) + '</code>'));
    out = out.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, (_, label) => hold(escapeHTML(label)));
    out = out.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_, label, href) => {
      const safe = safeMarkdownURL(href);
      return safe ? hold('<a href="' + escapeHTML(safe) + '" rel="nofollow noopener noreferrer">' + escapeHTML(label) + '</a>') : hold(escapeHTML(label));
    });
    out = escapeHTML(out);
    out = out.replace(/\*\*\*([^*]+)\*\*\*/g, '<strong><em>$1</em></strong>');
    out = out.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
    out = out.replace(/\*([^*]+)\*/g, '<em>$1</em>');
    return restore(out);
  }

  function renderMarkdownSafe(markdown) {
    const lines = String(markdown || '').replace(/\r\n/g, '\n').split('\n');
    const html = [];
    let paragraph = [], list = null, inCode = false, code = [], quote = [];
    const closeParagraph = () => { if (paragraph.length) { html.push('<p>' + renderInlineMarkdown(paragraph.join(' ')) + '</p>'); paragraph = []; } };
    const closeList = () => { if (list) { html.push('<' + list.type + '>' + list.items.join('') + '</' + list.type + '>'); list = null; } };
    const closeQuote = () => { if (quote.length) { html.push('<blockquote>' + quote.map(renderInlineMarkdown).join('<br>') + '</blockquote>'); quote = []; } };
    const closeBlocks = () => { closeParagraph(); closeList(); closeQuote(); };
    lines.forEach(line => {
      if (/^\s*```/.test(line)) {
        if (inCode) { html.push('<pre><code>' + escapeHTML(code.join('\n')) + '</code></pre>'); inCode = false; code = []; }
        else { closeBlocks(); inCode = true; }
        return;
      }
      if (inCode) { code.push(line); return; }
      if (!line.trim()) { closeBlocks(); return; }
      if (/^\s*---+\s*$/.test(line)) { closeBlocks(); html.push('<hr>'); return; }
      const heading = /^(#{1,6})\s+(.+)$/.exec(line);
      if (heading) { closeBlocks(); html.push('<h' + heading[1].length + '>' + renderInlineMarkdown(heading[2]) + '</h' + heading[1].length + '>'); return; }
      const quoted = /^\s{0,3}>\s?(.*)$/.exec(line);
      if (quoted) { closeParagraph(); closeList(); quote.push(quoted[1]); return; }
      const checklist = /^\s*[-*+]\s+\[([ xX])\]\s+(.+)$/.exec(line);
      if (checklist) {
        closeParagraph(); closeQuote();
        if (!list || list.type !== 'ul') { closeList(); list = { type: 'ul', items: [] }; }
        list.items.push('<li><input type="checkbox" disabled' + (checklist[1].toLowerCase() === 'x' ? ' checked' : '') + '> ' + renderInlineMarkdown(checklist[2]) + '</li>');
        return;
      }
      const bullet = /^\s*[-*+]\s+(.+)$/.exec(line);
      if (bullet) { closeParagraph(); closeQuote(); if (!list || list.type !== 'ul') { closeList(); list = { type: 'ul', items: [] }; } list.items.push('<li>' + renderInlineMarkdown(bullet[1]) + '</li>'); return; }
      const numbered = /^\s*\d+[.)]\s+(.+)$/.exec(line);
      if (numbered) { closeParagraph(); closeQuote(); if (!list || list.type !== 'ol') { closeList(); list = { type: 'ol', items: [] }; } list.items.push('<li>' + renderInlineMarkdown(numbered[1]) + '</li>'); return; }
      closeList(); closeQuote(); paragraph.push(line.trim());
    });
    if (inCode) html.push('<pre><code>' + escapeHTML(code.join('\n')) + '</code></pre>');
    closeBlocks();
    return html.join('\n');
  }

  function selectedMarkdownRange(text, start, end) {
    const length = String(text || '').length;
    const s = Math.max(0, Math.min(length, Number(start == null ? length : start)));
    const e = Math.max(0, Math.min(length, Number(end == null ? s : end)));
    return [Math.min(s, e), Math.max(s, e)];
  }

  function markdownLineRange(text, start, end) {
    const before = text.lastIndexOf('\n', Math.max(0, start - 1));
    const lineStart = before < 0 ? 0 : before + 1;
    const after = text.indexOf('\n', end);
    const lineEnd = after < 0 ? text.length : after;
    return [lineStart, lineEnd];
  }

  function stripMarkdownBlockPrefix(line) {
    return line
      .replace(/^\s{0,3}#{1,6}\s+/, '')
      .replace(/^\s{0,3}>\s?/, '')
      .replace(/^\s*[-*+]\s+\[[ xX]\]\s+/, '')
      .replace(/^\s*[-*+]\s+/, '')
      .replace(/^\s*\d+[.)]\s+/, '');
  }

  function markdownReplaceRange(text, start, end, value, selectionStart, selectionEnd) {
    return {
      markdown: text.slice(0, start) + value + text.slice(end),
      selectionStart,
      selectionEnd,
    };
  }

  function applyMarkdownCommand(markdown, input) {
    const text = String(markdown || '');
    const options = input || {};
    const commandId = String(options.commandId || options.id || '');
    let range = selectedMarkdownRange(text, options.selectionStart, options.selectionEnd);
    const start = range[0], end = range[1];
    const selected = text.slice(start, end);
    const fallback = selected || 'text';
    const wrapInline = (prefix, suffix) => {
      suffix = suffix == null ? prefix : suffix;
      const next = prefix + fallback + suffix;
      return markdownReplaceRange(text, start, end, next, start + prefix.length, start + prefix.length + fallback.length);
    };

    if (commandId === 'bold') return wrapInline('**');
    if (commandId === 'italic') return wrapInline('*');
    if (commandId === 'code') return wrapInline('`');
    if (commandId === 'link') {
      const label = markdownSafeText(selected || options.label || 'link');
      const href = safeMarkdownURL(options.href || options.url || '') || 'https://';
      const next = '[' + label + '](' + href + ')';
      return markdownReplaceRange(text, start, end, next, start + 1, start + 1 + String(label).length);
    }
    if (commandId === 'code-block') {
      const language = String(options.language || '').replace(/[`\s]/g, '');
      const body = selected || '';
      const next = '```' + language + '\n' + body + '\n```';
      return markdownReplaceRange(text, start, end, next, start + 4 + language.length, start + 4 + language.length + body.length);
    }
    if (commandId === 'divider') {
      // Insert AFTER the selection end — a divider must never replace selected text.
      const prefix = end > 0 && text[end - 1] !== '\n' ? '\n' : '';
      const suffix = end < text.length && text[end] !== '\n' ? '\n' : '';
      const next = prefix + '---' + suffix;
      return markdownReplaceRange(text, end, end, next, end + next.length, end + next.length);
    }

    const lr = markdownLineRange(text, start, end);
    const transformed = text.slice(lr[0], lr[1]).split('\n').map((line, index) => {
      const content = stripMarkdownBlockPrefix(line);
      if (commandId === 'h1') return '# ' + content;
      if (commandId === 'h2') return '## ' + content;
      if (commandId === 'h3') return '### ' + content;
      if (commandId === 'paragraph') return content;
      if (commandId === 'bullet-list') return '- ' + content;
      if (commandId === 'numbered-list') return (index + 1) + '. ' + content;
      if (commandId === 'quote') return '> ' + content;
      if (commandId === 'checklist') return '- [ ] ' + content;
      return line;
    }).join('\n');
    return markdownReplaceRange(text, lr[0], lr[1], transformed, lr[0], lr[0] + transformed.length);
  }

  // The distinct label set across all notes, with counts, sorted by name.
  function allLabels() {
    const counts = Object.create(null);
    state.labels.forEach(label => { counts[label] = counts[label] || 0; });
    state.notes.forEach(n => { noteLabels(n).forEach(l => { counts[l] = (counts[l] || 0) + 1; }); });
    return Object.keys(counts).sort((a, b) => a.localeCompare(b)).map(name => ({ name: name, count: counts[name] }));
  }

  // ------------------------------------------------------------------ data model ops
  function sortNotes(list) {
    return list.slice().sort((a, b) => Date.parse(b.updatedAt || 0) - Date.parse(a.updatedAt || 0));
  }

	  // Notes after machine-filter + label-filter + status-filter, newest first. The list the user sees.
	  // Owner brief 2026-08-19 req 8: archive is blended into trash — the Trash view
	  // shows both trashed AND archived notes (existing archived notes stay visible).
	  function visibleNotes() {
	    return sortNotes(state.notes.filter(n => {
	      if (state.labelFilter !== ALL && noteLabels(n).indexOf(state.labelFilter) < 0) return false;
      if (state.statusFilter === 'active' && (n.status === 'archived' || n.status === 'trash')) return false;
      if (state.statusFilter === 'archived' && n.status !== 'archived') return false;
      if (state.statusFilter === 'trash' && n.status !== 'trash' && n.status !== 'archived') return false;
      return true;
    }));
  }

  function visibleNotesPage() {
    const list = visibleNotes();
    return {
      items: list.slice(0, state.noteListLimit),
      total: list.length,
      limit: state.noteListLimit,
      hasMore: list.length > state.noteListLimit,
    };
  }

	  function noteById(id) { return state.notes.find(n => n.id === id) || null; }


	  // ------------------------------------------------------------------ persistence bridge
  // Send a write to the native host (or, in-browser, just keep the in-memory model).
  function postNative(action, note, extra) {
    if (native()) {
      try { window.webkit.messageHandlers.notes.postMessage(Object.assign({ action: action, note: note }, extra || {})); }
      catch (e) { /* host gone — ignore */ }
    }
  }

  // Send a native window-control message (compact mode). No-op in a plain browser.
  function postWindow(action, extra) {
    if (nativeWindow()) {
      try { window.webkit.messageHandlers.window.postMessage(Object.assign({ action: action }, extra || {})); }
      catch (e) { /* host gone — ignore */ }
    }
  }

  // The native host overlays a transparent drag strip across the FULL header band so the
  // window is movable by its header (the WKWebView alone swallows drags). That strip would
  // also swallow clicks on the header controls — so we report each interactive control's
  // viewport rect (CSS px, top-left origin) to native, which punches matching pass-through
  // holes in the strip. Controls opt in with `data-no-drag`. Recomputed on layout changes.
  function reportDragExclusions() {
    if (!nativeWindow()) return;
    try {
      const rects = [];
      document.querySelectorAll('[data-no-drag]').forEach((el) => {
        const r = el.getBoundingClientRect();
        // Skip controls in the hidden shell (display:none ⇒ zero-size rect).
        if (r.width <= 0 || r.height <= 0) return;
        rects.push({ x: r.left, y: r.top, w: r.width, h: r.height });
      });
      postWindow('dragExclusions', { rects: rects });
    } catch (e) { /* host gone — ignore */ }
  }

  // Coalesce bursts (resize, shell switch, render) into one report per frame.
  let _dragExclRAF = 0;
  function scheduleDragExclusions() {
    if (!nativeWindow()) return;
    if (_dragExclRAF) return;
    _dragExclRAF = requestAnimationFrame(() => { _dragExclRAF = 0; reportDragExclusions(); });
  }

  // ------------------------------------------------------------------ toast
  let toastTimer = null;
  function toast(msg) {
    const t = $('toast');
    if (!t) return;
    t.textContent = msg;
    t.hidden = false;
    // force reflow so the transition runs even on rapid repeats
    void t.offsetWidth;
    t.classList.add('toast-show');
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
      t.classList.remove('toast-show');
      // hide after the fade-out finishes
      setTimeout(() => { if (!t.classList.contains('toast-show')) t.hidden = true; }, 220);
    }, 1900);
  }

  // ------------------------------------------------------------------ rendering
  function render() {
    renderLabels();
    renderNotesList();
    renderContent();
    renderSettingsMeta();
    renderHome();
    renderNavActive();
    renderLabelsPage(); // Settings → Labels management list stays in sync
    renderRecPill();    // recording indicator: bottom-center, visible on every screen
    syncHeaderScrollEdge(); // header scroll-edge fade tracks the now-visible scroller
  }

  // Labels filter section in the sidebar: "All" + one row per distinct label
  // (name + count). Selecting a label filters the notes list. Hidden entirely when there
  // are no labels anywhere, to keep the sidebar compact. Collapsible (section header).
  function renderLabels() {
    const host = $('labels-list');
    const section = $('labels-section');
    const wrap = $('labels-wrap');
    if (!host) return;
    host.innerHTML = '';
    const labels = allLabels();
    if (labels.length === 0) {
      if (section) section.hidden = true;
      if (wrap) wrap.hidden = true;
      // If a label filter was active but its label vanished, reset to All.
      if (state.labelFilter !== ALL) state.labelFilter = ALL;
      return;
    }
    if (section) {
      section.hidden = false;
      section.classList.toggle('collapsed', collapsedSections.labels);
    }
    if (wrap) wrap.hidden = collapsedSections.labels;

    host.appendChild(labelRow(ALL, 'All', state.notes.length));
    labels.forEach(l => host.appendChild(labelRow(l.name, l.name, l.count)));
  }

  function labelRow(id, label, count) {
    const row = el('div', 'label-row');
    row.dataset.label = id;
    keyboardRow(row, 'Filter notes by label: ' + label);
    if (state.labelFilter === id) row.classList.add('active');
    const left = el('div', 'lr-left');
    const ico = document.createElement('span');
    ico.className = 'lr-ico';
    ico.innerHTML = (id === ALL)
      ? '<svg viewBox="0 0 16 16" fill="none"><path d="M3 4.5h10M3 8h10M3 11.5h7" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/></svg>'
      : '<svg viewBox="0 0 16 16" fill="none"><path d="M7.5 2.5H12a1.5 1.5 0 011.5 1.5v4.5L8 14 2 8l5.5-5.5z" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round"/><circle cx="9.8" cy="6.2" r="1" fill="currentColor"/></svg>';
    left.appendChild(ico);
    left.appendChild(el('span', 'lr-name', label));
    row.appendChild(left);
    row.appendChild(el('span', 'lr-count', String(count)));
    row.addEventListener('click', (ev) => {
      // The second click of a double-click (ev.detail 2) must not re-render — the
      // row it targets gets replaced, and the dblclick rename below would land on a
      // detached node (owner brief 2026-08-19 req 7: double-click edits inline).
      if (ev.detail > 1) return;
      state.labelFilter = id;
      state.noteListLimit = 10;
      // If the open note is filtered out, drop selection to newest visible.
      const sel = noteById(state.selectedId);
      if (sel && state.labelFilter !== ALL && noteLabels(sel).indexOf(state.labelFilter) < 0) {
        const v = visibleNotes();
        state.selectedId = v.length ? v[0].id : null;
      }
      render();
    });
    // Double-click a sidebar label → inline rename (req 7). "All" is not renameable.
    row.addEventListener('dblclick', (ev) => {
      if (id === ALL) return;
      ev.preventDefault();
      startLabelInlineRename(label, row);
    });
    return row;
  }

  // Reflect the active nav item (Home / Trash icons in the sidebar foot, Chat in the
  // header). Owner brief 2026-08-19 req 8: archive is blended into trash — both icons
  // light up for the single Trash view.
  function renderNavActive() {
    const home = $('nav-home');
    if (home) home.classList.toggle('active', state.screen === 'home');
    const inTrash = state.screen === 'noteslist' && state.statusFilter === 'trash';
    const archive = $('nav-archive');
    if (archive) archive.classList.toggle('active', inTrash);
    const trash = $('nav-trash');
    if (trash) trash.classList.toggle('active', inTrash);
    const chat = $('open-chat');
    if (chat) chat.classList.toggle('active', state.screen === 'chat');
  }

  // Decide which content panel is visible: Home, Chat, the full Notes page, or the editor.
  function renderContent() {
    const home = $('home-state');
    const np = $('notes-page');
    const chat = $('chat-page');
    const ed = $('editor'), empty = $('empty-state'), nomatch = $('nomatch-state');
    // The editor delete + copy actions live in the content header (traffic-light row)
    // and are only meaningful while the editor is showing; renderEditor un-hides them.
    const del = $('note-delete');
    if (del) del.hidden = true;
    const copy = $('note-copy');
    if (copy) copy.hidden = true;
    // 'Updated just now' tracks the editor like the copy/delete actions (owner brief
    // 2026-08-19 req 5: it sits on the header row, aligned with those buttons).
    const chUp = $('ch-updated');
    if (chUp) chUp.hidden = true;
    // The markdown popover/slash menu belong to the editor surface only.
    if (state.screen !== 'notes') { closeMdPop(); closeSlashMenu(); }
    const hideEditorStates = () => {
      if (ed) ed.hidden = true;
      if (empty) empty.hidden = true;
      if (nomatch) nomatch.hidden = true;
    };
    // Settings and compact have their own shells — never fall through to renderEditor
    // (which would mutate the selection / editor state for a hidden editor). This was
    // the settings fallthrough defect (owner brief 2026-08-19 req 9).
    if (state.screen === 'settings' || state.screen === 'compact') {
      if (home) home.hidden = true;
      if (np) np.hidden = true;
      if (chat) chat.hidden = true;
      hideEditorStates();
      return;
    }
    if (state.screen === 'home') {
      if (home) home.hidden = false;
      if (np) np.hidden = true;
      if (chat) chat.hidden = true;
      hideEditorStates();
      return;
    }
    if (state.screen === 'chat') {
      if (home) home.hidden = true;
      if (np) np.hidden = true;
      if (chat) chat.hidden = false;
      hideEditorStates();
      renderChatPage();
      return;
    }
    if (state.screen === 'noteslist') {
      if (home) home.hidden = true;
      if (np) np.hidden = false;
      if (chat) chat.hidden = true;
      hideEditorStates();
      renderNotesPage();
      return;
    }
    if (home) home.hidden = true;
    if (np) np.hidden = true;
    if (chat) chat.hidden = true;
    renderEditor();
  }

  const COPY_ICON_SVG = '<svg viewBox="0 0 16 16" fill="none"><rect x="5.5" y="5.5" width="8" height="8" rx="1.6" stroke="currentColor" stroke-width="1.3"/><path d="M3.5 10.5h-.5a1 1 0 01-1-1V3a1 1 0 011-1h6.5a1 1 0 011 1v.5" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/></svg>';
  const CHECK_ICON_SVG = '<svg viewBox="0 0 16 16" fill="none"><path d="M3.5 8.5l3 3 6-6.5" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  const RESTORE_ICON_SVG = '<svg viewBox="0 0 16 16" fill="none"><path d="M3.2 6.6A5.2 5.2 0 118 13.2M3.2 6.6V3.4M3.2 6.6h3.2" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  const TRASH_ICON_SVG = '<svg viewBox="0 0 16 16" fill="none"><path d="M3.4 4.9h9.2M6.5 4.9V3.8a.9.9 0 01.9-.9h1.2a.9.9 0 01.9.9v1.1M4.7 4.9l.55 7.3a.9.9 0 00.9.83h3.7a.9.9 0 00.9-.83l.55-7.3" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/></svg>';

  // Icon-only copy feedback: swap the glyph to a checkmark for a beat — no "Copied" text.
  function copyFeedback(btn) {
    if (!btn || btn.classList.contains('copied')) return;
    const original = btn.innerHTML;
    btn.innerHTML = CHECK_ICON_SVG;
    btn.classList.add('copied');
    setTimeout(() => { btn.innerHTML = original; btn.classList.remove('copied'); }, 1100);
  }

  // Home: recent notes as a FLAT list (no card borders/backgrounds/shadows) with a hover
  // copy control whose feedback is a checkmark icon only — no "Copied" text. One subtle
  // light-gray "View all notes" path below the list. Quick-note wiring is in bind().
  function renderHome() {
    const wrap = $('home-recent');
    const host = $('home-cards');
    if (!wrap || !host) return;
    const allRecent = sortNotes(state.notes.filter(n => n.status !== 'trash' && n.status !== 'archived'));
    const recent = allRecent.slice(0, state.recentLimit);
    host.innerHTML = '';
    // The ONE view-all path: only worth showing once there are more than the recent few.
    const viewAll = $('home-view-all');
    if (viewAll) viewAll.hidden = allRecent.length <= state.recentLimit;
    if (recent.length === 0) {
      wrap.hidden = true;
      return;
    }
    wrap.hidden = false;
    recent.forEach(n => {
      const card = el('div', 'home-card');
      const body = n.body || n.content || '';
      card.dataset.noteId = n.id;
      card.dataset.copyText = body;
      keyboardRow(card, 'Open note: ' + ((n.title && n.title.trim()) || 'Untitled Note'));
      card.appendChild(el('div', 'home-card-title', (n.title && n.title.trim()) || 'Untitled Note'));
      const sub = body.replace(/\s+/g, ' ').trim().slice(0, 72) || 'No content';
      card.appendChild(el('div', 'home-card-sub', sub));
      // Relative time on its own third row so it never crowds the preview text.
      card.appendChild(el('div', 'home-card-meta', relTime(n.updatedAt)));

      // Hover copy button (top-right, absolute → no layout shift). Feedback: the copy
      // glyph swaps to a checkmark for a beat — icon only, no text.
      const copyBtn = el('button', 'home-card-copy');
      copyBtn.type = 'button';
      copyBtn.title = 'Copy note';
      copyBtn.innerHTML = COPY_ICON_SVG;
      copyBtn.addEventListener('click', (ev) => {
        ev.stopPropagation();   // copy without opening the note
        copyToClipboard(body);
        copyFeedback(copyBtn);
      });
      card.appendChild(copyBtn);

      card.addEventListener('click', () => selectNote(n.id));
      host.appendChild(card);
    });
  }

  // ------------------------------------------------------------------ Notes page
  // The dedicated full-list page reached from the sidebar "View more" / Home "All notes".
  function showNotesPage() {
    commitEdit();
    state.screen = 'noteslist';
    showApp();
    render();
  }

  function showChatPage() {
    commitEdit();
    state.screen = 'chat';
    showApp();
    render();
    const input = $('chat-input'); if (input) input.focus();
  }

  // Trash view: the Notes page constrained to status "trash" (Restore + permanent
  // Delete via the row actions or the context menu). Archive is the same page for
  // status "archived" — both make the full note lifecycle reachable from the sidebar.
  function showStatusList(statusFilter) {
    commitEdit();
    state.statusFilter = statusFilter;
    state.labelFilter = ALL;
    state.noteListLimit = 10;
    state.screen = 'noteslist';
    showApp();
    render();
  }
  function showTrash() { showStatusList('trash'); }
  // Owner brief 2026-08-19 req 8: archive is BLENDED into just Trash — the archive
  // icon opens the same single Trash view (which shows trashed + archived notes).
  function showArchive() { showStatusList('trash'); }

  function renderNotesPage() {
    const host = $('np-list');
    const countEl = $('np-count');
    const emptyEl = $('np-empty');
    if (!host) return;
    host.innerHTML = '';
    // Single source of truth: the same machine/label/status selector as the
    // sidebar list (visibleNotes), so the Labels-page "Filter notes" flow
    // constrains this page too — just without the sidebar's limit.
    const list = visibleNotes();
    const titleEl = $('np-title');
    if (titleEl) titleEl.textContent = state.statusFilter === 'trash' ? 'Trash'
      : (state.statusFilter === 'archived' ? 'Archived' : 'Notes');
    if (countEl) {
      const bits = [list.length === 1 ? '1 note' : list.length + ' notes'];
      if (state.labelFilter !== ALL) bits.push(state.labelFilter);
      if (state.statusFilter !== 'active') bits.push(state.statusFilter);
      countEl.textContent = bits.join(' · ');
    }
    if (emptyEl) {
      emptyEl.hidden = list.length !== 0;
      emptyEl.textContent = state.statusFilter === 'trash' ? 'Trash is empty'
        : (state.statusFilter === 'archived' ? 'No archived notes' : 'No notes yet');
    }
    list.forEach(n => {
      const row = el('div', 'np-row');
      row.dataset.id = n.id;
      keyboardRow(row, 'Open note: ' + ((n.title && n.title.trim()) || 'Untitled Note'));
      const body = (n.body || n.content || '').replace(/\s+/g, ' ').trim();
      row.appendChild(el('div', 'np-row-title', (n.title && n.title.trim()) || 'Untitled Note'));
      row.appendChild(el('div', 'np-row-sub', body.slice(0, 120) || 'No content'));
      // Third row: friendly relative time, kept compact and muted. No "Deleted
      // forever" countdown — trash is never deleted (owner brief 2026-08-19 req 8).
      const meta = el('div', 'np-row-meta');
      const age = relTime(n.updatedAt);
      if (age) meta.appendChild(el('span', 'np-row-age', age));
      row.appendChild(meta);
      row.appendChild(noteRowActions(n));
      row.addEventListener('click', () => selectNote(n.id));
      row.addEventListener('contextmenu', (e) => { e.preventDefault(); openContextMenu(e, n.id); });
      host.appendChild(row);
    });
  }

  // Effective expiry for a trashed note: the stamped trashExpiresAt, with legacy trash
  // (trashed before retention stamping existed) falling back to trashedAt + retention.
  function trashExpiryMs(note) {
    const explicit = Date.parse(note.trashExpiresAt || '');
    if (!Number.isNaN(explicit)) return explicit;
    const trashed = Date.parse(note.trashedAt || '');
    if (Number.isNaN(trashed)) return NaN;
    return trashed + Math.max(1, Number(state.settings.trashRetentionDays) || 30) * 86400000;
  }

  // Hover actions on a Notes-page row: copy everywhere; Restore on archived/trashed
  // rows. NO permanent-delete button — trash is never deleted, soft delete only
  // (owner brief 2026-08-19 req 8).
  function noteRowActions(n) {
    const actions = el('div', 'np-row-actions');
    const copyBtn = el('button', 'np-act');
    copyBtn.type = 'button';
    copyBtn.title = 'Copy note';
    copyBtn.innerHTML = COPY_ICON_SVG;
    copyBtn.addEventListener('click', (ev) => {
      ev.stopPropagation();
      copyToClipboard(n.body || n.content || '');
      copyFeedback(copyBtn);
    });
    actions.appendChild(copyBtn);
    if (n.status === 'archived' || n.status === 'trash') {
      const restoreBtn = el('button', 'np-act');
      restoreBtn.type = 'button';
      restoreBtn.title = 'Restore';
      restoreBtn.innerHTML = RESTORE_ICON_SVG;
      restoreBtn.addEventListener('click', (ev) => { ev.stopPropagation(); restoreNote(n.id); });
      actions.appendChild(restoreBtn);
    }
    return actions;
  }

  // ------------------------------------------------------------------ Labels page
  function persistLabels() {
    state.labels = normalizeLabelList(state.labels);
    postNative('labels', { labels: state.labels });
  }

  function rememberLabels(labels) {
    state.labels = normalizeLabelList([].concat(state.labels || [], labels || []));
  }

  function createLabelLocal(name) {
    const label = String(name || '').trim();
    if (!label) return null;
    rememberLabels([label]);
    persistLabels();
    render();
    return label;
  }

  function renameLabelLocal(oldName, newName) {
    const from = String(oldName || '').trim();
    const to = String(newName || '').trim();
    if (!from || !to) return null;
    state.labels = normalizeLabelList(state.labels.map(label => label.toLowerCase() === from.toLowerCase() ? to : label).concat([to]));
    state.notes.forEach(note => {
      const next = normalizeLabelList(noteLabels(note).map(label => label.toLowerCase() === from.toLowerCase() ? to : label));
      if (next.join('\n') !== noteLabels(note).join('\n')) {
        note.labels = next;
        note.updatedAt = new Date().toISOString();
        postNative('save', serializeNote(note));
      }
    });
    if (state.labelFilter.toLowerCase && state.labelFilter.toLowerCase() === from.toLowerCase()) state.labelFilter = to;
    persistLabels();
    render();
    return to;
  }

  function deleteLabelLocal(name, confirmed) {
    const label = String(name || '').trim();
    if (!label) return null;
    const affected = state.notes.filter(note => noteLabels(note).some(item => item.toLowerCase() === label.toLowerCase()));
    if (!confirmed && affected.length && !window.confirm('Delete label "' + label + '" from ' + affected.length + ' note(s)?')) return null;
    state.labels = state.labels.filter(item => item.toLowerCase() !== label.toLowerCase());
    affected.forEach(note => {
      note.labels = noteLabels(note).filter(item => item.toLowerCase() !== label.toLowerCase());
      note.updatedAt = new Date().toISOString();
      postNative('save', serializeNote(note));
    });
    if (state.labelFilter.toLowerCase && state.labelFilter.toLowerCase() === label.toLowerCase()) state.labelFilter = ALL;
    persistLabels();
    render();
    return { label, affected: affected.length };
  }

  function renderLabelsPage() {
    const host = $('labels-page-list');
    const countEl = $('labels-count');
    const emptyEl = $('labels-page-empty');
    if (!host) return;
    const labels = allLabels();
    host.innerHTML = '';
    if (countEl) countEl.textContent = labels.length === 1 ? '1 label' : labels.length + ' labels';
    if (emptyEl) emptyEl.hidden = labels.length !== 0;
    labels.forEach(item => {
      const row = el('div', 'lp-row');
      row.dataset.label = item.name;
      const left = el('button', 'lp-main');
      left.type = 'button';
      left.title = 'Filter notes';
      left.innerHTML = '<span class="lp-tag-ico"><svg viewBox="0 0 16 16" fill="none"><path d="M6.8 2.4h4.4a1.4 1.4 0 011.4 1.4v4.4L8 13 3 8l3.8-5.6z" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round"/><circle cx="10.1" cy="5.5" r=".8" fill="currentColor"/></svg></span>';
      left.appendChild(el('span', 'lp-name', item.name));
      left.appendChild(el('span', 'lp-count', item.count === 1 ? '1 note' : item.count + ' notes'));
      left.addEventListener('click', (ev) => {
        // Same detail guard as the sidebar rows: the second click of a double-click
        // must not navigate away before the inline rename can start (req 7).
        if (ev.detail > 1) return;
        state.labelFilter = item.name;
        showNotesPage();
      });
      // Double-click a Settings label name → inline edit (owner brief 2026-08-19 req 7).
      left.addEventListener('dblclick', (ev) => {
        ev.preventDefault();
        startLabelInlineRename(item.name, row);
      });
      row.appendChild(left);
      const actions = el('div', 'lp-actions');
      const edit = el('button', 'lp-icon');
      edit.type = 'button';
      edit.title = 'Rename label';
      edit.innerHTML = '<svg viewBox="0 0 18 18" fill="none"><path d="M4 13.5V15h1.5l7.8-7.8-1.5-1.5L4 13.5z" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"/><path d="M12.4 4.8l1.8 1.8" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/></svg>';
      // The pencil now opens the same INLINE editor — no more window.prompt (req 7).
      edit.addEventListener('click', () => {
        startLabelInlineRename(item.name, row);
      });
      const del = el('button', 'lp-icon lp-danger');
      del.type = 'button';
      del.title = 'Delete label';
      del.innerHTML = '<svg viewBox="0 0 18 18" fill="none"><path d="M4 5.5h10M7.5 5.5V4.2a1 1 0 011-1h1a1 1 0 011 1v1.3M5.5 5.5l.6 8a1 1 0 001 .94h3.8a1 1 0 001-.94l.6-8" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/></svg>';
      del.addEventListener('click', () => deleteLabelLocal(item.name, false));
      actions.appendChild(edit);
      actions.appendChild(del);
      row.appendChild(actions);
      host.appendChild(row);
    });
  }

  // Inline label rename (owner brief 2026-08-19 req 7): swap the label name span for
  // an input, commit on Enter/blur, cancel on Esc. Works on BOTH the sidebar filter
  // rows (.label-row) and the Settings → Labels rows (.lp-row).
  function startLabelInlineRename(name, row) {
    if (name === ALL) return;
    const span = row.querySelector('.lr-name, .lp-name');
    if (!span) return;
    const input = el('input', 'label-rename');
    input.type = 'text';
    input.value = name;
    input.placeholder = 'Label';
    span.replaceWith(input);
    input.focus();
    input.select();

    let done = false;
    const commit = (save) => {
      if (done) return; done = true;
      if (save) {
        const next = input.value.trim();
        if (next && next !== name) renameLabelLocal(name, next);
      }
      render();
    };
    input.addEventListener('keydown', (ev) => {
      if (ev.key === 'Enter') { ev.preventDefault(); commit(true); }
      else if (ev.key === 'Escape') { ev.preventDefault(); commit(false); }
    });
    input.addEventListener('blur', () => commit(true));
    // Clicks inside the input must not bubble to the row's filter/navigate handler.
    input.addEventListener('click', (ev) => ev.stopPropagation());
  }

  // The one clipboard helper: async clipboard with a textarea fallback (file:// /
  // older WebKit). Callers add their own feedback (toast or inline "Copied" tag).
  function copyToClipboard(text) {
    const fallback = () => {
      try {
        const ta = document.createElement('textarea');
        ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0';
        document.body.appendChild(ta); ta.select();
        document.execCommand('copy'); document.body.removeChild(ta);
      } catch (e) { /* ignore */ }
    };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).catch(fallback);
    } else { fallback(); }
  }

  function renderNotesList() {
    const host = $('notes-list');
    const emptySide = $('notes-empty-side');
    if (!host) return;
    host.innerHTML = '';
    const page = visibleNotesPage();
    const list = page.items;

    if (list.length === 0) {
      if (emptySide) {
        emptySide.hidden = false;
        emptySide.textContent = 'No notes';
      }
      return;
    }
    if (emptySide) emptySide.hidden = true;

    list.forEach(n => {
      const row = el('div', 'note-row');
      row.dataset.id = n.id;
      keyboardRow(row, 'Open note: ' + ((n.title && n.title.trim()) || 'Untitled Note'));
      if (n.id === state.selectedId && state.screen === 'notes') row.classList.add('active');
      const title = el('span', 'note-title', (n.title && n.title.trim()) ? n.title : 'Untitled Note');
      if (!(n.title && n.title.trim())) title.classList.add('untitled');
      row.appendChild(title);
      // Subtle right-aligned relative-age tag ("2h", "Yesterday", "3d"). Never wraps.
      const age = relTimeShort(n.updatedAt);
      if (age) {
        const ageEl = el('span', 'note-age', age);
        ageEl.title = relTime(n.updatedAt);
        row.appendChild(ageEl);
      }
      row.addEventListener('click', () => selectNote(n.id));
      // Right-click → context menu (Rename / Duplicate / Copy text / Delete).
      row.addEventListener('contextmenu', (e) => { e.preventDefault(); openContextMenu(e, n.id); });
      host.appendChild(row);
    });
    if (page.hasMore) {
      const more = el('button', 'view-more', 'View more');
      more.type = 'button';
      // Navigate to the dedicated Notes page rather than expanding the sidebar inline.
      more.addEventListener('click', showNotesPage);
      host.appendChild(more);
    }
  }

  function renderEditor() {
    const editor = $('editor');
    const empty = $('empty-state');
    const nomatch = $('nomatch-state');
    const del = $('note-delete');
    const copy = $('note-copy');
    const list = visibleNotes();
    const note = noteById(state.selectedId);
    const selVisible = note && list.some(n => n.id === note.id);

    // Decide which panel shows. The header delete + copy + 'updated' controls track
    // the editor (owner brief 2026-08-19 req 5: updated-time on the header row).
    if (del) del.hidden = !selVisible;
    if (copy) copy.hidden = !selVisible;
    const chUpd = $('ch-updated');
    if (chUpd) chUpd.hidden = !selVisible;
    if (selVisible) {
      editor.hidden = false; empty.hidden = true; nomatch.hidden = true;
      fillEditor(note);
      return;
    }
    editor.hidden = true;

    if (state.notes.length === 0) {
      // Truly zero notes anywhere.
      empty.hidden = false; nomatch.hidden = true;
    } else if (list.length === 0) {
      // There are notes, but the current filter/search hides them all. Name the
      // filter that actually caused the miss — a label/status miss must not claim
      // "no notes on this machine" (the machine may well own hidden notes).
      empty.hidden = true; nomatch.hidden = false;
      const desc = $('nomatch-desc');
      if (desc) {
        if (state.statusFilter === 'archived') desc.textContent = 'No archived notes here yet.';
        else if (state.statusFilter === 'trash') desc.textContent = 'Trash is empty.';
        else if (state.labelFilter !== ALL) desc.textContent = 'No notes with the label “' + state.labelFilter + '” here.';
        else desc.textContent = 'No notes match the current filters.';
      }
    } else {
      // There ARE visible notes but none selected — select the newest and show it.
      state.selectedId = list[0].id;
      renderEditor();
    }
  }

  function fillEditor(note) {
    const titleEl = $('editor-title');
    const bodyEl = $('editor-body');
    // A different note is taking the editor — any in-flight edit baseline is stale.
    if (editBase && editBase.id !== note.id) editBase = null;
    if (editBase) {
      // In-flight local edits (the host hydrates after EVERY write, including our own
      // save round-trip): never stomp keystrokes typed inside the save debounce. Only
      // adopt a field whose content genuinely changed from ANOTHER source — it differs
      // from what we last committed AND carries a newer updatedAt than our last edit.
      const externalTitle = note.title !== editBase.title;
      const externalBody = note.body !== editBase.body;
      const newer = (Date.parse(note.updatedAt) || 0) > (Date.parse(editBase.updatedAt) || 0);
      if ((externalTitle || externalBody) && newer) {
        if (externalTitle && titleEl.value !== note.title) titleEl.value = note.title || '';
        if (externalBody && bodyEl.value !== note.body) bodyEl.value = note.body || '';
        editBase = { id: note.id, title: note.title, body: note.body, updatedAt: note.updatedAt };
      }
    } else {
      // Only overwrite the field value when it differs, so we don't disturb the caret
      // while the user is typing (render() can be called from machine-filter clicks etc).
      if (titleEl.value !== note.title) titleEl.value = note.title || '';
      if (bodyEl.value !== note.body) bodyEl.value = note.body || '';
    }

    // 'Updated just now' lives on the top header row (owner brief 2026-08-19 req 5),
    // aligned with copy/trash/comments/minimize — set the header span, not the
    // removed .editor-meta span.
    const chUpd = $('ch-updated');
    if (chUpd) chUpd.textContent = 'updated ' + relTime(note.updatedAt);

    const tags = $('em-tags');
    tags.innerHTML = '';
    (note.labels || []).forEach(t => {
      const dot = el('span', 'em-dot', '·');
      tags.appendChild(dot);
      tags.appendChild(el('span', 'em-tag', t));
    });
  }

  // ------------------------------------------------------------------ editor actions
  let saveTimer = null;
  // Baseline for the note being edited: the content we last committed (or the model
  // content when typing started) + its updatedAt. fillEditor uses it to tell our own
  // save echoes apart from genuine external writes, so hydrate() can't wipe keystrokes
  // still inside the debounce window. Cleared when another note takes the editor.
  let editBase = null; // { id, title, body, updatedAt }
  function markEditBase(n) {
    if (!editBase || editBase.id !== n.id) {
      editBase = { id: n.id, title: n.title, body: n.body, updatedAt: n.updatedAt };
    }
  }
  function scheduleSave() {
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(commitEdit, 600);
  }

  // ---------- AI auto-title (Feature 6) ----------
  // While typing a body whose note still has a default title (and the title was never
  // manually edited), once the body crosses ~10–12 words, debounce then ask the sidecar
  // for a short title and apply it. Only fires once per note while still default-titled.
  let autoTitleTimer = null;
  function isDefaultTitle(t) { return DEFAULT_TITLES.indexOf((t || '').trim()) >= 0; }
  function wordCount(s) { return (s || '').trim().split(/\s+/).filter(Boolean).length; }
  function titleFingerprint(text) {
    let h = 0xcbf29ce484222325n;
    const bytes = new TextEncoder().encode(String(text || '').slice(0, 4000));
    for (const b of bytes) {
      h ^= BigInt(b);
      h = BigInt.asUintN(64, h * 0x100000001b3n);
    }
    return h.toString(16);
  }

  function maybeAutoTitle() {
    if (!ai().available) return;                      // no key/sidecar
    const note = noteById(state.selectedId);
    if (!note) return;
    if (titleManuallyEdited[note.id]) return;         // user named it — never override
    // Use the LIVE editor fields, not the model: the model's body/title only update on the
    // save debounce (commitEdit), which lags the keystrokes that drive this check.
    const titleEl = $('editor-title');
    const bodyEl = $('editor-body');
    const liveTitle = titleEl ? titleEl.value : note.title;
    const liveBody = bodyEl ? bodyEl.value : note.body;
    const titleText = markdownPlainText(liveBody);
    if (!isDefaultTitle(liveTitle)) return;           // already has a real title
    const fp = titleFingerprint(titleText);
    if (note.titleSource === 'generated' && note.titleContentFingerprint === fp) return;
    if (autoTitled[note.id] === fp) return;           // already tried this content
    if (wordCount(titleText) < 10) return;             // not enough content yet

    if (autoTitleTimer) clearTimeout(autoTitleTimer);
    const id = note.id;
    autoTitleTimer = setTimeout(() => { requestAutoTitle(id, liveBody); }, 1200);
  }

  function requestAutoTitle(id, body) {
    const note = noteById(id);
    if (!note) return;
    // Re-check guards (state may have changed during the debounce window). For the open
    // note, the live title field is the most current source of truth.
    const titleEl = (state.selectedId === id) ? $('editor-title') : null;
    const curTitle = titleEl ? titleEl.value : note.title;
    const readable = markdownPlainText(body);
    const fp = titleFingerprint(readable);
    if (titleManuallyEdited[id] || note.titleLocked || (!isDefaultTitle(curTitle) && note.titleSource !== 'generated')) return;
    if (autoTitled[id] === fp) return;
    autoTitled[id] = fp;                              // mark BEFORE the request for this body
    fetch(aiURL('/title'), {
      method: 'POST',
      headers: aiHeaders(),
      body: JSON.stringify({ text: readable }),
    })
      .then(r => r.ok ? r.json() : null)
      .then(data => {
        const title = data && data.title ? String(data.title).trim() : '';
        const cur = noteById(id);
        if (!title || !cur) return;
        // Bail if the user named/changed it meanwhile.
        if (titleManuallyEdited[id] || cur.titleLocked || (!isDefaultTitle(cur.title) && cur.titleSource !== 'generated')) return;
        cur.title = title;
        cur.titleLocked = false;
        cur.titleSource = 'generated';
        cur.titleContentFingerprint = fp;
        cur.updatedAt = new Date().toISOString();
        postNative('save', serializeNote(cur));
        // Reflect in the open editor (only if this note is still open) + sidebar.
        if (state.selectedId === id) {
          const te = $('editor-title');
          if (te && isDefaultTitle(te.value)) te.value = title;
        }
        renderNotesList();
        renderHome();
      })
      .catch(() => { delete autoTitled[id]; });       // allow a retry on network failure
  }

  function queueAutoTitlesForStaleNotes() {
    if (!ai().available) return;
    let queued = 0;
    for (const note of sortNotes(state.notes)) {
      if (queued >= 5) break;                         // keep boot/hydrate cheap
      if (!note || note.titleLocked || titleManuallyEdited[note.id]) continue;
      const body = note.body || note.content || '';
      const readable = markdownPlainText(body);
      if (wordCount(readable) < 10) continue;
      const fp = titleFingerprint(readable);
      const isStaleGenerated = note.titleSource === 'generated' && note.titleContentFingerprint !== fp;
      if (!isDefaultTitle(note.title) && !isStaleGenerated) continue;
      if (autoTitled[note.id] === fp) continue;
      queued += 1;
      requestAutoTitle(note.id, body);
    }
  }

  // Pull the current title/body into the model + persist. Bumps updatedAt.
  function commitEdit() {
    if (saveTimer) { clearTimeout(saveTimer); saveTimer = null; }
    // Only commit while the note editor is the active view; on Home/Settings/Compact the
    // editor fields are stale (they don't reflect state.selectedId) and must not be written.
    if (state.screen !== 'notes') return;
    const note = noteById(state.selectedId);
    if (!note) return;
    const newTitle = $('editor-title').value;
    const newBody = $('editor-body').value;
    if (note.title === newTitle && note.body === newBody) return; // nothing changed
    note.title = newTitle;
    note.body = newBody;
    if (titleManuallyEdited[note.id] || (!isDefaultTitle(newTitle) && note.titleSource !== 'generated')) {
      note.titleLocked = true;
      note.titleSource = 'manual';
    } else if (isDefaultTitle(newTitle)) {
      note.titleLocked = false;
      note.titleSource = 'default';
      note.titleContentFingerprint = '';
    }
    note.updatedAt = new Date().toISOString();
    // The committed content is the new baseline: the host's hydrate echo for this save
    // matches it, so fillEditor won't treat our own write as an external change.
    editBase = { id: note.id, title: newTitle, body: newBody, updatedAt: note.updatedAt };
    postNative('save', serializeNote(note));
    // Re-render the sidebar (title/order may have changed) but keep editor fields intact.
    renderNotesList();
    const chUpd = $('ch-updated');
    if (chUpd) chUpd.textContent = 'updated ' + relTime(note.updatedAt);
  }

  // The shape we hand to the native host (and store in-memory).
	  function serializeNote(n) {
	    return {
	      id: n.id, title: n.title, body: n.body, content: n.body,
	      contentFormat: 'markdown',
	      labels: n.labels || [], tags: n.labels || [],
      status: n.status || 'active', folder: n.folder || '',
      machine: n.machine, updatedAt: n.updatedAt, createdAt: n.createdAt,
      machineFriendlyName: n.machineFriendlyName || '',
      rev: Number(n.rev) >= 1 ? Math.floor(Number(n.rev)) : 1,
      createdByActorType: n.createdByActorType || 'human',
      createdByName: n.createdByName || '',
      archivedAt: n.archivedAt || '',
      trashedAt: n.trashedAt || '',
      trashExpiresAt: n.trashExpiresAt || '',
      restoredAt: n.restoredAt || '',
      titleLocked: !!n.titleLocked,
      titleSource: n.titleSource || (isDefaultTitle(n.title) ? 'default' : 'manual'),
      titleContentFingerprint: n.titleContentFingerprint || '',
    };
  }

  function newNote() {
    const nowIso = new Date().toISOString();
    const note = {
      id: (window.crypto && crypto.randomUUID) ? crypto.randomUUID()
        : 'local-' + Date.now() + '-' + Math.random().toString(16).slice(2),
      title: '', body: '', labels: [], status: 'active', folder: '',
      contentFormat: 'markdown',
      machine: '', updatedAt: nowIso, createdAt: nowIso,
      ...defaultProvenance(),
      titleLocked: false, titleSource: 'default', titleContentFingerprint: '',
    };
    state.notes.push(note);
    state.selectedId = note.id;
    state.labelFilter = ALL;
    state.statusFilter = 'active';
    state.noteListLimit = 10;
    state.screen = 'notes';
    showApp();
    postNative('create', serializeNote(note));
    render();
    const titleEl = $('editor-title');
    if (titleEl) titleEl.focus();
  }

  // Create a note WITHOUT navigating to it (Home / compact quick-note flow). Stays on the
  // current screen, shows a toast, and clears nothing of the current selection.
  function quickCreate(title, body, meta) {
    const nowIso = new Date().toISOString();
    const extra = meta || {};
    const note = {
      id: extra.id || ((window.crypto && crypto.randomUUID) ? crypto.randomUUID()
        : 'local-' + Date.now() + '-' + Math.random().toString(16).slice(2)),
      title: title || '', body: body || '', labels: noteLabels(extra), status: extra.status || 'active', folder: extra.folder || '',
      contentFormat: 'markdown',
      machine: extra.machine || '', updatedAt: nowIso, createdAt: nowIso,
      ...defaultProvenance(),
      ...extra,
      titleLocked: !!(title && title.trim()), titleSource: title && title.trim() ? 'manual' : 'default',
      titleContentFingerprint: '',
    };
    state.notes.push(note);
    postNative('create', serializeNote(note));
    if (!note.titleLocked && body && body.trim() && ai().available) {
      requestAutoTitle(note.id, body);
    }
    // Re-render the sidebar list + home cards (and the Notes page when it is showing),
    // but do NOT change selectedId/screen.
    renderLabels();
    renderNotesList();
    renderHome();
    if (state.screen === 'noteslist') renderNotesPage();
    return note;
  }

  function deleteCurrent() {
    const note = noteById(state.selectedId);
    if (!note) return;
    deleteNote(note);
  }

  function selectNote(id) {
    commitEdit();              // flush any pending edit before switching away
    // Reconcile filters so the chosen note is actually visible (Cmd+K search, Home
    // recent cards, and chat source chips ignore the sidebar filters) — otherwise
    // renderEditor() silently swaps the selection to the newest visible note.
    const note = noteById(id);
    if (note) {
      if (state.labelFilter !== ALL && noteLabels(note).indexOf(state.labelFilter) < 0) state.labelFilter = ALL;
      const status = note.status === 'archived' ? 'archived' : (note.status === 'trash' ? 'trash' : 'active');
      if (state.statusFilter !== 'all' && state.statusFilter !== status) state.statusFilter = status;
    }
    state.selectedId = id;
    state.screen = 'notes';
    showApp();
    render();
  }

  // ------------------------------------------------------------------ settings + theme
  const SETTINGS_TABS = ['appearance', 'labels', 'about'];
  const win = $('window');

  function showSettings(tab) {
    // Flush any pending edit BEFORE the screen flips (commitEdit only writes while
    // 'notes' is active) — otherwise opening Settings mid-debounce drops the keystrokes.
    commitEdit();
    // Remember where the user came from so "Back to app" can restore it — leaving
    // state.screen stuck on 'settings' made the next render() force the editor over
    // whatever screen was showing (the flaky-settings symptom).
    if (state.screen !== 'settings') state.settingsReturnScreen = state.screen;
    state.screen = 'settings';
    win.setAttribute('data-active-shell', 'settings');
    const t = SETTINGS_TABS.indexOf(tab) >= 0 ? tab : 'appearance';
    document.querySelectorAll('.set-item').forEach(s => s.classList.remove('active'));
    const item = document.querySelector('.set-item[data-tab="' + t + '"]');
    if (item) item.classList.add('active');
    document.querySelectorAll('.set-page').forEach(p => p.classList.remove('active'));
    const page = document.querySelector('.set-page[data-tab="' + t + '"]');
    if (page) page.classList.add('active');
    if (t === 'labels') renderLabelsPage();
    // The visible header controls differ per shell — refresh the native drag holes.
    scheduleDragExclusions();
  }

  function showApp() {
    win.setAttribute('data-active-shell', 'app');
    // The visible header controls differ per shell — refresh the native drag holes
    // (a resize while Settings was open clears the app-shell holes; re-punch them).
    scheduleDragExclusions();
  }

  // Navigate to the Home landing screen (stays in the app shell, shows #home-state).
  function showHome() {
    commitEdit();
    state.screen = 'home';
    state.statusFilter = 'active'; // leaving Trash via Home resets the status filter
    showApp();
    render();
    const qn = $('qn-input'); if (qn) qn.focus();
  }

  // Enter/leave the compact quick-note layout. Drives BOTH the native window (resize via
  // the `window` bridge) and the web layout (a dedicated compact shell).
  function setCompact(on) {
    if (on) {
      commitEdit();
      // Remember where the user was so leaving compact restores it (not always Home).
      if (state.screen !== 'compact') compactReturnScreen = state.screen;
      state.screen = 'compact';
      win.setAttribute('data-active-shell', 'compact');
      postWindow('setCompact', { on: true });
      const ci = $('compact-input'); if (ci) setTimeout(() => ci.focus(), 60);
    } else {
      postWindow('setCompact', { on: false });
      state.screen = (compactReturnScreen && compactReturnScreen !== 'compact' && compactReturnScreen !== 'settings')
        ? compactReturnScreen : 'home';
      showApp();
      render();
    }
    // The visible header controls differ per shell — refresh the native drag holes.
    scheduleDragExclusions();
  }

  // Theme: persisted in localStorage, applied as data-theme on <html>. "system"
  // follows the OS via prefers-color-scheme.
  const THEME_KEY = 'notes-theme';
  const LEGACY_THEME_KEY = 'hasna-notes-theme'; // pre-rename key; read-only fallback
  function storedThemePref() {
    try { return localStorage.getItem(THEME_KEY) || localStorage.getItem(LEGACY_THEME_KEY); } catch (e) { return null; }
  }
  let mq = null;
  function applyTheme(theme) {
    const root = document.documentElement;
    let effective = theme;
    if (theme === 'system') {
      effective = (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches)
        ? 'dark' : 'light';
    }
    root.setAttribute('data-theme', effective);
    root.setAttribute('data-theme-pref', theme);
    // Reflect selection in the theme cards.
    document.querySelectorAll('.theme-card').forEach(c => {
      c.classList.toggle('theme-selected', c.getAttribute('data-theme') === theme);
    });
    // Keep the native window backing in sync with the app's own theme preference
    // (Rule 11 / spec §3.8): the shell pins the window NSAppearance for explicit
    // 'light'/'dark' (so BrandColor.canvas AND the WKWebView's prefers-color-scheme
    // resolve to the app theme, not the OS one) and returns to system for 'system'.
    // No-op in plain browsers.
    try {
      if (window.webkit && window.webkit.messageHandlers && window.webkit.messageHandlers.window) {
        window.webkit.messageHandlers.window.postMessage({ action: 'theme', theme: theme, effective: effective });
      }
    } catch (err) { /* browser mode */ }
  }
  function setTheme(theme) {
    try { localStorage.setItem(THEME_KEY, theme); } catch (e) {}
    bindSystemWatch(theme);
    applyTheme(theme);
  }
  function bindSystemWatch(theme) {
    if (!window.matchMedia) return;
    if (!mq) mq = window.matchMedia('(prefers-color-scheme: dark)');
    // Re-apply when the OS theme flips, but only while the pref is "system".
    if (!bindSystemWatch._bound) {
      const onChange = () => {
        const pref = storedThemePref() || 'system';
        if (pref === 'system') applyTheme('system');
      };
      if (mq.addEventListener) mq.addEventListener('change', onChange);
      else if (mq.addListener) mq.addListener(onChange);
      bindSystemWatch._bound = true;
    }
  }
  function initTheme() {
    const pref = storedThemePref() || 'system';
    bindSystemWatch(pref);
    applyTheme(pref);
  }

  function renderSettingsMeta() {
    const c = $('about-count'); if (c) c.textContent = String(state.notes.length);
    // Real version from the native host (window.__VERSION__ = Info.plist values,
    // see docs/ui-contracts.md "Version Bridge"). Without it (plain browser,
    // unbundled dev binary) the static #about-version markup is left untouched.
    const v = $('about-version');
    const ver = window.__VERSION__ || {};
    if (v && ver.version) v.textContent = 'Version ' + ver.version + (ver.build ? ' (' + ver.build + ')' : '');
    renderRetentionRow(); // keep the 7/30/90 picker in sync with boot/API settings
  }

  // ------------------------------------------------------------------ context menu (Feature 3)
  let ctxNoteId = null;

  function openContextMenu(e, noteId) {
    const menu = $('ctx-menu');
    if (!menu) return;
    ctxNoteId = noteId;
    // Status-aware items: Archive only on active notes, Restore only on archived/trashed
    // ones. Delete is ALWAYS "Move to Trash" — there is no permanent delete; a note
    // already in Trash hides the item (owner brief 2026-08-19 req 8).
    const note = noteById(noteId);
    const status = (note && note.status) || 'active';
    menu.querySelectorAll('.ctx-item[data-act]').forEach(item => {
      const act = item.getAttribute('data-act');
      if (act === 'archive') item.hidden = status !== 'active';
      if (act === 'restore') item.hidden = status === 'active';
      if (act === 'delete') { item.hidden = status === 'trash'; item.textContent = 'Move to Trash'; }
    });
    menu.hidden = false;
    // Position at the cursor, clamped to the viewport.
    const mw = menu.offsetWidth || 180, mh = menu.offsetHeight || 160;
    let x = e.clientX, y = e.clientY;
    if (x + mw > window.innerWidth - 8) x = window.innerWidth - mw - 8;
    if (y + mh > window.innerHeight - 8) y = window.innerHeight - mh - 8;
    menu.style.left = x + 'px';
    menu.style.top = y + 'px';
  }

  function closeContextMenu() {
    const menu = $('ctx-menu');
    if (menu && !menu.hidden) menu.hidden = true;
    ctxNoteId = null;
  }

  function onCtxAction(e) {
    const act = e.currentTarget.getAttribute('data-act');
    const id = ctxNoteId;
    closeContextMenu();
    if (!id) return;
    const note = noteById(id);
    if (!note) return;
    if (act === 'rename') startInlineRename(id);
    else if (act === 'duplicate') duplicateNote(note);
    else if (act === 'copy') copyNoteText(note);
    else if (act === 'archive') archiveNote(note.id);
    else if (act === 'restore') restoreNote(note.id);
    else if (act === 'delete') deleteNote(note);
  }

  // Inline-rename: swap the row's title span for an input, commit on Enter/blur.
  // Works on BOTH the sidebar rows (.note-row) and the Notes-page rows (.np-row), so
  // renaming from the full list is never a silent no-op.
  function startInlineRename(id) {
    const esc = cssEsc(id);
    const row = document.querySelector('.note-row[data-id="' + esc + '"], .np-row[data-id="' + esc + '"]');
    const note = noteById(id);
    if (!row || !note) return;
    const titleSpan = row.querySelector('.note-title, .np-row-title');
    if (!titleSpan) return;
    const input = el('input', 'note-rename');
    input.type = 'text';
    input.value = (note.title && note.title.trim()) || '';
    input.placeholder = 'Untitled Note';
    titleSpan.replaceWith(input);
    input.focus();
    input.select();

    let done = false;
    const commit = (save) => {
      if (done) return; done = true;
      if (save) {
        const v = input.value.trim();
        note.title = v || 'Untitled Note';
        titleManuallyEdited[id] = true;   // a manual rename counts as a manual title
        note.titleLocked = true;
        note.titleSource = 'manual';
        note.updatedAt = new Date().toISOString();
        postNative('save', serializeNote(note));
        if (state.selectedId === id) {
          const te = $('editor-title'); if (te) te.value = note.title;
        }
      }
      renderNotesList();
      renderHome();
      if (state.screen === 'noteslist') renderNotesPage(); // Notes page shows the result too
    };
    input.addEventListener('keydown', (ev) => {
      if (ev.key === 'Enter') { ev.preventDefault(); commit(true); }
      else if (ev.key === 'Escape') { ev.preventDefault(); commit(false); }
    });
    input.addEventListener('blur', () => commit(true));
    // Don't let clicks inside the input bubble to the row (which would selectNote).
    input.addEventListener('click', (ev) => ev.stopPropagation());
  }

  // Escape a string for use in a [data-id="..."] selector.
  function cssEsc(s) {
    if (window.CSS && CSS.escape) return CSS.escape(s);
    return String(s).replace(/["\\]/g, '\\$&');
  }

  function duplicateNote(src) {
    const baseTitle = (src.title && src.title.trim()) || 'Untitled Note';
    const dup = quickCreate(baseTitle + ' copy', src.body || '');
    // Carry over labels/folder for a faithful copy.
    dup.labels = noteLabels(src).slice();
    dup.folder = src.folder || '';
    postNative('save', serializeNote(dup));
    toast('Note duplicated');
  }

  function copyNoteText(note) {
    copyToClipboard(note.body || '');
    toast('Copied to clipboard');
  }

  function archiveNote(id) {
    const note = noteById(id);
    if (!note || note.status === 'trash') return;
    // Owner brief 2026-08-19 req 8: archive is BLENDED into just Trash — archiving
    // sends the note to the single Trash view (status 'trash'), never to a separate
    // archived state. The host 'trash' verb is used with confirmation so the write
    // is not dropped by the destructive gate.
    const now = new Date().toISOString();
    note.status = 'trash';
    note.archivedAt = '';
    note.trashedAt = now;
    note.trashExpiresAt = addDaysISO(now, state.settings.trashRetentionDays);
    note.updatedAt = now;
    postNative('trash', serializeNote(note), { confirmed: true });
    dispatchNoteEvent('hasna:note-trash', note);
    render();
  }

  function restoreNote(id) {
    const note = noteById(id);
    if (!note) return;
    note.status = 'active';
    note.archivedAt = '';
    note.trashedAt = '';
    note.trashExpiresAt = '';
    note.restoredAt = new Date().toISOString();
    note.updatedAt = note.restoredAt;
    postNative('restore', serializeNote(note));
    dispatchNoteEvent('hasna:note-restore', note);
    render();
  }

  function trashNote(note, options) {
    if (note.status === 'trash') return note;
    const now = new Date().toISOString();
    note.status = 'trash';
    note.trashedAt = now;
    note.trashExpiresAt = addDaysISO(now, state.settings.trashRetentionDays);
    note.updatedAt = now;
    postNative('trash', serializeNote(note), { confirmed: !!(options && options.confirmed) });
    dispatchNoteEvent('hasna:note-trash', note);
    return note;
  }

  function purgeNote(id) {
    // Owner brief 2026-08-19 req 8: trash is NEVER deleted — soft delete / hidden
    // state only. Permanent purge is disabled app-wide: the note stays in Trash
    // forever (the host 'purge' verb is never invoked).
    return null;
  }
  function dispatchNoteEvent(name, note, extra) {
    window.dispatchEvent(new CustomEvent(name, {
      detail: Object.assign({ note: serializeNote(note), noteId: note.id }, extra || {}),
    }));
  }

  function noteInfo(id) {
    const note = noteById(id);
    if (!note) return null;
    const bootInfo = note.info || {};
    return {
      createdBy: note.createdByName || note.author || 'Unknown',
      createdByActorType: note.createdByActorType || 'human',
      createdAt: note.createdAt,
      machine: note.machine,
      machineFriendlyName: note.machineFriendlyName || bootInfo.machineFriendlyName || '',
      currentMachine: note.machine,
      rev: Number(note.rev) >= 1 ? Math.floor(Number(note.rev)) : 1,
    };
  }

  function cleanupExpiredTrash() {
    // Owner brief 2026-08-19 req 8: trash is NEVER deleted — retention-based purge
    // is disabled app-wide. Expired-looking trashed notes stay hidden in Trash.
    return [];
  }

  function expiredTrashNotes() {
    const now = Date.now();
    return state.notes.filter(n => {
      if (n.status !== 'trash') return false;
      const expires = trashExpiryMs(n);
      return !Number.isNaN(expires) && expires <= now;
    });
  }

  // Retention enforcement is DISABLED (owner brief 2026-08-19 req 8): trash is never
  // deleted, so nothing is ever purged on boot/hydrate.
  function maybeCleanupExpiredTrash() {
    return;
  }

  function notifyExpiredTrashReady() {
    const expired = expiredTrashNotes();
    if (!expired.length) return [];
    window.dispatchEvent(new CustomEvent('hasna:trash-cleanup-ready', {
      detail: {
        count: expired.length,
        noteIds: expired.map(n => n.id),
        notes: expired.map(serializeNote),
      },
    }));
    return expired.map(n => n.id);
  }

  function setStatusFilter(filter) {
    state.statusFilter = ['active', 'archived', 'trash', 'all'].includes(filter) ? filter : 'active';
    state.noteListLimit = 10;
    render();
  }

  // Trash retention setting. Clamps to >= 1 day (0 or negative → 1, like the Swift
  // side) so a bad value can never silently disable retention; non-numeric input keeps
  // the 30-day default. Settings → Appearance exposes 7/30/90.
  function setTrashRetentionDays(days) {
    const n = Number(days == null ? 30 : days);
    state.settings.trashRetentionDays = Number.isFinite(n) ? Math.max(1, Math.round(n)) : 30;
    postNative('settings', state.settings);
    renderRetentionRow();
    return Object.assign({}, state.settings);
  }

  function renderRetentionRow() {
    const row = $('retention-row');
    if (!row) return;
    row.querySelectorAll('.retention-opt').forEach(btn => {
      btn.classList.toggle('active', Number(btn.getAttribute('data-days')) === Number(state.settings.trashRetentionDays));
    });
  }

  function noteTitleForConfirm(note) {
    return (note && note.title && note.title.trim()) || 'Untitled Note';
  }

  function deleteConfirmationMessage(note) {
    // Owner brief 2026-08-19 req 8: there is NO permanent delete — the only delete
    // is move-to-Trash, and Trash is never emptied.
    const title = noteTitleForConfirm(note);
    return 'Move note to Trash?\n\n"' + title + '" can be restored from Trash.';
  }

  function confirmNoteDelete(note, options) {
    if (typeof window.confirm !== 'function') return false;
    return window.confirm(deleteConfirmationMessage(note, options));
  }

  // Delete a specific note (by reference). Delete is ALWAYS move-to-Trash — a note
  // already in Trash stays hidden (owner brief 2026-08-19 req 8: never deleted).
  function deleteNote(note) {
    if (!confirmNoteDelete(note)) return null;
    trashNote(note, { confirmed: true });
    render();
    return serializeNote(note);
  }

  function trashNoteWithConfirmation(id) {
    const note = noteById(id);
    if (!note) return null;
    if (note.status === 'trash') return serializeNote(note);
    if (!confirmNoteDelete(note)) return null;
    trashNote(note, { confirmed: true });
    render();
    return serializeNote(note);
  }

  function purgeNoteWithConfirmation(id) {
    // Inert under the soft-delete policy (owner brief 2026-08-19 req 8): permanent
    // deletion does not exist; the note stays in Trash.
    return null;
  }

	  // ------------------------------------------------------------------ app-level voice notes
	  const rec = {
	    status: 'idle',       // idle | recording | paused | stopping | transcribing | complete | error
	    mode: 'bounded',      // realtime | bounded
	    provider: 'openai-bounded', // contract values: openai | elevenlabs | openai-bounded
    mediaRecorder: null,
    chunks: [],
    stream: null,
    timer: null,
    started: 0,
    pausedAccumMs: 0,     // total time spent paused (excluded from elapsed)
    pausedAt: 0,          // Date.now() when the current pause began (0 = not paused)
    busy: false,
    ws: null,
    audioContext: null,
    source: null,
    processor: null,
    targetRate: 24000,
	    partialTranscript: '',
	    finalTranscript: '',
	    progressPhase: '',
	    progressPercent: null,
	    error: '',
	    startToken: 0,
	    finalizeTimer: null,
	  };

  const nativeRecording = () =>
    !!(window.webkit && window.webkit.messageHandlers && window.webkit.messageHandlers.recording);

  // Elapsed recording time EXCLUDING paused time (the native status item holds the
  // timer while paused — the web timer must agree).
  function recElapsedMs() {
    if (!rec.started) return 0;
    const pausedNow = rec.pausedAt ? (Date.now() - rec.pausedAt) : 0;
    return Math.max(0, Date.now() - rec.started - rec.pausedAccumMs - pausedNow);
  }

  function recElapsed() {
    const s = Math.floor(recElapsedMs() / 1000);
    const m = Math.floor(s / 60);
    return m + ':' + String(s % 60).padStart(2, '0');
  }

  function recordingSnapshot() {
    return {
      status: rec.status,
      mode: rec.mode,
      provider: rec.provider,
	      elapsed: recElapsed(),
	      partialTranscript: rec.partialTranscript,
	      finalTranscript: rec.finalTranscript,
	      progress: {
	        phase: rec.progressPhase,
	        percent: rec.progressPercent,
	      },
	      progressPhase: rec.progressPhase,
	      progressPercent: rec.progressPercent,
	      busy: !!rec.busy,
	      canPause: rec.status === 'recording',
	      canResume: rec.status === 'paused',
	      canStop: rec.status === 'recording' || rec.status === 'paused',
	      error: rec.error,
	    };
	  }

  // Map the rich rec.status to the contract lifecycle verb the host's `window` handler
  // expects, detecting started/resumed/paused/stopped transitions from the prior status.
  let lastEmittedRecStatus = 'idle';
	  function recLifecycleVerb(status) {
	    if (status === 'recording') return (lastEmittedRecStatus === 'paused') ? 'resumed' : 'started';
	    if (status === 'paused') return 'paused';
	    if (status === 'stopping') return 'stopping';
	    if (status === 'transcribing') return 'transcribing';
	    if (status === 'complete') return 'complete';
	    if (status === 'error') return 'error';
	    if (status === 'idle') return 'stopped';
	    return null;
	  }

	  function setRecordingProgress(phase, percent) {
	    rec.progressPhase = phase || '';
	    rec.progressPercent = Number.isFinite(Number(percent)) ? Math.max(0, Math.min(1, Number(percent))) : null;
	    const detail = Object.assign(recordingSnapshot(), { phase: rec.progressPhase, percent: rec.progressPercent });
	    window.dispatchEvent(new CustomEvent('hasna:recording-progress', { detail }));
	    if (nativeRecording()) {
	      try { window.webkit.messageHandlers.recording.postMessage({ action: 'progress', state: detail }); }
	      catch (e) { /* host gone */ }
	    }
	  }

  function emitRecordingState(extra) {
    const detail = Object.assign(recordingSnapshot(), extra || {});
    window.dispatchEvent(new CustomEvent('hasna:recording-state', { detail }));
    if (nativeRecording()) {
      try { window.webkit.messageHandlers.recording.postMessage({ action: 'state', state: detail }); }
      catch (e) { /* host gone */ }
    }
    // Contract: also emit the lifecycle to the host on the `window` handler so the macOS
    // menu-bar status item can reflect it: postWindow('recording', {state, elapsedMs}).
    // Only on real status transitions (not on every 500ms tick) to avoid spamming the host.
	    if (!extra || !extra.tick) {
	      const verb = recLifecycleVerb(rec.status);
	      if (verb) {
	        postWindow('recording', { state: verb, status: rec.status, elapsedMs: recElapsedMs(), progress: recordingSnapshot().progress });
	      }
	    } else {
	      // Lightweight ticking update so the menu-bar timer can stay current.
	      if (rec.status === 'recording') {
	        postWindow('recording', { state: 'tick', status: rec.status, elapsedMs: recElapsedMs(), progress: recordingSnapshot().progress });
	      }
	    }
    lastEmittedRecStatus = rec.status;
    setRecUI(rec.status);
  }

  function emitTranscript(type, text, extra) {
    const detail = Object.assign({ text: text || '', provider: rec.provider, mode: rec.mode }, extra || {});
    window.dispatchEvent(new CustomEvent(type, { detail }));
    if (nativeRecording()) {
      try { window.webkit.messageHandlers.recording.postMessage({ action: type, transcript: detail }); }
      catch (e) { /* host gone */ }
    }
  }

  // Drive the record UI: timer INSIDE the circle (stop-square revealed on hover, CSS),
  // inline pause/resume, the minimal top-right indicator on non-Home screens, and the
  // transcript surface. No "Record voice note" / "tap to stop" labels.
	  function setRecUI(stateName) {
    // Single recording surface: the quick-note composer IS the recorder on Home
    // (timer in the circle, inline pause, transcript below); everywhere else the
    // minimal top-right indicator (renderRecPill) carries the controls.
    const wrap = $('qn-form');
    const recBtn = $('rec-btn');
    const timerIn = $('rec-timer-in');
	    const active = (stateName === 'recording' || stateName === 'paused' || stateName === 'stopping' || stateName === 'transcribing');

	    if (wrap) {
	      wrap.classList.remove('recording', 'transcribing', 'paused', 'stopping', 'complete', 'error');
	      if (stateName === 'recording') wrap.classList.add('recording');
	      else if (stateName === 'paused') wrap.classList.add('recording', 'paused');
	      else if (stateName === 'stopping') wrap.classList.add('stopping');
	      else if (stateName === 'transcribing') wrap.classList.add('transcribing');
	      else if (stateName === 'complete') wrap.classList.add('complete');
	      else if (stateName === 'error') wrap.classList.add('error');
	    }
	    // Owner brief 2026-08-19 req 1: while recording on Home, the recent files
	    // disappear (CSS .home.rec-active .home-recent) — only pause + timer stay.
	    const homeState = $('home-state');
	    if (homeState) homeState.classList.toggle('rec-active', active);
	    if (timerIn && active) timerIn.textContent = stateName === 'transcribing' ? '' : recElapsed();
    if (recBtn) {
      const cfg = ai();
      recBtn.setAttribute('aria-label',
	        active ? (stateName === 'transcribing' ? 'Transcribing recording' : 'Stop recording') : ((cfg.available || cfg.realtime) ? 'Record a voice note' : 'Voice notes need an OpenAI key'));
	    }
    // Compact quick-note shell (task 9ec010a2): the minimized window mirrors the
    // Home composer's single-surface pattern — while a recording is active the
    // compact form carries the same state classes (input + Add hidden, mic pulsing).
    const cForm = $('compact-form');
    if (cForm) {
      cForm.classList.remove('recording', 'transcribing', 'paused', 'stopping', 'complete', 'error');
      if (stateName === 'recording') cForm.classList.add('recording');
      else if (stateName === 'paused') cForm.classList.add('recording', 'paused');
      else if (stateName === 'stopping') cForm.classList.add('stopping');
      else if (stateName === 'transcribing') cForm.classList.add('transcribing');
      else if (stateName === 'complete') cForm.classList.add('complete');
      else if (stateName === 'error') cForm.classList.add('error');
    }
    const cRec = $('compact-rec');
    if (cRec) {
      const cfg = ai();
      cRec.setAttribute('aria-label',
        active ? (stateName === 'transcribing' ? 'Transcribing recording' : 'Stop recording') : ((cfg.available || cfg.realtime) ? 'Record a voice note' : 'Voice notes need an OpenAI key'));
    }
    updateComposerControls();
    renderRecPill();
    renderTranscript();
  }

  // Minimal recording indicator (bottom-center, owner brief 2026-08-19 req 6):
  // recording survives in-app navigation, so the pill carries the timer + pause/stop
  // on EVERY screen — Home included — and stays visible while the note is being
  // added (status 'complete', immediately after stop).
	  function renderRecPill() {
	    const pill = $('rec-pill');
	    if (!pill) return;
	    const active = (rec.status === 'recording' || rec.status === 'paused' ||
	      rec.status === 'stopping' || rec.status === 'transcribing' || rec.status === 'complete');
	    pill.hidden = !active;
	    if (!active) return;
	    pill.classList.toggle('paused', rec.status === 'paused');
	    pill.classList.toggle('transcribing', rec.status === 'transcribing');
	    pill.classList.toggle('stopping', rec.status === 'stopping');
	    const t = $('rec-pill-timer'); if (t) t.textContent = recElapsed();
	    const pb = $('rec-pill-pause');
	    if (pb) {
	      pb.hidden = !(rec.status === 'recording' || rec.status === 'paused');
	      pb.title = (rec.status === 'paused') ? 'Resume' : 'Pause';
	    }
	  }

  // Transcript surface: committed final text + a muted trailing partial line. Internal
  // scroll, fixed min-height — never shifts page layout. Hidden until any text arrives.
  function renderTranscript() {
    const surface = $('transcript');
    const finalEl = $('transcript-final');
    const partialEl = $('transcript-partial');
    if (!surface) return;
    const f = rec.finalTranscript || '';
    const p = rec.partialTranscript || '';
    if (!f && !p) { surface.hidden = true; return; }
    surface.hidden = false;
    if (finalEl && finalEl.textContent !== f) finalEl.textContent = f ? (f + (p ? ' ' : '')) : '';
    if (partialEl && partialEl.textContent !== p) partialEl.textContent = p;
    // Keep the newest text in view without janking the rest of the page.
    const body = $('transcript-body');
    if (body) body.scrollTop = body.scrollHeight;
  }

	  function onRecordClick() {
	    const cfg = ai();
	    if ((!cfg.available && !cfg.realtime) || rec.busy) return;
	    if (rec.status === 'recording' || rec.status === 'paused') { stopRecording(); return; }
	    if (rec.status === 'stopping' || rec.status === 'transcribing') return;
	    startRecording();
	  }

  // Pick a recording container that OpenAI gpt-4o-transcribe accepts. The model rejects
  // some AAC/m4a containers, so prefer webm/opus and ogg/opus first, then fall back to
  // whatever the platform offers (the sidecar surfaces a clear error if unsupported).
  function pickRecorderMime() {
    const prefs = [
      'audio/webm;codecs=opus',
      'audio/webm',
      'audio/ogg;codecs=opus',
      'audio/ogg',
      'audio/mp4',
      'audio/mpeg',
    ];
    if (typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported) {
      for (const t of prefs) { if (MediaRecorder.isTypeSupported(t)) return t; }
    }
    return '';   // let MediaRecorder choose its default
  }

  function startRecording() {
    const cfg = ai();
    if (!cfg.available && !cfg.realtime) {
      toast('Voice notes need an OpenAI or ElevenLabs key');
      return;
    }
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      toast('Microphone not available'); return;
    }
	    rec.error = '';
	    rec.partialTranscript = '';
	    rec.finalTranscript = '';
	    rec.status = 'idle';
	    setRecordingProgress('requesting-microphone', null);
	    rec.busy = true;
	    const token = ++rec.startToken;
	    emitRecordingState();
	    navigator.mediaDevices.getUserMedia({ audio: true })
	      .then(stream => {
	        if (token !== rec.startToken || rec.status !== 'idle') {
	          stream.getTracks().forEach(t => t.stop());
	          return;
	        }
        rec.stream = stream;
        if (cfg.realtime) return startRealtimeRecording(stream, cfg);
        return startBoundedRecording(stream);
      })
      .catch(() => {
        rec.busy = false;
        rec.status = 'error';
        rec.error = 'Microphone permission denied';
        toast(rec.error);
        emitRecordingState();
      });
  }

  function startBoundedRecording(stream) {
    rec.mode = 'bounded';
    rec.provider = 'openai-bounded';
    rec.chunks = [];
    const mime = pickRecorderMime();
    let mr;
    try { mr = mime ? new MediaRecorder(stream, { mimeType: mime }) : new MediaRecorder(stream); }
    catch (e) { mr = new MediaRecorder(stream); }
    rec.mediaRecorder = mr;
    mr.ondataavailable = (ev) => { if (ev.data && ev.data.size) rec.chunks.push(ev.data); };
    mr.onstop = onBoundedRecordingStopped;
    mr.start();
    beginRecordingClock();
  }

  function startRealtimeRecording(stream, cfg) {
    rec.mode = 'realtime';
    rec.provider = cfg.realtimeProvider || 'openai';
    rec.targetRate = rec.provider === 'elevenlabs' ? 16000 : 24000;
    const wsURL = 'ws://127.0.0.1:' + cfg.port + '/realtime-transcribe?provider=' +
      encodeURIComponent(rec.provider) + '&sampleRate=' + rec.targetRate +
      (cfg.token ? '&token=' + encodeURIComponent(cfg.token) : '');
    const ws = new WebSocket(wsURL);
    rec.ws = ws;
    // A socket that neither opens nor errors would leave rec.busy=true forever and the
    // record button dead — give the connection a hard deadline.
    const openDeadline = setTimeout(() => {
      if (rec.ws !== ws || rec.status !== 'idle') return;
      try { ws.close(); } catch (e) {}
      failRecording('Realtime transcription did not connect');
    }, 8000);
    ws.addEventListener('open', () => {
      clearTimeout(openDeadline);
      if (rec.ws !== ws) return;   // superseded/cancelled while connecting
      setupRealtimeAudio(stream);
      beginRecordingClock();
    });
    ws.addEventListener('message', (ev) => {
      let msg = null;
      try { msg = JSON.parse(ev.data); } catch (e) { return; }
      if (msg.type === 'ready') {
        rec.provider = msg.provider || rec.provider;
        emitRecordingState();
	      } else if (msg.type === 'transcript.delta') {
	        applyTranscript(msg.text || msg.delta || '', false, msg);
	      } else if (msg.type === 'transcript.completed') {
	        applyTranscript(msg.text || msg.transcript || '', true, msg);
        if (rec.status === 'transcribing') {
          if (rec.finalizeTimer) { clearTimeout(rec.finalizeTimer); rec.finalizeTimer = null; }
          setTimeout(finishRecordingWithText, 120);
        }
      } else if (msg.type === 'error') {
        failRecording(msg.error || 'Realtime transcription failed');
      }
    });
    ws.addEventListener('error', () => {
      clearTimeout(openDeadline);
      failRecording('Realtime transcription failed');
    });
    ws.addEventListener('close', () => {
      clearTimeout(openDeadline);
      if (rec.status === 'transcribing') finishRecordingWithText();
    });
  }

	  function failRecording(message) {
	    if (rec.timer) { clearInterval(rec.timer); rec.timer = null; }
	    if (rec.finalizeTimer) { clearTimeout(rec.finalizeTimer); rec.finalizeTimer = null; }
	    rec.error = message || 'Recording failed';
	    rec.status = 'error';
	    rec.busy = false;
	    setRecordingProgress('error', null);
	    releaseRealtimeAudio();
	    stopStream();
    try { if (rec.ws && rec.ws.readyState === WebSocket.OPEN) rec.ws.close(); } catch (e) {}
    toast(rec.error);
    emitRecordingState();
  }

	  function beginRecordingClock() {
	    rec.started = Date.now();
	    rec.pausedAccumMs = 0;
	    rec.pausedAt = 0;
	    rec.status = 'recording';
	    rec.busy = false;
	    setRecordingProgress('', null);
	    if (rec.timer) clearInterval(rec.timer);
    rec.timer = setInterval(() => {
      // setRecUI (via emitRecordingState) refreshes the in-circle timer + pill timer.
      emitRecordingState({ tick: true });
    }, 500);
    emitRecordingState();
  }

  function setupRealtimeAudio(stream) {
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    rec.audioContext = new AudioCtx();
    rec.source = rec.audioContext.createMediaStreamSource(stream);
    rec.processor = rec.audioContext.createScriptProcessor(4096, 1, 1);
    rec.processor.onaudioprocess = (ev) => {
      if (rec.status !== 'recording') return;
      if (!rec.ws || rec.ws.readyState !== WebSocket.OPEN) return;
      const input = ev.inputBuffer.getChannelData(0);
      const pcm = floatTo16BitPCM(downsample(input, rec.audioContext.sampleRate, rec.targetRate));
      if (!pcm.byteLength) return;
      rec.ws.send(JSON.stringify({ type: 'audio', audio: arrayBufferToBase64(pcm.buffer), sampleRate: rec.targetRate }));
    };
    rec.source.connect(rec.processor);
    rec.processor.connect(rec.audioContext.destination);
  }

  function pauseRecording() {
    if (rec.status !== 'recording') return;
    if (rec.mediaRecorder && rec.mediaRecorder.state === 'recording') rec.mediaRecorder.pause();
    rec.status = 'paused';
    // Pause the clock too: mark when the pause began and stop the 500ms tick.
    rec.pausedAt = Date.now();
    if (rec.timer) { clearInterval(rec.timer); rec.timer = null; }
    emitRecordingState();
  }

  function resumeRecording() {
    if (rec.status !== 'paused') return;
    if (rec.mediaRecorder && rec.mediaRecorder.state === 'paused') rec.mediaRecorder.resume();
    rec.status = 'recording';
    // Fold the finished pause into the excluded total and restart the tick.
    if (rec.pausedAt) { rec.pausedAccumMs += Date.now() - rec.pausedAt; rec.pausedAt = 0; }
    if (!rec.timer) rec.timer = setInterval(() => { emitRecordingState({ tick: true }); }, 500);
    emitRecordingState();
  }

	  function stopRecording() {
	    if (rec.status !== 'recording' && rec.status !== 'paused') return;
	    if (rec.timer) { clearInterval(rec.timer); rec.timer = null; }
	    // Stopping from paused: close out the open pause so elapsed stays frozen correctly.
	    if (rec.pausedAt) { rec.pausedAccumMs += Date.now() - rec.pausedAt; rec.pausedAt = 0; }
	    rec.busy = true;
	    rec.status = 'stopping';
	    setRecordingProgress('stopping', 0.2);
	    emitRecordingState();
	    if (rec.mode === 'realtime') {
	      try { if (rec.ws && rec.ws.readyState === WebSocket.OPEN) rec.ws.send(JSON.stringify({ type: 'commit' })); } catch (e) {}
	      releaseRealtimeAudio();
	      stopStream();
	      rec.status = 'transcribing';
	      setRecordingProgress('awaiting-final-transcript', null);
	      emitRecordingState();
	      if (rec.finalizeTimer) clearTimeout(rec.finalizeTimer);
	      rec.finalizeTimer = setTimeout(() => {
	        rec.finalizeTimer = null;
        try { if (rec.ws && rec.ws.readyState === WebSocket.OPEN) rec.ws.close(); } catch (e) {}
        finishRecordingWithText();
	      }, 5000);
	      return;
	    }
	    if (rec.mediaRecorder && rec.mediaRecorder.state !== 'inactive') rec.mediaRecorder.stop();
	    else failRecording('Recording stopped before audio was available');
	  }

  function onBoundedRecordingStopped() {
    // Release the mic.
    releaseRealtimeAudio();
    stopStream();
    const mime = (rec.mediaRecorder && rec.mediaRecorder.mimeType) || 'audio/webm';
	    const blob = new Blob(rec.chunks, { type: mime });
	    rec.chunks = [];
	    rec.mediaRecorder = null;
	    if (!blob.size) { resetRecording(); return; }
	    rec.busy = true;
	    rec.status = 'transcribing';
	    setRecordingProgress('uploading-audio', 0.35);
	    emitRecordingState();
	    blobToBase64(blob).then(b64 => {
	      setRecordingProgress('transcribing-audio', 0.6);
	      return fetch(aiURL('/transcribe'), {
	        method: 'POST',
        headers: aiHeaders(),
        body: JSON.stringify({ audioBase64: b64, mime: mime }),
      });
	    }).then(r => {
	      if (!r || !r.ok) throw new Error('Transcription failed');
	      return r.json();
	    }).then(data => {
	      const text = data && data.text ? String(data.text).trim() : '';
	      rec.finalTranscript = text;
	      setRecordingProgress('finalizing-transcript', 0.9);
	      finishRecordingWithText();
	    }).catch(() => { failRecording('Transcription failed'); });
	  }

  function finishRecordingWithText() {
    if (rec.finalizeTimer) { clearTimeout(rec.finalizeTimer); rec.finalizeTimer = null; }
    const text = (rec.finalTranscript || rec.partialTranscript || '').trim();
    releaseRealtimeAudio();
    stopStream();
    try { if (rec.ws && rec.ws.readyState === WebSocket.OPEN) rec.ws.close(); } catch (e) {}
	    if (text) {
	      // Voice notes land through the same single quick-capture path as typed ones.
	      captureQuickNote(transcriptToNoteBody(text), { toast: 'Voice note added' });
	    } else if (rec.status !== 'error') {
	      toast('Could not transcribe audio');
	    }
	    rec.status = 'complete';
	    rec.busy = false;
	    setRecordingProgress('complete', 1);
	    emitRecordingState();
	    setTimeout(() => { if (rec.status === 'complete') resetRecording(); }, 800);
	  }

	  function resetRecording() {
	    rec.status = 'idle';
	    rec.busy = false;
	    rec.started = 0;
	    rec.pausedAccumMs = 0;
	    rec.pausedAt = 0;
	    rec.mediaRecorder = null;
    rec.ws = null;
    rec.chunks = [];
	    rec.partialTranscript = '';
	    rec.finalTranscript = '';
	    rec.progressPhase = '';
	    rec.progressPercent = null;
	    rec.error = '';
    if (rec.timer) { clearInterval(rec.timer); rec.timer = null; }
    if (rec.finalizeTimer) { clearTimeout(rec.finalizeTimer); rec.finalizeTimer = null; }
    emitRecordingState();
  }

  function stopStream() {
    if (rec.stream) { rec.stream.getTracks().forEach(t => t.stop()); rec.stream = null; }
  }

  function releaseRealtimeAudio() {
    try { if (rec.processor) rec.processor.disconnect(); } catch (e) {}
    try { if (rec.source) rec.source.disconnect(); } catch (e) {}
    try { if (rec.audioContext) rec.audioContext.close(); } catch (e) {}
    rec.processor = null;
    rec.source = null;
    rec.audioContext = null;
  }

  function downsample(input, inRate, outRate) {
    if (!input.length || inRate === outRate) return input;
    const ratio = inRate / outRate;
    const outLen = Math.floor(input.length / ratio);
    const out = new Float32Array(outLen);
    for (let i = 0; i < outLen; i++) {
      const start = Math.floor(i * ratio);
      const end = Math.min(Math.floor((i + 1) * ratio), input.length);
      let sum = 0;
      for (let j = start; j < end; j++) sum += input[j];
      out[i] = sum / Math.max(1, end - start);
    }
    return out;
  }

  function floatTo16BitPCM(samples) {
    const out = new Int16Array(samples.length);
    for (let i = 0; i < samples.length; i++) {
      const s = Math.max(-1, Math.min(1, samples[i]));
      out[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
    }
    return out;
  }

  function arrayBufferToBase64(buffer) {
    const bytes = new Uint8Array(buffer);
    let s = '';
    for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
    return btoa(s);
  }

  function blobToBase64(blob) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => {
        const res = String(reader.result || '');
        const comma = res.indexOf(',');
        resolve(comma >= 0 ? res.slice(comma + 1) : res);
      };
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
  }

  function initRecButton() {
    const btn = $('rec-btn');
    const wrap = $('qn-form');
    const cRec = $('compact-rec');
    const cForm = $('compact-form');
    if (!btn && !cRec) return;
    const cfg = ai();
    if (!cfg.available && !cfg.realtime) {
      if (wrap) wrap.classList.add('rec-disabled');
      if (btn) { btn.setAttribute('title', 'Add an OpenAI or ElevenLabs key to enable voice notes'); btn.setAttribute('aria-disabled', 'true'); }
      if (cForm) cForm.classList.add('rec-disabled');
      if (cRec) { cRec.setAttribute('title', 'Add an OpenAI or ElevenLabs key to enable voice notes'); cRec.setAttribute('aria-disabled', 'true'); }
    } else {
      if (wrap) wrap.classList.remove('rec-disabled');
      if (btn) { btn.setAttribute('title', 'Record a voice note'); btn.removeAttribute('aria-disabled'); }
      if (cForm) cForm.classList.remove('rec-disabled');
      if (cRec) { cRec.setAttribute('title', 'Record a voice note'); cRec.removeAttribute('aria-disabled'); }
    }
    setRecUI(rec.status);
  }

  // ------------------------------------------------------------------ markdown UI
  // The ONLY formatting surfaces (vision 8f9b4bb9): a minimal selection popover
  // (bold / italic / code / link) over selected editor text, and a "/" slash menu
  // rendered from markdown.slashCommands(). Both route through editorCommand(...)
  // (= window.HasnaNotes.editor.command). Explicitly NO toolbar.

  // Approximate the viewport point of a caret index inside the editor textarea by
  // mirroring its text into a hidden div (textareas expose no selection rects).
  // Returns null when layout APIs are unavailable (headless harness) — callers then
  // simply skip positioning.
  function editorCaretPoint(ta, index) {
    try {
      if (!ta.getBoundingClientRect || !window.getComputedStyle) return null;
      const rect = ta.getBoundingClientRect();
      const cs = window.getComputedStyle(ta);
      const mirror = document.createElement('div');
      ['fontFamily', 'fontSize', 'fontWeight', 'lineHeight', 'letterSpacing',
        'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft', 'boxSizing',
        'tabSize'].forEach(prop => { mirror.style[prop] = cs[prop]; });
      mirror.style.position = 'fixed';
      mirror.style.visibility = 'hidden';
      mirror.style.whiteSpace = 'pre-wrap';
      mirror.style.overflowWrap = 'break-word';
      mirror.style.width = rect.width + 'px';
      mirror.textContent = String(ta.value || '').slice(0, index);
      const marker = document.createElement('span');
      marker.textContent = '\u200b';
      mirror.appendChild(marker);
      document.body.appendChild(mirror);
      const mirrorRect = mirror.getBoundingClientRect();
      const markerRect = marker.getBoundingClientRect();
      document.body.removeChild(mirror);
      return {
        x: rect.left + (markerRect.left - mirrorRect.left),
        y: rect.top + (markerRect.top - mirrorRect.top) - (ta.scrollTop || 0),
        lineHeight: markerRect.height || 18,
      };
    } catch (e) { return null; }
  }

  // Position a fixed floating element at (x, y), clamped to the viewport.
  function placeFloating(elm, x, y) {
    const pad = 8;
    const w = elm.offsetWidth || 180;
    const h = elm.offsetHeight || 40;
    let left = x, top = y;
    if (window.innerWidth && left + w > window.innerWidth - pad) left = window.innerWidth - w - pad;
    if (window.innerHeight && top + h > window.innerHeight - pad) top = window.innerHeight - h - pad;
    elm.style.left = Math.max(pad, left) + 'px';
    elm.style.top = Math.max(pad, top) + 'px';
  }

  // ---------- selection popover (bold / italic / code / link) ----------
  function updateMdPop() {
    const pop = $('md-pop');
    const ta = $('editor-body');
    if (!pop || !ta) return;
    const note = noteById(state.selectedId);
    const hasSelection = !!note && state.screen === 'notes' &&
      Number(ta.selectionEnd) > Number(ta.selectionStart);
    if (!hasSelection) { pop.hidden = true; return; }
    pop.hidden = false;
    const point = editorCaretPoint(ta, Number(ta.selectionStart));
    if (point) placeFloating(pop, point.x, point.y - (pop.offsetHeight || 34) - 6);
  }
  function closeMdPop() {
    const pop = $('md-pop');
    if (pop) pop.hidden = true;
  }
  function onEditorSelect() {
    updateMdPop();
  }
  function onMdPopButton(e) {
    if (e) e.preventDefault();
    const id = e.currentTarget.getAttribute('data-md');
    if (!id) return;
    editorCommand(id);
    closeMdPop();
    const ta = $('editor-body'); if (ta) ta.focus();
  }
  // pointerdown (not click) would blur the textarea and collapse the selection before
  // the command could read it — swallow it so the selection survives to the click.
  function onMdPopPointerDown(e) { e.preventDefault(); }

  // ---------- "/" slash menu ----------
  let slashMenu = { open: false, start: -1, query: '', index: 0, items: [] };

  // A slash trigger is a line that reads exactly "/query" up to the caret.
  function slashContext(ta) {
    const caret = Number(ta.selectionStart) || 0;
    if ((Number(ta.selectionEnd) || 0) !== caret) return null;
    const value = String(ta.value || '');
    const lineStart = value.lastIndexOf('\n', caret - 1) + 1;
    const m = /^\/([a-z0-9-]*)$/i.exec(value.slice(lineStart, caret));
    if (!m) return null;
    return { start: lineStart, query: m[1].toLowerCase(), caret };
  }

  function slashMatches(query) {
    if (!query) return MARKDOWN_COMMANDS.slice();
    return MARKDOWN_COMMANDS.filter(cmd =>
      cmd.id.toLowerCase().indexOf(query) >= 0 || cmd.label.toLowerCase().indexOf(query) >= 0);
  }

  function updateSlashMenu() {
    const menu = $('slash-menu');
    const ta = $('editor-body');
    if (!menu || !ta) return;
    const note = noteById(state.selectedId);
    const ctx = (note && state.screen === 'notes') ? slashContext(ta) : null;
    const items = ctx ? slashMatches(ctx.query) : [];
    if (!ctx || !items.length) { closeSlashMenu(); return; }
    const index = (slashMenu.open && slashMenu.query === ctx.query)
      ? Math.min(slashMenu.index, items.length - 1) : 0;
    slashMenu = { open: true, start: ctx.start, query: ctx.query, index, items };
    renderSlashMenu(menu, ta);
  }

  function renderSlashMenu(menu, ta) {
    menu.innerHTML = '';
    slashMenu.items.forEach((cmd, i) => {
      const item = el('button', 'slash-item' + (i === slashMenu.index ? ' active' : ''));
      item.type = 'button';
      item.dataset.command = cmd.id;
      item.appendChild(el('span', 'slash-label', cmd.label));
      // One-line markdown hint (the code-block metadata holds real newlines now).
      item.appendChild(el('span', 'slash-hint', String(cmd.markdown || '').split('\n')[0]));
      // pointerdown, not click: apply before the textarea blur can dismiss the menu.
      item.addEventListener('pointerdown', (ev) => { ev.preventDefault(); applySlashCommand(cmd.id); });
      menu.appendChild(item);
    });
    menu.hidden = false;
    const point = editorCaretPoint(ta, slashMenu.start);
    if (point) placeFloating(menu, point.x, point.y + (point.lineHeight || 18) + 4);
  }

  function closeSlashMenu() {
    slashMenu = { open: false, start: -1, query: '', index: 0, items: [] };
    const menu = $('slash-menu');
    if (menu) menu.hidden = true;
  }

  function applySlashCommand(commandId) {
    const ta = $('editor-body');
    const note = noteById(state.selectedId);
    if (!ta || !note || !slashMenu.open) return;
    const start = slashMenu.start;
    const caret = Number(ta.selectionStart) || 0;
    closeSlashMenu();
    if (caret < start) return;
    // Remove the "/query" trigger text, then apply the command at that spot.
    ta.value = String(ta.value || '').slice(0, start) + String(ta.value || '').slice(caret);
    if (typeof ta.setSelectionRange === 'function') ta.setSelectionRange(start, start);
    else { ta.selectionStart = start; ta.selectionEnd = start; }
    editorCommand(commandId);
    ta.focus();
  }

  function onEditorBodyKeydown(e) {
    if (!slashMenu.open) return;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      const len = slashMenu.items.length;
      slashMenu.index = (slashMenu.index + (e.key === 'ArrowDown' ? 1 : -1) + len) % len;
      const menu = $('slash-menu'); const ta = $('editor-body');
      if (menu && ta) renderSlashMenu(menu, ta);
      return;
    }
    if (e.key === 'Enter' || e.key === 'Tab') {
      e.preventDefault();
      const cmd = slashMenu.items[slashMenu.index];
      if (cmd) applySlashCommand(cmd.id);
      return;
    }
    if (e.key === 'Escape') { e.preventDefault(); closeSlashMenu(); }
  }

  // ------------------------------------------------------------------ event wiring
  let started = false;

  // Named handlers so they can be removed on destroy() (leak-safe under host reloads).
  function onTitleInput() {
    const n = noteById(state.selectedId);
    if (!n) return;
    markEditBase(n); // in-flight edit: protect these keystrokes from hydrate
    // If the user typed a non-default title, mark it manual so we never auto-title it.
    const v = $('editor-title').value;
    if (!isDefaultTitle(v)) {
      titleManuallyEdited[n.id] = true;
    } else {
      // Cleared back to a default title → eligible for auto-title again.
      delete titleManuallyEdited[n.id];
      delete autoTitled[n.id];
    }
    scheduleSave();
  }
  function onBodyInput() {
    const n = noteById(state.selectedId);
    if (!n) return;
    markEditBase(n); // in-flight edit: protect these keystrokes from hydrate
    scheduleSave();
    maybeAutoTitle();
    updateSlashMenu(); // "/" at the start of a line opens the slash menu
    updateMdPop();     // typing collapses the selection — hide the popover
  }
  function onEditorBlur() { commitEdit(); }
  function onNewNote(e) { if (e) e.preventDefault(); newNote(); }
  function onDelete(e) { if (e) e.preventDefault(); deleteCurrent(); }
  // Copy the entire note as Markdown (content-header, editor only): the title as an H1
  // when the note has a real one, then the Markdown body. Checkmark-icon feedback only.
  function onCopyNote(e) {
    if (e) e.preventDefault();
    const note = noteById(state.selectedId);
    if (!note) return;
    const title = (note.title || '').trim();
    const body = note.body || note.content || '';
    copyToClipboard(title && !isDefaultTitle(title) ? '# ' + title + '\n\n' + body : body);
    copyFeedback($('note-copy'));
  }
  function onOpenHome(e) { if (e) e.preventDefault(); showHome(); }
  function onOpenChat(e) { if (e) e.preventDefault(); showChatPage(); }
  function onOpenTrash(e) { if (e) e.preventDefault(); showTrash(); }
  function onOpenArchive(e) { if (e) e.preventDefault(); showArchive(); }
  // Settings → Appearance → Trash: the 7/30/90-day retention picker.
  function onRetentionOpt(e) {
    if (e) e.preventDefault();
    setTrashRetentionDays(Number(e.currentTarget.getAttribute('data-days')));
  }
  function onMinimize(e) { if (e) e.preventDefault(); setCompact(true); }
  function onCompactExpand(e) { if (e) e.preventDefault(); setCompact(false); }
  // The one subtle "view all notes" path under Home's recent list.
  function onViewAllNotes(e) {
    if (e) e.preventDefault();
    state.statusFilter = 'active';
    showNotesPage();
  }
  // Collapsible sidebar sections (Notes / Labels).
  function onToggleNotesSection(e) {
    if (e) e.preventDefault();
    collapsedSections.notes = !collapsedSections.notes;
    const sec = $('sec-notes');
    if (sec) sec.classList.toggle('collapsed', collapsedSections.notes);
    const wrap = $('notes-wrap');
    if (wrap) wrap.hidden = collapsedSections.notes;
  }
  function onToggleLabelsSection(e) {
    if (e) e.preventDefault();
    collapsedSections.labels = !collapsedSections.labels;
    renderLabels();
  }
  function onChatSubmit(e) {
    if (e) e.preventDefault();
    const input = $('chat-input');
    if (!input) return;
    const text = input.value.trim();
    if (!text) return;
    input.value = '';
    input.style.height = 'auto';
    sendChat(text).catch(err => toast(err.message || String(err)));
  }
  function onChatInput(e) {
    const input = e && e.target ? e.target : $('chat-input');
    if (!input) return;
    input.style.height = 'auto';
    input.style.height = Math.min(input.scrollHeight || 34, 116) + 'px';
  }
  function onChatInputKeydown(e) {
    // An Enter that only commits an input-method candidate (Japanese/Chinese/Korean)
    // must never send: the browser reports it with `isComposing` — `keyCode` 229 on
    // older WebKit — and native form submission is suppressed the same way.
    if (!e || e.key !== 'Enter' || e.shiftKey || e.isComposing || e.keyCode === 229) return;
    e.preventDefault();
    onChatSubmit();
  }
  function setChatMoreMenu(open) {
    chatMoreOpen = !!open;
    const menu = $('chat-more-menu');
    if (menu) menu.hidden = !chatMoreOpen;
    const button = $('chat-more');
    if (button) button.setAttribute('aria-expanded', chatMoreOpen ? 'true' : 'false');
  }
  function onChatMoreToggle(e) {
    if (e) e.preventDefault();
    setChatMoreMenu(!chatMoreOpen);
  }
  function onChatClear(e) {
    if (e) e.preventDefault();
    setChatMoreMenu(false);
    clearChat();
  }
  function onChatViewToggle(e) {
    if (e) e.preventDefault();
    chatWideView = !chatWideView;
    renderChatChrome();
  }
  function onChatPanelToggle(e) {
    if (e) e.preventDefault();
    chatPanelOpen = !chatPanelOpen;
    renderChatChrome();
  }
  function onChatPanelClose(e) {
    if (e) e.preventDefault();
    chatPanelOpen = false;
    renderChatChrome();
  }
  function onLabelCreate(e) {
    if (e) e.preventDefault();
    const input = $('label-create-input');
    if (!input) return;
    const label = input.value.trim();
    if (!label) return;
    createLabelLocal(label);
    input.value = '';
  }
  // The ONE quick-capture path: Home composer, compact window, and voice notes all
  // create through here. Text is stored as the note BODY (never the title), so previews
  // show real content and AI auto-title can name the note (3-4 words, cheap model).
  function captureQuickNote(text, opts) {
    const body = String(text || '').trim();
    if (!body) return null;
    const note = quickCreate('', body);
    toast((opts && opts.toast) || 'Note added');
    return note;
  }
  // Shared submit for the Home composer + compact window forms.
  function submitQuickCapture(inputId) {
    const inp = $(inputId);
    if (!inp || !captureQuickNote(inp.value)) return;
    inp.value = '';
    inp.focus();
    if (inputId === 'qn-input') {
      growComposerInput();
      updateComposerControls();
    }
  }
  function onQuickNote(e) { if (e) e.preventDefault(); submitQuickCapture('qn-input'); }
  function onCompactNote(e) { if (e) e.preventDefault(); submitQuickCapture('compact-input'); }
  // The composer input is a textarea (grows as you type); Enter submits, Shift+Enter
  // makes a new line.
  function onQnKeydown(e) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      submitQuickCapture('qn-input');
    }
  }
  function growComposerInput() {
    const inp = $('qn-input');
    if (!inp || typeof inp.scrollHeight !== 'number' || !inp.style) return;
    inp.style.height = 'auto';
    inp.style.height = Math.min(inp.scrollHeight, 120) + 'px';
  }
  // Toggle the pill's primary control: typed text → Add (submit); empty → Record.
  function onQnInput() {
    growComposerInput();
    updateComposerControls();
  }
  function updateComposerControls() {
    const inp = $('qn-input'); const add = $('qn-add'); const recBtn = $('rec-btn');
    const hasText = !!inp?.value?.trim();
    const recActive = (rec.status === 'recording' || rec.status === 'paused' ||
      rec.status === 'stopping' || rec.status === 'transcribing');
    // While recording, the Record control stays put (it doubles as Stop); otherwise the
    // control reflects whether the user is typing (Add) or not (Record).
    if (add) add.hidden = recActive || !hasText;
    if (recBtn) recBtn.hidden = !recActive && hasText;
    // Compact quick-note shell: while a recording is active the minimized window shows
    // ONE recording surface — the composer input + Add hide behind the mic control
    // (timer + pause + stop live in the bottom-center rec-pill).
    const cInput = $('compact-input'); const cAdd = $('compact-add');
    if (cInput) cInput.hidden = recActive;
    if (cAdd) cAdd.hidden = recActive;
  }
  // ---------- Search popover (Cmd+K) ----------
  function searchPopOpen() {
    const pop = $('search-pop');
    return !!(pop && !pop.hidden);
  }
  function openSearchPop() {
    const pop = $('search-pop');
    if (!pop) return;
    pop.hidden = false;
    const input = $('search-pop-input');
    if (input) { input.value = ''; input.focus(); }
    renderSearchResults('');
  }
  function closeSearchPop() {
    const pop = $('search-pop');
    if (pop) pop.hidden = true;
  }
  function searchMatches(query) {
    const q = String(query || '').trim().toLowerCase();
    return sortNotes(state.notes.filter(n => n.status !== 'trash' && n.status !== 'archived'))
      .filter(n => {
        if (!q) return true;
        const hay = ((n.title || '') + ' ' + (n.body || n.content || '') + ' ' + noteLabels(n).join(' ')).toLowerCase();
        return hay.includes(q);
      })
      .slice(0, 12);
  }
  function renderSearchResults(query) {
    const host = $('search-pop-results');
    if (!host) return;
    host.innerHTML = '';
    const list = searchMatches(query);
    if (!list.length) {
      host.appendChild(el('div', 'sp-empty', String(query || '').trim() ? 'No matching notes' : 'No notes'));
      return;
    }
    list.forEach(n => {
      const row = el('div', 'sp-row');
      row.dataset.id = n.id;
      keyboardRow(row, 'Open note: ' + ((n.title && n.title.trim()) || 'Untitled Note'));
      row.appendChild(el('div', 'sp-title', (n.title && n.title.trim()) || 'Untitled Note'));
      const body = (n.body || n.content || '').replace(/\s+/g, ' ').trim();
      row.appendChild(el('div', 'sp-sub', body.slice(0, 90) || 'No content'));
      row.addEventListener('click', () => {
        closeSearchPop();
        selectNote(n.id);
      });
      host.appendChild(row);
    });
  }
  function onSearchPopInput(e) {
    renderSearchResults(e && e.target ? e.target.value : '');
  }
  function onSearchPopKeydown(e) {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    const first = searchMatches(e.target ? e.target.value : '')[0];
    if (!first) return;
    closeSearchPop();
    selectNote(first.id);
  }

  function onGlobalKeydown(e) {
    // Cmd+K (Ctrl+K outside macOS) toggles the search popover from anywhere.
    if ((e.metaKey || e.ctrlKey) && String(e.key).toLowerCase() === 'k') {
      e.preventDefault();
      if (searchPopOpen()) closeSearchPop();
      else openSearchPop();
      return;
    }
    if (e.key === 'Escape') {
      closeContextMenu();
      closeSearchPop();
      closeMdPop();
      setChatMoreMenu(false);
    }
  }
  function onGlobalPointerDown(e) {
    const menu = $('ctx-menu');
    if (menu && !menu.hidden && !menu.contains(e.target)) closeContextMenu();
    const pop = $('search-pop');
    if (pop && !pop.hidden && e.target === pop) closeSearchPop();
    const mdPop = $('md-pop');
    if (mdPop && !mdPop.hidden && !mdPop.contains(e.target)) closeMdPop();
    const slash = $('slash-menu');
    if (slash && !slash.hidden && !slash.contains(e.target)) closeSlashMenu();
    const chatMenu = $('chat-more-menu');
    const chatMore = $('chat-more');
    if (chatMoreOpen && chatMenu && e.target !== chatMore && !chatMenu.contains(e.target)) setChatMoreMenu(false);
  }
  // ---- scroll chrome (design spec §3.6/§3.7 — purely presentational) ----
  // Overlay scrollbars: the thin thumb is invisible at rest and appears while the
  // scroller is hovered OR actively scrolling — tag the scrolled element with
  // .scrolling and clear it shortly after the last scroll event (Rule 15).
  const scrollingTimers = new Map();
  function markScrolling(node) {
    if (!node || node.nodeType !== 1) return;
    node.classList.add('scrolling');
    clearTimeout(scrollingTimers.get(node));
    scrollingTimers.set(node, setTimeout(() => {
      node.classList.remove('scrolling');
      scrollingTimers.delete(node);
    }, 700));
  }
  // Scroll-edge fade under the content header (Rule 6): .scrolled on #content shows the
  // soft gradient once page content actually sits beneath the header — never a border.
  // Only the page-level scrollers drive it; inner scrollers (chat log, transcript) don't.
  const PAGE_SCROLLERS = '.home,.np-inner,.chat-scroll,.editor-scroll';
  function syncHeaderScrollEdge(fromNode) {
    const content = $('content');
    if (!content) return;
    let el = (fromNode && fromNode.nodeType === 1 && content.contains(fromNode)) ? fromNode : null;
    if (!el) {
      for (const s of content.querySelectorAll(PAGE_SCROLLERS)) {
        if (s.offsetParent !== null) { el = s; break; }   // the visible page scroller
      }
    }
    content.classList.toggle('scrolled', !!el && (el.scrollTop || 0) > 0);
  }
  function onWindowScroll(e) {
    closeContextMenu(); closeMdPop(); closeSlashMenu();
    const node = (e && e.target && e.target.nodeType === 1) ? e.target : null;
    markScrolling(node);
    if (node && node.matches(PAGE_SCROLLERS)) syncHeaderScrollEdge(node);
    // Sidebar nav scroll-edge fade (Rule 6): rows scrolling under the machines-dropdown
    // chrome fade out via .nav-scrolled on the sidebar (styles.css .sidebar-top::after).
    if (node && node.matches('.sidebar-nav')) {
      const sb = node.closest('.sidebar');
      if (sb) sb.classList.toggle('nav-scrolled', (node.scrollTop || 0) > 0);
    }
  }
  function onOpenSettings(e) { if (e) e.preventDefault(); showSettings('appearance'); }
  function onSettingsBack(e) {
    if (e) e.preventDefault();
    // Restore the screen the user was on before Settings — screen state stays
    // authoritative, so the next render() shows the right surface again.
    state.screen = state.settingsReturnScreen || 'home';
    showApp();
    render();
  }
  function onSettingsTab(e) {
    const item = e.currentTarget;
    const tab = item.getAttribute('data-tab');
    e.preventDefault();
    showSettings(tab);
  }
  // Settings deep-link contract (header comment): only Settings uses a hash
  // (#settings[/tab]) so a screenshot harness can deep-link to it. The listener was
  // documented but never implemented — clicking a tab leaves the hash stale and a
  // load with #settings opened nothing (owner brief 2026-08-19 req 9).
  function settingsHashTab() {
    // Guarded: window.location may be absent in the headless test harness.
    const hash = (window.location && window.location.hash) || '';
    const m = /^#\/?settings(?:\/(appearance|labels|about))?/.exec(String(hash));
    return m ? (m[1] || 'appearance') : null;
  }
  function onHashChange() {
    const tab = settingsHashTab();
    if (tab) showSettings(tab);
  }
  function onThemeCard(e) {
    const card = e.currentTarget;
    setTheme(card.getAttribute('data-theme'));
  }
  // Keyboard path for the DIV theme cards (Rule 14): Enter/Space selects like a click.
  function onThemeCardKey(e) {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    e.preventDefault();
    onThemeCard(e);
  }
  // Pause/resume toggles (home record control + the persistent pill share the logic).
  function onRecPauseToggle(e) {
    if (e) e.preventDefault();
    if (rec.status === 'recording') pauseRecording();
    else if (rec.status === 'paused') resumeRecording();
  }
  function onRecPillStop(e) { if (e) e.preventDefault(); stopRecording(); }

  function bind() {
    const titleEl = $('editor-title'), bodyEl = $('editor-body');
    if (titleEl) { titleEl.addEventListener('input', onTitleInput); titleEl.addEventListener('blur', onEditorBlur); }
    if (bodyEl) {
      bodyEl.addEventListener('input', onBodyInput);
      bodyEl.addEventListener('blur', onEditorBlur);
      // Markdown UI: the selection popover follows the selection; the slash menu
      // captures arrows/Enter/Escape while open.
      bodyEl.addEventListener('mouseup', onEditorSelect);
      bodyEl.addEventListener('keyup', onEditorSelect);
      bodyEl.addEventListener('select', onEditorSelect);
      bodyEl.addEventListener('keydown', onEditorBodyKeydown);
    }
    document.querySelectorAll('.md-btn[data-md]').forEach(b => {
      b.addEventListener('click', onMdPopButton);
      b.addEventListener('pointerdown', onMdPopPointerDown);
    });

    const nn = $('new-note'); if (nn) nn.addEventListener('click', onNewNote);
    const en = $('empty-new'); if (en) en.addEventListener('click', onNewNote);
    const del = $('note-delete'); if (del) del.addEventListener('click', onDelete);
    const copyNote = $('note-copy'); if (copyNote) copyNote.addEventListener('click', onCopyNote);

    // Home + archive + trash + compact + header controls (chat lives next to minimize).
    const home = $('nav-home'); if (home) home.addEventListener('click', onOpenHome);
    const archiveNav = $('nav-archive'); if (archiveNav) archiveNav.addEventListener('click', onOpenArchive);
    const trashNav = $('nav-trash'); if (trashNav) trashNav.addEventListener('click', onOpenTrash);
    const chatBtn = $('open-chat'); if (chatBtn) chatBtn.addEventListener('click', onOpenChat);
    const winMin = $('win-min'); if (winMin) winMin.addEventListener('click', onMinimize);
    const cExpand = $('compact-expand'); if (cExpand) cExpand.addEventListener('click', onCompactExpand);
    const qnForm = $('qn-form'); if (qnForm) qnForm.addEventListener('submit', onQuickNote);
    const qnInput = $('qn-input');
    if (qnInput) {
      qnInput.addEventListener('input', onQnInput);
      qnInput.addEventListener('keydown', onQnKeydown);
    }
    const cForm = $('compact-form'); if (cForm) cForm.addEventListener('submit', onCompactNote);
    const cRec = $('compact-rec'); if (cRec) cRec.addEventListener('click', onRecordClick);
    const chatForm = $('chat-form'); if (chatForm) chatForm.addEventListener('submit', onChatSubmit);
    const chatInput = $('chat-input');
    if (chatInput) {
      chatInput.addEventListener('input', onChatInput);
      chatInput.addEventListener('keydown', onChatInputKeydown);
    }
    const chatMore = $('chat-more'); if (chatMore) chatMore.addEventListener('click', onChatMoreToggle);
    const chatClear = $('chat-clear'); if (chatClear) chatClear.addEventListener('click', onChatClear);
    const chatView = $('chat-view-toggle'); if (chatView) chatView.addEventListener('click', onChatViewToggle);
    const chatPanel = $('chat-panel-toggle'); if (chatPanel) chatPanel.addEventListener('click', onChatPanelToggle);
    const chatPanelClose = $('chat-panel-close'); if (chatPanelClose) chatPanelClose.addEventListener('click', onChatPanelClose);
    const labelForm = $('label-create-form'); if (labelForm) labelForm.addEventListener('submit', onLabelCreate);
    const recBtn = $('rec-btn'); if (recBtn) recBtn.addEventListener('click', onRecordClick);
    const qnPause = $('qn-pause'); if (qnPause) qnPause.addEventListener('click', onRecPauseToggle);
    const pillPause = $('rec-pill-pause'); if (pillPause) pillPause.addEventListener('click', onRecPauseToggle);
    const pillStop = $('rec-pill-stop'); if (pillStop) pillStop.addEventListener('click', onRecPillStop);
    const viewAll = $('home-view-all'); if (viewAll) viewAll.addEventListener('click', onViewAllNotes);
    const secNotes = $('sec-notes'); if (secNotes) secNotes.addEventListener('click', onToggleNotesSection);
    const secLabels = $('labels-section'); if (secLabels) secLabels.addEventListener('click', onToggleLabelsSection);
    const spInput = $('search-pop-input');
    if (spInput) {
      spInput.addEventListener('input', onSearchPopInput);
      spInput.addEventListener('keydown', onSearchPopKeydown);
    }

    // Context menu items + global close handlers.
    document.querySelectorAll('.ctx-item[data-act]').forEach(it => it.addEventListener('click', onCtxAction));
    document.addEventListener('keydown', onGlobalKeydown);
    document.addEventListener('pointerdown', onGlobalPointerDown, true);
    window.addEventListener('scroll', onWindowScroll, true);
    // Keep the native drag-strip pass-through holes aligned with the header controls as
    // the window resizes, and report once now that the header is laid out.
    window.addEventListener('resize', scheduleDragExclusions);
    scheduleDragExclusions();

    const openSet = $('open-settings'); if (openSet) openSet.addEventListener('click', onOpenSettings);
    const back = $('settings-back'); if (back) back.addEventListener('click', onSettingsBack);
    // Settings deep-link hash (#settings[/tab]) — the documented contract (req 9).
    window.addEventListener('hashchange', onHashChange);
    document.querySelectorAll('.set-item[data-tab]').forEach(s => s.addEventListener('click', onSettingsTab));
    document.querySelectorAll('.theme-card[data-theme]').forEach(c => {
      c.addEventListener('click', onThemeCard);
      c.tabIndex = 0;                       // DIV cards: keyboard-reachable (Rule 14)
      c.setAttribute('role', 'button');
      c.addEventListener('keydown', onThemeCardKey);
    });
    document.querySelectorAll('.retention-opt[data-days]').forEach(b => b.addEventListener('click', onRetentionOpt));

    initRecButton();
  }

  function unbind() {
    const titleEl = $('editor-title'), bodyEl = $('editor-body');
    if (titleEl) { titleEl.removeEventListener('input', onTitleInput); titleEl.removeEventListener('blur', onEditorBlur); }
    if (bodyEl) {
      bodyEl.removeEventListener('input', onBodyInput);
      bodyEl.removeEventListener('blur', onEditorBlur);
      bodyEl.removeEventListener('mouseup', onEditorSelect);
      bodyEl.removeEventListener('keyup', onEditorSelect);
      bodyEl.removeEventListener('select', onEditorSelect);
      bodyEl.removeEventListener('keydown', onEditorBodyKeydown);
    }
    document.querySelectorAll('.md-btn[data-md]').forEach(b => {
      b.removeEventListener('click', onMdPopButton);
      b.removeEventListener('pointerdown', onMdPopPointerDown);
    });
    const nn = $('new-note'); if (nn) nn.removeEventListener('click', onNewNote);
    const en = $('empty-new'); if (en) en.removeEventListener('click', onNewNote);
    const del = $('note-delete'); if (del) del.removeEventListener('click', onDelete);
    const copyNote = $('note-copy'); if (copyNote) copyNote.removeEventListener('click', onCopyNote);
    const home = $('nav-home'); if (home) home.removeEventListener('click', onOpenHome);
    const archiveNav = $('nav-archive'); if (archiveNav) archiveNav.removeEventListener('click', onOpenArchive);
    const trashNav = $('nav-trash'); if (trashNav) trashNav.removeEventListener('click', onOpenTrash);
    const chatBtn = $('open-chat'); if (chatBtn) chatBtn.removeEventListener('click', onOpenChat);
    const winMin = $('win-min'); if (winMin) winMin.removeEventListener('click', onMinimize);
    const cExpand = $('compact-expand'); if (cExpand) cExpand.removeEventListener('click', onCompactExpand);
    const qnForm = $('qn-form'); if (qnForm) qnForm.removeEventListener('submit', onQuickNote);
    const qnInput = $('qn-input');
    if (qnInput) {
      qnInput.removeEventListener('input', onQnInput);
      qnInput.removeEventListener('keydown', onQnKeydown);
    }
    const cForm = $('compact-form'); if (cForm) cForm.removeEventListener('submit', onCompactNote);
    const cRec = $('compact-rec'); if (cRec) cRec.removeEventListener('click', onRecordClick);
    const chatForm = $('chat-form'); if (chatForm) chatForm.removeEventListener('submit', onChatSubmit);
    const chatInput = $('chat-input');
    if (chatInput) {
      chatInput.removeEventListener('input', onChatInput);
      chatInput.removeEventListener('keydown', onChatInputKeydown);
    }
    const chatMore = $('chat-more'); if (chatMore) chatMore.removeEventListener('click', onChatMoreToggle);
    const chatClear = $('chat-clear'); if (chatClear) chatClear.removeEventListener('click', onChatClear);
    const chatView = $('chat-view-toggle'); if (chatView) chatView.removeEventListener('click', onChatViewToggle);
    const chatPanel = $('chat-panel-toggle'); if (chatPanel) chatPanel.removeEventListener('click', onChatPanelToggle);
    const chatPanelClose = $('chat-panel-close'); if (chatPanelClose) chatPanelClose.removeEventListener('click', onChatPanelClose);
    const labelForm = $('label-create-form'); if (labelForm) labelForm.removeEventListener('submit', onLabelCreate);
    const recBtn = $('rec-btn'); if (recBtn) recBtn.removeEventListener('click', onRecordClick);
    const qnPause = $('qn-pause'); if (qnPause) qnPause.removeEventListener('click', onRecPauseToggle);
    const pillPause = $('rec-pill-pause'); if (pillPause) pillPause.removeEventListener('click', onRecPauseToggle);
    const pillStop = $('rec-pill-stop'); if (pillStop) pillStop.removeEventListener('click', onRecPillStop);
    const viewAll = $('home-view-all'); if (viewAll) viewAll.removeEventListener('click', onViewAllNotes);
    const secNotes = $('sec-notes'); if (secNotes) secNotes.removeEventListener('click', onToggleNotesSection);
    const secLabels = $('labels-section'); if (secLabels) secLabels.removeEventListener('click', onToggleLabelsSection);
    const spInput = $('search-pop-input');
    if (spInput) {
      spInput.removeEventListener('input', onSearchPopInput);
      spInput.removeEventListener('keydown', onSearchPopKeydown);
    }
    document.querySelectorAll('.ctx-item[data-act]').forEach(it => it.removeEventListener('click', onCtxAction));
    document.removeEventListener('keydown', onGlobalKeydown);
    document.removeEventListener('pointerdown', onGlobalPointerDown, true);
    window.removeEventListener('scroll', onWindowScroll, true);
    const openSet = $('open-settings'); if (openSet) openSet.removeEventListener('click', onOpenSettings);
    const back = $('settings-back'); if (back) back.removeEventListener('click', onSettingsBack);
    window.removeEventListener('hashchange', onHashChange);
    document.querySelectorAll('.set-item[data-tab]').forEach(s => s.removeEventListener('click', onSettingsTab));
    document.querySelectorAll('.theme-card[data-theme]').forEach(c => {
      c.removeEventListener('click', onThemeCard);
      c.removeEventListener('keydown', onThemeCardKey);
    });
    document.querySelectorAll('.retention-opt[data-days]').forEach(b => b.removeEventListener('click', onRetentionOpt));
  }

  // ------------------------------------------------------------------ boot / hydrate
  // Adopt a boot payload into the model. Preserves the current selection when possible
  // and otherwise selects the newest note. Used by both initial load and host hydrate.
  function adopt(boot) {
    const b = boot || {};
    state.notes = Array.isArray(b.notes) ? b.notes.map(normalizeNote) : [];
    state.labels = normalizeLabelList([].concat(Array.isArray(b.labels) ? b.labels : [], state.notes.flatMap(note => note.labels || [])));
    if (b.settings && Number(b.settings.trashRetentionDays) > 0) {
      state.settings.trashRetentionDays = Number(b.settings.trashRetentionDays);
    }
    // Fail-closed configuration error from the native host: the hosted notes
    // store is unreachable or unconfigured, and the app never falls back to
    // local note files — surface the reason instead of pretending notes exist.
    const bootError = $('boot-error');
    if (bootError) {
      const message = (b.error && b.error.message) || '';
      bootError.textContent = message;
      bootError.hidden = !message;
    }
    // List defaults apply on the initial boot only (contract: latest 10). The host
    // hydrates after EVERY write — re-applying here would reset the user's pagination.
    if (!adopt.booted) {
      adopt.booted = true;
      const limit = b.listDefaults && Number(b.listDefaults.limit);
      state.noteListLimit = limit > 0 ? limit : 10;
    }

    // Keep the open note if it still exists; else newest visible; else null.
    if (!noteById(state.selectedId)) {
      const v = visibleNotes();
      state.selectedId = v.length ? v[0].id : null;
    }
    notifyExpiredTrashReady();
  }

  function normalizeNote(n) {
    return {
      id: String(n.id),
	      title: n.title || '',
	      body: n.body || n.content || '',
	      content: n.content || n.body || '',
	      contentFormat: n.contentFormat || n.contentType || 'markdown',
	      contentPreview: n.contentPreview || '',
      labels: Array.isArray(n.labels) ? n.labels : (Array.isArray(n.tags) ? n.tags : []),
      status: n.status || 'active',
      folder: n.folder || '',
      machine: n.machine || 'unknown',
      machineFriendlyName: n.machineFriendlyName || '',
      rev: Number(n.rev) >= 1 ? Math.floor(Number(n.rev)) : 1,
      updatedAt: n.updatedAt || new Date().toISOString(),
      createdAt: n.createdAt || n.updatedAt || new Date().toISOString(),
      createdByActorType: n.createdByActorType || 'human',
      createdByName: n.createdByName || '',
      archivedAt: n.archivedAt || '',
      trashedAt: n.trashedAt || '',
      trashExpiresAt: n.trashExpiresAt || '',
      restoredAt: n.restoredAt || '',
      info: n.info || null,
      titleLocked: !!n.titleLocked,
      titleSource: n.titleSource || (isDefaultTitle(n.title) ? 'default' : 'manual'),
      titleContentFingerprint: n.titleContentFingerprint || '',
    };
  }

  // Exposed to the native host: re-render from a fresh boot payload after a write.
  function hydrate(boot) {
    adopt(boot);
    render();
    queueAutoTitlesForStaleNotes();
    maybeCleanupExpiredTrash();
  }

  function init() {
    if (started) return;
    started = true;
    state.screen = 'home';   // Home is the default landing screen.
    showApp();
    initTheme();
    // No native __BOOT__ (plain browser): boot empty — no demo notes in the bundle.
    adopt(window.__BOOT__ || {});
    bind();
    render();
    queueAutoTitlesForStaleNotes();
    maybeCleanupExpiredTrash();
    // Deep-linked into settings via #settings[/tab]? Open the settings shell (req 9 —
    // the documented hash contract, applied on load like the hashchange listener).
    const deepTab = settingsHashTab();
    if (deepTab) showSettings(deepTab);
  }

  function destroy() {
    if (!started) return;
    unbind();
    if (saveTimer) commitEdit(); // flush — don't drop — a pending debounced autosave
    editBase = null;
    if (autoTitleTimer) { clearTimeout(autoTitleTimer); autoTitleTimer = null; }
    if (toastTimer) { clearTimeout(toastTimer); toastTimer = null; }
    if (rec.timer) { clearInterval(rec.timer); rec.timer = null; }
    releaseRealtimeAudio();
    stopStream();
    try { if (rec.ws && rec.ws.readyState === WebSocket.OPEN) rec.ws.close(); } catch (e) {}
    closeContextMenu();
    started = false;
  }

  // Host → web: control the live recorder from the macOS menu-bar status item.
  // Contract: window.HasnaNotes.recCommand('stop'|'pause'|'resume').
	  function recCommand(cmd) {
	    if (cmd === 'stop') stopRecording();
	    else if (cmd === 'pause') pauseRecording();
	    else if (cmd === 'resume') resumeRecording();
	  }

  function chatSnapshot() {
    return {
      id: state.chat.id,
      status: state.chat.status,
      messages: state.chat.messages.slice(),
      toolCalls: state.chat.toolCalls.slice(),
      sources: state.chat.sources.slice(),
      pendingConfirmations: state.chat.pendingConfirmations.slice(),
      error: state.chat.error || '',
      goal: state.chat.goal,
    };
  }

  function emitChat(name, detail) {
    const payload = Object.assign({ chat: chatSnapshot() }, detail || {});
    window.dispatchEvent(new CustomEvent(name, { detail: payload }));
  }

  function setChatStatus(status, extra) {
    state.chat.status = status;
    if (extra && extra.error != null) state.chat.error = String(extra.error || '');
    emitChat('hasna:chat-state', Object.assign({ status }, extra || {}));
  }

  function chatNoteRef(note) {
    return {
      id: note.id,
      title: note.title || 'Untitled Note',
      updatedAt: note.updatedAt || '',
      createdAt: note.createdAt || '',
      labels: noteLabels(note),
      status: note.status || 'active',
      machine: note.machine || '',
    };
  }

  function finishChatToolCall(call, result, stateName) {
    call.state = stateName || 'result';
    call.result = result;
    emitChat('hasna:chat-tool-result', { toolCall: call });
  }

  // Human-readable one-liner for a tool call or approval — users never see raw JSON.
  function chatActionSummary(name, input) {
    const data = input || {};
    const bits = [];
    if (data.id) {
      const note = noteById(data.id);
      bits.push(note ? '“' + ((note.title && note.title.trim()) || 'Untitled Note') + '”' : String(data.id).slice(0, 8));
    }
    if (data.title && !data.id) bits.push('“' + String(data.title).slice(0, 60) + '”');
    if (data.label) bits.push('label “' + data.label + '”');
    if (data.query) bits.push('“' + String(data.query).slice(0, 60) + '”');
    return String(name || 'action').replace(/_/g, ' ') + (bits.length ? ' — ' + bits.join(', ') : '');
  }

  // Short human-readable lines for an approval preview (no JSON payload dumps).
  function chatPreviewLines(preview) {
    const p = preview || {};
    const lines = [];
    if (p.title) lines.push('Title: ' + String(p.title).slice(0, 80));
    if (p.fromStatus && p.toStatus) lines.push('Status: ' + p.fromStatus + ' → ' + p.toStatus);
    if (p.noteCount != null) lines.push('Notes: ' + p.noteCount);
    const body = (p.after && p.after.bodyPreview) || p.bodyPreview || p.appendText || '';
    if (body) lines.push(String(body).slice(0, 240));
    return lines;
  }

  function chatMessageText(message) {
    if (!message) return '';
    if (Array.isArray(message.parts)) {
      return message.parts.filter(part => part && part.type === 'text').map(part => part.text || '').join('\n');
    }
    return String(message.text || message.content || '');
  }

  function setChatMessageText(message, text) {
    if (!message.parts) message.parts = [{ type: 'text', text: '' }];
    if (!message.parts.length) message.parts.push({ type: 'text', text: '' });
    message.parts[0].type = 'text';
    message.parts[0].text = String(text || '');
  }

  function renderChatChrome() {
    const stage = $('chat-stage');
    if (stage) {
      stage.classList.toggle('panel-closed', !chatPanelOpen);
      stage.classList.toggle('chat-wide', chatWideView);
    }
    const panel = $('chat-panel');
    if (panel) panel.hidden = !chatPanelOpen;
    const panelToggle = $('chat-panel-toggle');
    if (panelToggle) {
      panelToggle.classList.toggle('active', chatPanelOpen);
      panelToggle.setAttribute('aria-pressed', chatPanelOpen ? 'true' : 'false');
    }
    const viewToggle = $('chat-view-toggle');
    if (viewToggle) {
      viewToggle.classList.toggle('active', chatWideView);
      viewToggle.setAttribute('aria-pressed', chatWideView ? 'true' : 'false');
    }
    setChatMoreMenu(chatMoreOpen);
  }

  function renderChatPage() {
    const status = $('chat-status');
    if (status) {
      status.innerHTML = '';
      status.dataset.status = state.chat.status;
      status.appendChild(el('span', 'chat-status-dot'));
      status.appendChild(el('span', 'chat-status-label', state.chat.status.replace(/_/g, ' ')));
    }
    renderChatChrome();
    renderChatGoal();
    renderChatLog();
    renderChatTools();
    renderChatSources();
    renderChatApprovals();
  }

  function renderChatLog() {
    const host = $('chat-log');
    if (!host) return;
    host.innerHTML = '';
    if (!state.chat.messages.length) {
      host.appendChild(el('div', 'chat-empty', ai().available
        ? 'No messages yet. Ask Hasna Notes anything about your notes.'
        : CHAT_UNAVAILABLE));
      return;
    }
    state.chat.messages.forEach(message => {
      const row = el('div', 'chat-msg chat-' + (message.role || 'assistant'));
      const head = el('div', 'chat-msg-head');
      if (message.role !== 'user') head.appendChild(el('span', 'chat-avatar', 'P'));
      head.appendChild(el('div', 'chat-role', message.role === 'user' ? 'You' : 'Hasna Notes'));
      row.appendChild(head);
      const body = el('div', 'chat-msg-body');
      const messageText = chatMessageText(message);
      const text = el('div', 'chat-text', messageText || (message.sidecarPending ? 'Thinking…' : ''));
      if (!messageText && message.sidecarPending) text.classList.add('chat-typing');
      body.appendChild(text);
      row.appendChild(body);
      host.appendChild(row);
    });
    const scroller = $('chat-scroll');
    if (scroller) scroller.scrollTop = scroller.scrollHeight || 0;
  }

  function chatToolPresentation(call) {
    const name = String(call.name || call.toolName || 'tool');
    const input = call.input || {};
    const path = String(input.path || input.file || input.filename || '');
    const leaf = path.split(/[\\/]/).filter(Boolean).pop() || '';
    let title = '';
    if (/skill\.md$/i.test(path)) title = 'Reading SKILL.md';
    else if (/^(load|loaded|use)_?tool$/i.test(name)) title = 'Loaded a tool';
    else {
      const action = name.replace(/_/g, ' ').trim().toLowerCase() || 'tool';
      if (call.state === 'approval-requested') title = 'Waiting to approve ' + action;
      else if (call.state === 'cancelled') title = 'Cancelled ' + action;
      else if (call.state === 'result') title = 'Ran ' + action;
      else title = 'Running ' + action;
    }
    const summary = chatActionSummary(name, input);
    const marker = summary.indexOf(' — ');
    const detail = leaf && !/skill\.md$/i.test(leaf)
      ? leaf
      : (marker >= 0 ? summary.slice(marker + 3) : 'Tool run');
    return { title, detail };
  }

  const CHAT_TOOL_ICON = '<svg viewBox="0 0 16 16" fill="none"><path d="M9.5 3.1a3.2 3.2 0 01-3.9 3.9l-3 3a1.5 1.5 0 002.1 2.1l3-3a3.2 3.2 0 003.9-3.9L9.8 7 7 4.2l1.8-1.8.7.7z" stroke="currentColor" stroke-width="1.15" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  const CHAT_SOURCE_ICON = '<svg viewBox="0 0 16 16" fill="none"><path d="M4 2.5h5l3 3v8H4z" stroke="currentColor" stroke-width="1.15" stroke-linejoin="round"/><path d="M9 2.5v3h3M6 8h4M6 10.5h4" stroke="currentColor" stroke-width="1.1" stroke-linecap="round"/></svg>';

  function makeChatToolRow(call) {
    const presentation = chatToolPresentation(call);
    const row = el('div', 'ct-row is-' + (call.state || 'call'));
    const icon = el('span', 'ct-icon');
    icon.innerHTML = CHAT_TOOL_ICON;
    row.appendChild(icon);
    const copy = el('div', 'ct-copy');
    copy.appendChild(el('div', 'ct-name', presentation.title));
    copy.appendChild(el('div', 'ct-detail', presentation.detail));
    row.appendChild(copy);
    row.appendChild(el('div', 'ct-state', (call.state || 'running').replace(/-/g, ' ')));
    return row;
  }

  function renderChatTools() {
    const host = $('chat-tools');
    if (!host) return;
    host.innerHTML = '';
    host.hidden = state.chat.toolCalls.length === 0;
    state.chat.toolCalls.forEach(call => host.appendChild(makeChatToolRow(call)));
    renderChatOutputs();
  }

  function renderChatOutputs() {
    const host = $('chat-outputs');
    const count = $('chat-output-count');
    if (count) count.textContent = String(state.chat.toolCalls.length);
    if (!host) return;
    host.innerHTML = '';
    if (!state.chat.toolCalls.length) {
      host.appendChild(el('div', 'chat-panel-empty', 'Tool results will appear here.'));
      return;
    }
    state.chat.toolCalls.forEach(call => {
      const presentation = chatToolPresentation(call);
      const item = el('div', 'co-item');
      const icon = el('span', 'co-icon');
      icon.innerHTML = CHAT_TOOL_ICON;
      item.appendChild(icon);
      const copy = el('div', 'co-copy');
      copy.appendChild(el('div', 'co-title', presentation.title));
      copy.appendChild(el('div', 'co-meta', (call.state || 'running').replace(/-/g, ' ')));
      item.appendChild(copy);
      host.appendChild(item);
    });
  }

  function renderChatSources() {
    const host = $('chat-sources');
    const count = $('chat-source-count');
    if (count) count.textContent = String(state.chat.sources.length);
    if (!host) return;
    host.innerHTML = '';
    if (!state.chat.sources.length) {
      host.appendChild(el('div', 'chat-panel-empty', 'Referenced notes will appear here.'));
      return;
    }
    state.chat.sources.forEach(source => {
      const btn = el('button', 'cs-item');
      btn.type = 'button';
      const icon = el('span', 'cs-icon');
      icon.innerHTML = CHAT_SOURCE_ICON;
      btn.appendChild(icon);
      const copy = el('span', 'cs-copy');
      copy.appendChild(el('span', 'cs-title', source.title || 'Untitled Note'));
      const meta = (source.labels && source.labels.length)
        ? source.labels.slice(0, 2).join(', ')
        : (source.machine || (source.id ? source.id.slice(0, 8) : 'Note'));
      copy.appendChild(el('span', 'cs-meta', meta));
      btn.appendChild(copy);
      btn.addEventListener('click', () => { if (source.id) selectNote(source.id); });
      host.appendChild(btn);
    });
  }

  function renderChatApprovals() {
    const host = $('chat-approvals');
    if (!host) return;
    host.innerHTML = '';
    host.hidden = state.chat.pendingConfirmations.length === 0;
    state.chat.pendingConfirmations.forEach(approval => {
      const row = el('div', 'ca-row');
      row.appendChild(el('div', 'ca-title', chatActionSummary(approval.toolName, approval.input)));
      // Human-readable preview lines — never raw JSON payloads.
      chatPreviewLines(approval.preview || approval.input).forEach(line => {
        row.appendChild(el('div', 'ca-preview', line));
      });
      const actions = el('div', 'ca-actions');
      const approve = el('button', 'ca-btn ca-primary', 'Approve');
      approve.type = 'button';
      approve.addEventListener('click', () => {
        const out = approveChat(approval.id, true);
        if (out && typeof out.then === 'function') out.catch(err => toast(err.message || String(err)));
      });
      const cancel = el('button', 'ca-btn', 'Cancel');
      cancel.type = 'button';
      cancel.addEventListener('click', () => approveChat(approval.id, false));
      actions.appendChild(approve);
      actions.appendChild(cancel);
      row.appendChild(actions);
      host.appendChild(row);
    });
  }

  function renderChatGoal() {
    const card = $('goal-card');
    if (!card) return;
    const goal = state.chat.goal;
    card.hidden = !goal;
    if (!goal) return;
    const title = $('goal-title');
    const stateEl = $('goal-state');
    const steps = $('goal-steps');
    if (title) title.textContent = goal.objective || '';
    if (stateEl) stateEl.textContent = goal.status || 'running';
    if (steps) {
      steps.innerHTML = '';
      (goal.steps || []).forEach(step => {
        const row = el('div', 'goal-step');
        row.appendChild(el('span', 'goal-step-n', String(step.stepNumber || '')));
        row.appendChild(el('span', 'goal-step-text', step.toolCall ? (step.toolCall.name || 'tool') : (step.text || step.status || 'step')));
        row.appendChild(el('span', 'goal-step-status', step.status || 'running'));
        steps.appendChild(row);
      });
    }
  }

  function mergeChatLabels(labels) {
    if (!Array.isArray(labels)) return;
    state.labels = normalizeLabelList(labels);
    renderLabels();
    renderLabelsPage(); // Settings → Labels management list stays in sync
  }

  function mergeChatNote(note) {
    if (!note || !note.id) return;
    const normalized = normalizeNote(note);
    const idx = state.notes.findIndex(item => item.id === normalized.id);
    if (idx >= 0) state.notes[idx] = Object.assign(state.notes[idx], normalized);
    else state.notes.push(normalized);
    rememberLabels(normalized.labels || []);
    renderLabels();
    renderNotesList();
    renderHome();
    if (state.screen === 'noteslist') renderNotesPage();
    renderLabelsPage(); // Settings → Labels management list stays in sync
  }

  function mergeChatToolOutput(output) {
    if (!output || typeof output !== 'object') return;
    if (output.note) mergeChatNote(output.note);
    if (Array.isArray(output.labels)) mergeChatLabels(output.labels);
    if (Array.isArray(output.sources)) state.chat.sources = output.sources;
  }

  function parseChatGoalCommand(prompt) {
    const m = /^\/goal(?:\s+begin)?\s+([\s\S]+)$/i.exec(String(prompt || '').trim());
    return m ? m[1].trim() : '';
  }

  function addSidecarApproval(approval, call) {
    if (!approval || !approval.id) return;
    if (state.chat.pendingConfirmations.some(item => item.id === approval.id)) return;
    const enriched = Object.assign({ sidecar: true, toolCallId: call && call.id }, approval);
    if (!enriched.toolCallId && call) enriched.toolCallId = call.id;
    state.chat.pendingConfirmations.push(enriched);
    emitChat('hasna:chat-confirmation', { approval: enriched });
  }

  function handleSidecarEvent(event, assistantMessage, acc) {
    if (!event || !event.type) return;
    if (event.type === 'text-delta') {
      acc.text += event.text || '';
      setChatMessageText(assistantMessage, acc.text);
      emitChat('hasna:chat-delta', { text: event.text || '' });
      renderChatLog();
      return;
    }
    if (event.type === 'tool-call') {
      const call = event.toolCall || { id: event.toolCallId, name: event.toolName, input: event.input, state: 'call', sidecar: true };
      call.id = call.id || event.toolCallId || ('tool-' + (state.chat.toolCalls.length + 1));
      call.name = call.name || event.toolName;
      call.state = call.state || 'call';
      call.sidecar = true;
      state.chat.toolCalls.push(call);
      emitChat('hasna:chat-tool-call', { toolCall: call });
      renderChatTools();
      return;
    }
    if (event.type === 'tool-result') {
      const call = state.chat.toolCalls.find(item => item.id === event.toolCallId) || state.chat.toolCalls[state.chat.toolCalls.length - 1];
      if (call) {
        call.state = event.output && event.output.requiresConfirmation ? 'approval-requested' : 'result';
        call.result = event.output;
        emitChat('hasna:chat-tool-result', { toolCall: call });
      }
      mergeChatToolOutput(event.output);
      renderChatTools();
      renderChatSources();
      return;
    }
    if (event.type === 'confirmation') {
      const call = state.chat.toolCalls[state.chat.toolCalls.length - 1];
      addSidecarApproval(event.approval, call);
      renderChatApprovals();
      return;
    }
    if (event.type === 'goal-state') {
      state.chat.goal = event.goal;
      renderChatGoal();
      return;
    }
    if (event.type === 'goal-step') {
      const goal = state.chat.goal || { objective: parseChatGoalCommand(acc.prompt), status: 'running', steps: [] };
      const existing = (goal.steps || []).find(step => step.stepNumber === event.stepNumber);
      if (existing) Object.assign(existing, event);
      else goal.steps = (goal.steps || []).concat([event]);
      state.chat.goal = goal;
      renderChatGoal();
      return;
    }
    if (event.type === 'finish') {
      if (!acc.text && event.text) {
        acc.text = event.text;
        setChatMessageText(assistantMessage, acc.text);
      }
      state.chat.messages.forEach(message => { if (message.sidecarPending) delete message.sidecarPending; });
      if (event.goal) state.chat.goal = event.goal;
      (event.pendingConfirmations || []).forEach(approval => addSidecarApproval(approval, state.chat.toolCalls[state.chat.toolCalls.length - 1]));
      emitChat('hasna:chat-sources', { sources: state.chat.sources });
      emitChat('hasna:chat-message', { message: assistantMessage });
      const result = {
        message: assistantMessage,
        text: acc.text,
        sources: state.chat.sources.slice(),
        pendingConfirmations: state.chat.pendingConfirmations.slice(),
        toolCalls: state.chat.toolCalls.slice(),
        goal: state.chat.goal,
      };
      emitChat('hasna:chat-finish', result);
      setChatStatus(state.chat.pendingConfirmations.length ? 'awaiting_confirmation' : 'ready');
      renderChatPage();
      acc.result = result;
      return;
    }
    if (event.type === 'error') {
      throw new Error(event.error || 'chat_failed');
    }
  }

  async function sendSidecarChat(prompt, options) {
    if (!window.fetch || !window.TextDecoder) throw new Error('fetch_unavailable');
    const text = String(prompt || '').trim();
    if (!text) throw new Error('prompt_required');
    const opts = options || {};
    const goalObjective = parseChatGoalCommand(text);
    const userMessage = { id: 'msg-' + Date.now(), role: 'user', parts: [{ type: 'text', text }], sidecarPending: true };
    const assistantMessage = { id: 'msg-' + Date.now() + '-assistant', role: 'assistant', parts: [{ type: 'text', text: '' }], metadata: {}, sidecarPending: true };
    state.chat.messages.push(userMessage);
    state.chat.messages.push(assistantMessage);
    state.chat.toolCalls = [];
    state.chat.sources = [];
    state.chat.pendingConfirmations = [];
    state.chat.error = '';
    state.chat.goal = goalObjective ? { id: 'goal-local-' + Date.now(), objective: goalObjective, status: 'running', steps: [], maxSteps: opts.maxSteps || 10 } : null;
    emitChat('hasna:chat-message', { message: userMessage });
    setChatStatus('submitted');
    setChatStatus('streaming');
    renderChatPage();

    const response = await fetch(aiURL('/chat'), {
      method: 'POST',
      headers: aiHeaders(),
      body: JSON.stringify({
        prompt: text,
        selectedNoteId: opts.noteId || opts.selectedNoteId || state.selectedId || '',
        labels: allLabels().map(item => item.name),
        maxSteps: opts.maxSteps || (goalObjective ? 10 : 8),
        actorName: opts.actorName || 'Hasna Notes Chat',
        goal: goalObjective ? { objective: goalObjective } : undefined,
      }),
    });
    if (!response.ok || !response.body) throw new Error('chat_sidecar_unavailable');
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    const acc = { text: '', prompt: text, result: null };
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      buffer += decoder.decode(chunk.value, { stream: true });
      let idx;
      while ((idx = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, idx).trim();
        buffer = buffer.slice(idx + 1);
        if (!line) continue;
        handleSidecarEvent(JSON.parse(line), assistantMessage, acc);
      }
    }
    if (buffer.trim()) handleSidecarEvent(JSON.parse(buffer.trim()), assistantMessage, acc);
    return acc.result || {
      message: assistantMessage,
      text: acc.text,
      sources: state.chat.sources.slice(),
      pendingConfirmations: state.chat.pendingConfirmations.slice(),
      toolCalls: state.chat.toolCalls.slice(),
      goal: state.chat.goal,
    };
  }

  // Chat is sidecar-backed only. When the sidecar is unavailable the chat surface
  // says so honestly — there is no local fake-AI fallback.
  const CHAT_UNAVAILABLE = 'AI unavailable — chat needs the AI sidecar.';

  function sendChat(prompt, options) {
    const cfg = ai();
    if (!cfg.available || !cfg.port || !window.fetch) {
      setChatStatus('error', { error: CHAT_UNAVAILABLE });
      emitChat('hasna:chat-error', { error: CHAT_UNAVAILABLE });
      renderChatPage();
      return Promise.reject(new Error(CHAT_UNAVAILABLE));
    }
    return sendSidecarChat(prompt, options).catch(err => {
      state.chat.messages = state.chat.messages.filter(message => !message.sidecarPending);
      const error = err.message || String(err);
      setChatStatus('error', { error });
      emitChat('hasna:chat-error', { error });
      renderChatPage();
      throw err;
    });
  }

  async function approveSidecarChat(approval, approved, call) {
    if (!approved) {
      if (call) finishChatToolCall(call, { approved: false, approval }, 'cancelled');
      setChatStatus('ready');
      renderChatPage();
      emitChat('hasna:chat-finish', { approved: false, approval });
      return { approved: false, approval };
    }
    const response = await fetch(aiURL('/tool'), {
      method: 'POST',
      headers: aiHeaders(),
      body: JSON.stringify({
        name: approval.toolName,
        input: Object.assign({}, approval.input || {}, { confirm: true }),
        confirm: true,
        approvalId: approval.id,
        actorName: 'Hasna Notes Chat',
      }),
    });
    if (!response.ok) throw new Error('approval_failed');
    const result = await response.json();
    mergeChatToolOutput(result);
    if (call) finishChatToolCall(call, { approved: true, result, approval }, 'result');
    setChatStatus('ready');
    renderChatPage();
    const out = { approved: true, result, approval, note: result.note ? chatNoteRef(result.note) : undefined };
    emitChat('hasna:chat-finish', out);
    return out;
  }

  // Every approval originates from the sidecar tool loop; applying it goes back
  // through the sidecar /tool endpoint (one apply path, no local duplication).
  function approveChat(approvalId, approved) {
    const approval = state.chat.pendingConfirmations.find(item => item.id === approvalId);
    if (!approval) return null;
    state.chat.pendingConfirmations = state.chat.pendingConfirmations.filter(item => item.id !== approvalId);
    const call = state.chat.toolCalls.find(item => item.id === approval.toolCallId);
    return approveSidecarChat(approval, approved, call);
  }

  function clearChat() {
    state.chat.messages = [];
    state.chat.toolCalls = [];
    state.chat.sources = [];
    state.chat.pendingConfirmations = [];
    state.chat.error = '';
    state.chat.goal = null;
    setChatStatus('ready');
    renderChatPage(); // clear the visible log too, not just the state
    return chatSnapshot();
  }

	  function viewSnapshot() {
	    return {
	      screen: state.screen,
	      labelFilter: state.labelFilter,
	      statusFilter: state.statusFilter,
	      selectedId: state.selectedId,
	      visibleNoteIds: visibleNotes().map(n => n.id),
	    };
	  }

  function editorCommand(commandId, options) {
    const bodyEl = $('editor-body');
    const note = noteById(state.selectedId);
    if (!bodyEl || !note) return null;
    const result = applyMarkdownCommand(bodyEl.value || '', Object.assign({}, options || {}, {
      commandId,
      selectionStart: bodyEl.selectionStart,
      selectionEnd: bodyEl.selectionEnd,
    }));
    bodyEl.value = result.markdown;
    if (typeof bodyEl.setSelectionRange === 'function') {
      bodyEl.setSelectionRange(result.selectionStart, result.selectionEnd);
    }
    note.body = result.markdown;
    note.contentFormat = 'markdown';
    note.updatedAt = new Date().toISOString();
    // Baseline like commitEdit: the hydrate echo of this save must not read as external.
    editBase = { id: note.id, title: note.title, body: note.body, updatedAt: note.updatedAt };
    postNative('save', serializeNote(note));
    renderNotesList();
    renderHome();
    window.dispatchEvent(new CustomEvent('hasna:editor-command', {
      detail: { commandId, noteId: note.id, result },
    }));
    return result;
  }

  // The ONE transcript state path. Both transcript producers — the internal realtime
  // WebSocket and the host hook below — land here: partial text replaces the trailing
  // line, final text appends to the committed transcript, events + UI update once.
  function applyTranscript(text, isFinal, extra) {
    if (isFinal) {
      rec.finalTranscript = [rec.finalTranscript, text].filter(Boolean).join(' ').trim();
      rec.partialTranscript = '';
      if (rec.status === 'transcribing') setRecordingProgress('finalizing-transcript', 0.9);
      emitTranscript('hasna:transcript-complete', rec.finalTranscript, extra);
    } else {
      rec.partialTranscript = text || '';   // partial replaces the trailing partial line
      if (rec.status === 'transcribing') setRecordingProgress('receiving-final-transcript', null);
      emitTranscript('hasna:transcript-delta', rec.partialTranscript, extra);
    }
    emitRecordingState(); // setRecUI → renderTranscript keeps the surface in sync
  }

  // Streaming transcript hook (contract): onTranscript({recId, text, isFinal}). Thin
  // adapter over applyTranscript — the host path must not duplicate transcript state.
  function onTranscript(payload) {
    const p = payload || {};
    const text = typeof p === 'string' ? p : String(p.text || '');
    applyTranscript(text, !!(p && p.isFinal), p);
  }

  // Public surface for the native host.
  window.HasnaNotes = {
    hydrate: hydrate,
    destroy: destroy,
    recCommand: recCommand,
    onTranscript: onTranscript,
	    notes: {
	      archive: archiveNote,
		      trash: trashNoteWithConfirmation,
		      restore: restoreNote,
	      purge: purgeNoteWithConfirmation,
      info: noteInfo,
      setStatusFilter: setStatusFilter,
      cleanupExpiredTrash: cleanupExpiredTrash,
      settings: function () { return Object.assign({}, state.settings); },
      setTrashRetentionDays: function (days) {
        return setTrashRetentionDays(days);
      },
	    },
    labels: {
      list: function () { return allLabels(); },
      create: createLabelLocal,
      rename: renameLabelLocal,
      delete: function (name, confirmed) { return deleteLabelLocal(name, !!confirmed); },
    },
	    view: {
	      state: viewSnapshot,
	    },
	    markdown: {
	      commands: function () { return MARKDOWN_COMMANDS.slice(); },
	      slashCommands: function () { return MARKDOWN_COMMANDS.slice(); },
	      render: renderMarkdownSafe,
	      plainText: markdownPlainText,
	      safeText: markdownSafeText,
	      applyCommand: applyMarkdownCommand,
	    },
	    editor: {
	      command: editorCommand,
	      commands: function () { return MARKDOWN_COMMANDS.slice(); },
	    },
	    chat: {
	      state: chatSnapshot,
	      tools: function () { return CHAT_TOOL_SCHEMAS.slice(); },
	      send: sendChat,
	      approve: approveChat,
	      clear: clearChat,
	    },
	    recording: {
	      state: recordingSnapshot,
      start: startRecording,
      pause: pauseRecording,
      resume: resumeRecording,
      stop: stopRecording,
      // Exposed so the transcript-commit transformation can be regression-tested
      // (it must keep spoken punctuation/newlines verbatim — never markdown-escaped).
      transcriptBody: transcriptToNoteBody,
    },
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init, { once: true });
  } else { init(); }
})();
