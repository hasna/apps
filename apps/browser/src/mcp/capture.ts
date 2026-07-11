// ─── Capture + extraction tools ──────────────────────────────────────────────

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { clampChars, clampLimit, compactList, truncateText } from "./compact.js";
import {
  registerTool,
  z,
  json,
  err,
  errWithScreenshot,
  resolveSessionId,
  getSessionPage,
  getText,
  getHTML,
  getLinks,
  getTitle,
  extract,
  findElements,
  elementExists,
  getPageInfo,
  takeScreenshot,
  generatePDF,
  takeSnapshotFn,
  setLastSnapshot,
  getLastSnapshot,
  diffSnapshots,
  getConsoleLog,
  getPerformanceMetrics,
  saveToDownloads,
  scroll,
  logEvent,
} from "./helpers.js";

export function register(server: McpServer) {

// ── Extraction Tools ──────────────────────────────────────────────────────────

registerTool(server,
  "browser_get_text",
  "Get text content from the page or a selector. Compact and sanitized by default; set verbose=true for full text.",
  { session_id: z.string().optional(), selector: z.string().optional(), sanitize: z.boolean().optional().default(true).describe("Strip prompt injection patterns from text (default: true)"), max_chars: z.number().optional().default(4000), verbose: z.boolean().optional().default(false) },
  async ({ session_id, selector, sanitize, max_chars, verbose }) => {
    try {
      const maxChars = clampChars(max_chars);
      const sid = resolveSessionId(session_id);
      const page = getSessionPage(sid);
      let text = await getText(page, selector);
      let stripped = 0;
      let warnings: string[] = [];
      if (sanitize) {
        const { sanitizeText } = await import("../lib/sanitize.js");
        const sanitized = sanitizeText(text);
        text = sanitized.text;
        stripped = sanitized.stripped;
        warnings = sanitized.warnings;
      }
      const truncated = !verbose && text.length > maxChars;
      return json({ text: truncated ? `${text.slice(0, maxChars)}…` : text, length: text.length, truncated, stripped, warnings, max_chars: maxChars, hint: truncated ? "Set verbose=true or raise max_chars for full text." : undefined });
    } catch (e) { return err(e); }
  }
);

registerTool(server,
  "browser_get_html",
  "Get HTML content from the page or a selector. Compact and sanitized by default; set verbose=true for full HTML.",
  { session_id: z.string().optional(), selector: z.string().optional(), sanitize: z.boolean().optional().default(true).describe("Strip prompt injection patterns and hidden elements from HTML (default: true)"), max_chars: z.number().optional().default(4000), verbose: z.boolean().optional().default(false) },
  async ({ session_id, selector, sanitize, max_chars, verbose }) => {
    try {
      const maxChars = clampChars(max_chars);
      const sid = resolveSessionId(session_id);
      const page = getSessionPage(sid);
      let html = await getHTML(page, selector);
      let stripped = 0;
      let warnings: string[] = [];
      if (sanitize) {
        const { sanitizeHTML } = await import("../lib/sanitize.js");
        const sanitized = sanitizeHTML(html);
        html = sanitized.text;
        stripped = sanitized.stripped;
        warnings = sanitized.warnings;
      }
      const truncated = !verbose && html.length > maxChars;
      return json({ html: truncated ? `${html.slice(0, maxChars)}…` : html, length: html.length, truncated, stripped, warnings, max_chars: maxChars, hint: truncated ? "Set verbose=true or raise max_chars for full HTML." : undefined });
    } catch (e) { return err(e); }
  }
);

registerTool(server,
  "browser_get_links",
  "Get links from the current page. Compact by default; set verbose=true or raise limit for more.",
  { session_id: z.string().optional(), limit: z.number().optional().default(50), offset: z.number().optional().default(0), verbose: z.boolean().optional().default(false) },
  async ({ session_id, limit, offset, verbose }) => {
    try {
      const sid = resolveSessionId(session_id);
      const page = getSessionPage(sid);
      const links = await getLinks(page);
      if (verbose) {
        const page = compactList(links, limit, (link) => link, { offset });
        return json({ links: page.items, count: page.count, total: page.total, limit: page.limit, truncated: page.truncated, next_offset: page.next_offset });
      }
      const compact = compactList(links, limit, (link) => truncateText(link, 180), {
        offset,
        hint: "Set verbose=true or increase limit for all links.",
      });
      return json({ links: compact.items, count: compact.count, total: compact.total, limit: compact.limit, truncated: compact.truncated, next_offset: compact.next_offset, hint: compact.hint });
    } catch (e) { return err(e); }
  }
);

registerTool(server,
  "browser_extract",
  "Extract content from the page in a specified format. Sanitizes prompt injection by default.",
  {
    session_id: z.string().optional(),
    format: z.enum(["text", "html", "links", "table", "structured"]).optional().default("text"),
    selector: z.string().optional(),
    schema: z.record(z.string()).optional(),
    sanitize: z.boolean().optional().default(true).describe("Strip prompt injection patterns from extracted content (default: true)"),
    max_chars: z.number().optional().default(4000),
    limit: z.number().optional().default(50),
    verbose: z.boolean().optional().default(false),
  },
  async ({ session_id, format, selector, schema, sanitize, max_chars, limit, verbose }) => {
    try {
      const maxChars = clampChars(max_chars);
      const rowLimit = clampLimit(limit, 50);
      const sid = resolveSessionId(session_id);
      const page = getSessionPage(sid);
      const result = await extract(page, { format, selector, schema });
      if (sanitize) {
        const { sanitizeText, sanitizeHTML } = await import("../lib/sanitize.js");
        if (result.text) {
          const s = sanitizeText(result.text);
          result.text = s.text;
          (result as any).stripped = s.stripped;
          (result as any).warnings = s.warnings;
        }
        if (result.html) {
          const s = sanitizeHTML(result.html);
          result.html = s.text;
          (result as any).stripped = s.stripped;
          (result as any).warnings = s.warnings;
        }
      }
      if (verbose) return json(result);
      if (result.text && result.text.length > maxChars) {
        return json({ ...result, text: `${result.text.slice(0, maxChars)}…`, length: result.text.length, truncated: true, max_chars: maxChars, hint: "Set verbose=true or raise max_chars for full text." });
      }
      if (result.html && result.html.length > maxChars) {
        return json({ ...result, html: `${result.html.slice(0, maxChars)}…`, length: result.html.length, truncated: true, max_chars: maxChars, hint: "Set verbose=true or raise max_chars for full HTML." });
      }
      if (result.links && result.links.length > rowLimit) {
        return json({ ...result, links: result.links.slice(0, rowLimit).map((link) => truncateText(link, 180)), count: rowLimit, total: result.links.length, truncated: true, limit: rowLimit, hint: "Set verbose=true or raise limit for all links." });
      }
      if (result.table && result.table.length > rowLimit) {
        return json({ ...result, table: result.table.slice(0, rowLimit), count: rowLimit, total: result.table.length, truncated: true, limit: rowLimit, hint: "Set verbose=true or raise limit for all table rows." });
      }
      return json(result);
    } catch (e) { return err(e); }
  }
);

registerTool(server,
  "browser_find",
  "Find elements matching a selector and return their text",
  { session_id: z.string().optional(), selector: z.string(), limit: z.number().optional().default(50), verbose: z.boolean().optional().default(false) },
  async ({ session_id, selector, limit, verbose }) => {
    try {
      const rowLimit = clampLimit(limit, 50);
      const sid = resolveSessionId(session_id);
      const page = getSessionPage(sid);
      const elements = await findElements(page, selector);
      const texts = await Promise.all(elements.map((el) => el.textContent()));
      return json({
        count: elements.length,
        texts: (verbose ? texts : texts.slice(0, rowLimit).map((text) => truncateText(text, 180))),
        limit: rowLimit,
        truncated: !verbose && texts.length > rowLimit,
        hint: !verbose && texts.length > rowLimit ? "Set verbose=true or raise limit for all matched text." : undefined,
      });
    } catch (e) { return err(e); }
  }
);

registerTool(server,
  "browser_snapshot",
  "Get accessibility snapshot with element refs (@e0, @e1...). Use compact=true (default) for token-efficient output. Use refs in browser_click, browser_type, etc. Sanitizes prompt injection by default.",
  {
    session_id: z.string().optional(),
    compact: z.boolean().optional().default(true),
    max_refs: z.number().optional().default(50),
    full_tree: z.boolean().optional().default(false),
    sanitize: z.boolean().optional().default(true).describe("Strip prompt injection patterns from snapshot text (default: true)"),
  },
  async ({ session_id, compact, max_refs, full_tree, sanitize }) => {
    try {
      const refLimit = clampLimit(max_refs, 50);
      const sid = resolveSessionId(session_id);
      const page = getSessionPage(sid);
      const result = await takeSnapshotFn(page, sid);
      setLastSnapshot(sid, result);

      // Apply sanitization to tree text
      let injection_warnings: string[] | undefined;
      if (sanitize) {
        const { sanitizeText } = await import("../lib/sanitize.js");
        const sanitized = sanitizeText(result.tree);
        if (sanitized.stripped > 0) {
          injection_warnings = sanitized.warnings;
          result.tree = sanitized.text;
        }
      }

      // Limit refs to max_refs
      const refEntries = Object.entries(result.refs).slice(0, refLimit);
      const limitedRefs = Object.fromEntries(refEntries);
      const truncated = Object.keys(result.refs).length > refLimit;

      if (compact && !full_tree) {
        // Compact: return refs as a single concise line per element
        const compactRefs = refEntries
          .map(([ref, info]) => `${info.role}:${info.name.slice(0, 60)} [${ref}]${info.checked !== undefined ? ` checked=${info.checked}` : ""}${!info.enabled ? " disabled" : ""}`)
          .join("\n");
        return json({
          snapshot_compact: compactRefs,
          interactive_count: result.interactive_count,
          shown_count: refEntries.length,
          limit: refLimit,
          truncated,
          refs: limitedRefs,
          ...(injection_warnings ? { injection_warnings } : {}),
        });
      }

      // Full tree mode — truncate to 5000 chars
      const tree = full_tree ? result.tree : result.tree.slice(0, 5000) + (result.tree.length > 5000 ? "\n... (truncated — use full_tree=true for complete)" : "");
      return json({ snapshot: tree, refs: limitedRefs, interactive_count: result.interactive_count, limit: refLimit, truncated, ...(injection_warnings ? { injection_warnings } : {}) });
    } catch (e) { return err(e); }
  }
);

// ── Capture Tools ─────────────────────────────────────────────────────────────

registerTool(server,
  "browser_screenshot",
  "Take a screenshot. Use selector to capture a specific element/section instead of the full page. Use detail='high' for AI-readable full image, 'low' for fast thumbnail. Use annotate=true to overlay numbered labels on interactive elements.",
  {
    session_id: z.string().optional(),
    selector: z.string().optional().describe("CSS selector to screenshot a specific section (e.g. '#main', '.header', 'form')"),
    full_page: z.boolean().optional().default(false),
    format: z.enum(["png", "jpeg", "webp"]).optional().default("webp"),
    quality: z.number().optional().default(60),
    max_width: z.number().optional().default(800),
    compress: z.boolean().optional().default(true),
    thumbnail: z.boolean().optional().default(true),
    annotate: z.boolean().optional().default(false),
    detail: z.enum(["low", "high"]).optional().default("low").describe("'low' = thumbnail only (fast, saves tokens). 'high' = full readable image in base64 (larger but AI can read text)."),
  },
  async ({ session_id, selector, full_page, format, quality, max_width, compress, thumbnail, annotate, detail }) => {
    try {
      const sid = resolveSessionId(session_id);
      const page = getSessionPage(sid);

      // Annotated screenshot path
      if (annotate && !selector && !full_page) {
        const { annotateScreenshot } = await import("../lib/annotate.js");
        const annotated = await annotateScreenshot(page, sid);
        const base64 = annotated.buffer.toString("base64");
        return json({
          base64: base64.length > 50000 ? undefined : base64,
          base64_truncated: base64.length > 50000,
          size_bytes: annotated.buffer.length,
          annotations: annotated.annotations,
          label_to_ref: annotated.labelToRef,
          annotation_count: annotated.annotations.length,
        });
      }

      // detail=high: use larger image for AI readability (1280px, quality 75)
      const effectiveMaxWidth = detail === "high" ? 1280 : max_width;
      const effectiveQuality = detail === "high" ? 75 : quality;

      const result = await takeScreenshot(page, { selector, fullPage: full_page, format, quality: effectiveQuality, maxWidth: effectiveMaxWidth, compress, thumbnail });
      // Populate URL
      result.url = page.url();
      // Auto-save to downloads folder
      try {
        const buf = Buffer.from(result.base64, "base64");
        const filename = result.path.split("/").pop() ?? `screenshot.${format ?? "webp"}`;
        const dl = saveToDownloads(buf, filename, { sessionId: sid, type: "screenshot", sourceUrl: page.url() });
        (result as any).download_id = dl.id;
      } catch { /* non-fatal */ }
      // Token estimate before truncation
      (result as any).estimated_tokens = Math.ceil(result.base64.length / 4);
      // Smart base64 truncation — detail=high skips truncation so AI can read the image
      if (detail !== "high" && result.base64.length > 40000) {
        (result as any).base64_truncated = true;
        (result as any).full_image_path = result.path;
        result.base64 = result.thumbnail_base64 ?? "";
      }
      logEvent(sid, "screenshot", { path: result.path, detail, selector });
      return json(result);
    } catch (e) { return err(e); }
  }
);

registerTool(server,
  "browser_pdf",
  "Generate a PDF of the current page",
  {
    session_id: z.string().optional(),
    format: z.enum(["A4", "Letter", "A3", "A5"]).optional().default("A4"),
    landscape: z.boolean().optional().default(false),
    print_background: z.boolean().optional().default(true),
  },
  async ({ session_id, format, landscape, print_background }) => {
    try {
      const sid = resolveSessionId(session_id);
      const page = getSessionPage(sid);
      const result = await generatePDF(page, { format, landscape, printBackground: print_background });
      // Auto-save to downloads
      try {
        const buf = Buffer.from(result.base64, "base64");
        const filename = result.path.split("/").pop() ?? "document.pdf";
        const dl = saveToDownloads(buf, filename, { sessionId: sid, type: "pdf", sourceUrl: page.url() });
        (result as any).download_id = dl.id;
      } catch { /* non-fatal */ }
      return json(result);
    } catch (e) { return err(e); }
  }
);

// ── Element exists ────────────────────────────────────────────────────────────

registerTool(server,
  "browser_element_exists",
  "Check if a selector exists on the page (no throw, returns boolean)",
  { session_id: z.string().optional(), selector: z.string(), check_visible: z.boolean().optional().default(false) },
  async ({ session_id, selector, check_visible }) => {
    try {
      const sid = resolveSessionId(session_id);
      const page = getSessionPage(sid);
      return json(await elementExists(page, selector, { visible: check_visible }));
    } catch (e) { return err(e); }
  }
);

// ── Page info ─────────────────────────────────────────────────────────────────

registerTool(server,
  "browser_get_page_info",
  "Get a full page summary in one call: url, title, meta tags, link/image/form counts, text length",
  { session_id: z.string().optional() },
  async ({ session_id }) => {
    try {
      const sid = resolveSessionId(session_id);
      const page = getSessionPage(sid);
      const info = await getPageInfo(page);
      // Enrich with console error status if logging is active
      const errors = getConsoleLog(sid, "error");
      info.has_console_errors = errors.length > 0;
      return json(info);
    } catch (e) { return err(e); }
  }
);

// ── Combined: scroll + screenshot ─────────────────────────────────────────────

registerTool(server,
  "browser_scroll_and_screenshot",
  "Scroll the page and take a screenshot in one call. Saves 3 separate tool calls.",
  { session_id: z.string().optional(), direction: z.enum(["up", "down", "left", "right"]).optional().default("down"), amount: z.number().optional().default(500), wait_ms: z.number().optional().default(300) },
  async ({ session_id, direction, amount, wait_ms }) => {
    try {
      const sid = resolveSessionId(session_id);
      const page = getSessionPage(sid);
      await scroll(page, direction, amount);
      await new Promise((r) => setTimeout(r, wait_ms));
      const result = await takeScreenshot(page, { maxWidth: 1280, track: true });
      result.url = page.url();
      if (result.base64.length > 50000) {
        (result as any).base64_truncated = true;
        (result as any).full_image_path = result.path;
        result.base64 = result.thumbnail_base64 ?? "";
      }
      return json({ scrolled: { direction, amount }, screenshot: result });
    } catch (e) { return err(e); }
  }
);

// ── Snapshot Diff ────────────────────────────────────────────────────────────

registerTool(server,
  "browser_snapshot_diff",
  "Take a new accessibility snapshot and diff it against the last snapshot for this session. Shows added/removed/modified interactive elements.",
  { session_id: z.string().optional() },
  async ({ session_id }) => {
    try {
      const sid = resolveSessionId(session_id);
      const page = getSessionPage(sid);
      const before = getLastSnapshot(sid);
      const after = await takeSnapshotFn(page, sid);
      setLastSnapshot(sid, after);

      if (!before) {
        return json({
          message: "No previous snapshot — returning current snapshot only.",
          snapshot: after.tree,
          refs: after.refs,
          interactive_count: after.interactive_count,
        });
      }

      const diff = diffSnapshots(before, after);
      return json({
        diff,
        added_count: diff.added.length,
        removed_count: diff.removed.length,
        modified_count: diff.modified.length,
        url_changed: diff.url_changed,
        title_changed: diff.title_changed,
        current_interactive_count: after.interactive_count,
      });
    } catch (e) { return err(e); }
  }
);

// ── browser_check ─────────────────────────────────────────────────────────────

registerTool(server,
  "browser_check",
  "RECOMMENDED FIRST CALL: one-shot page summary — url, title, errors, performance, thumbnail, refs. Replaces 4+ separate tool calls.",
  { session_id: z.string().optional() },
  async ({ session_id }) => {
    try {
      const sid = resolveSessionId(session_id);
      const page = getSessionPage(sid);
      const info = await getPageInfo(page);
      const errors = getConsoleLog(sid, "error");
      info.has_console_errors = errors.length > 0;
      let perf = {};
      try { perf = await getPerformanceMetrics(page); } catch {}
      let thumbnail_base64 = "";
      try {
        const ss = await takeScreenshot(page, { maxWidth: 400, quality: 60, track: false, thumbnail: false });
        thumbnail_base64 = ss.base64.length > 50000 ? "" : ss.base64;
      } catch {}
      let snapshot_refs = "";
      let interactive_count = 0;
      try {
        const snap = await takeSnapshotFn(page, sid);
        setLastSnapshot(sid, snap);
        interactive_count = snap.interactive_count;
        snapshot_refs = Object.entries(snap.refs).slice(0, 30)
          .map(([ref, i]) => `${i.role}:${i.name.slice(0, 50)} [${ref}]`)
          .join(", ");
      } catch {}
      return json({ ...info, error_count: errors.length, performance: perf, thumbnail_base64, snapshot_refs, interactive_count });
    } catch (e) { return err(e); }
  }
);

// ── Extract structured ────────────────────────────────────────────────────────

registerTool(server,
  "browser_extract_structured",
  "Extract structured data from page. Returns counts by default; set include_data=true for full structured payload.",
  {
    session_id: z.string().optional(),
    include_data: z.boolean().optional().default(false),
    limit: z.number().optional().default(10),
    max_chars: z.number().optional().default(4000),
  },
  async ({ session_id, include_data, limit, max_chars }) => {
    try {
      const rowLimit = clampLimit(limit, 10);
      const maxChars = clampChars(max_chars);
      const sid = resolveSessionId(session_id);
      const page = getSessionPage(sid);
      const { extractStructuredData } = await import("../lib/structured-extract.js");
      const data = await extractStructuredData(page);
      const summary = {
        tables: data.tables.length,
        lists: data.lists.length,
        json_ld: data.jsonLd.length,
        open_graph: Object.keys(data.openGraph).length,
        meta_tags: Object.keys(data.metaTags).length,
        repeated_elements: data.repeatedElements.length,
      };
      if (include_data) return json({ ...summary, data });
      return json({
        ...summary,
        sample: {
          tables: data.tables.slice(0, rowLimit).map((table: unknown) => truncateText(JSON.stringify(table), maxChars)),
          lists: data.lists.slice(0, rowLimit).map((list: unknown) => truncateText(JSON.stringify(list), maxChars)),
          json_ld: data.jsonLd.slice(0, rowLimit).map((item: unknown) => truncateText(JSON.stringify(item), maxChars)),
          repeated_elements: data.repeatedElements.slice(0, rowLimit).map((item: unknown) => truncateText(JSON.stringify(item), maxChars)),
        },
        limit: rowLimit,
        max_chars: maxChars,
        truncated: data.tables.length > rowLimit || data.lists.length > rowLimit || data.jsonLd.length > rowLimit || data.repeatedElements.length > rowLimit,
        hint: "Full structured data omitted by default. Set include_data=true for the full payload.",
      });
    } catch (e) { return err(e); }
  }
);

// ── Assert ────────────────────────────────────────────────────────────────────

registerTool(server,
  "browser_assert",
  "Assert page conditions in one call. Conditions: 'url contains X', 'text:\"Y\" is visible', 'element:\"#id\" exists', 'count:\"a\" > 10', 'title contains Z'. Chain with AND.",
  { session_id: z.string().optional(), condition: z.string() },
  async ({ session_id, condition }) => {
    try {
      const sid = resolveSessionId(session_id);
      const page = getSessionPage(sid);
      const checks: Array<{ assertion: string; result: boolean }> = [];
      let passed = true;

      for (const part of condition.split(/\s+AND\s+/i)) {
        const trimmed = part.trim();
        let result = false;
        try {
          if (/^url\s+contains\s+/i.test(trimmed)) {
            result = page.url().includes(trimmed.replace(/^url\s+contains\s+/i, "").replace(/^["']|["']$/g, ""));
          } else if (/^title\s+contains\s+/i.test(trimmed)) {
            const needle = trimmed.replace(/^title\s+contains\s+/i, "").replace(/^["']|["']$/g, "");
            result = (await getTitle(page)).toLowerCase().includes(needle.toLowerCase());
          } else if (/^text:["']([^"']+)["']/i.test(trimmed)) {
            const text = trimmed.match(/^text:["']([^"']+)["']/i)?.[1] ?? "";
            result = await page.evaluate(`document.body?.textContent?.includes(${JSON.stringify(text)}) ?? false`) as boolean;
          } else if (/^element:["'](.+)["']/i.test(trimmed)) {
            const sel = trimmed.match(/^element:["'](.+)["']/i)?.[1] ?? "";
            result = await page.evaluate(`!!document.querySelector(${JSON.stringify(sel)})`) as boolean;
          } else if (/^count:["']([^"']+)["']\s*([><=!]+)\s*(\d+)/i.test(trimmed)) {
            const [, sel, op, n] = trimmed.match(/^count:["']([^"']+)["']\s*([><=!]+)\s*(\d+)/i)!;
            const count = await page.evaluate(`document.querySelectorAll(${JSON.stringify(sel)}).length`) as number;
            const num = parseInt(n);
            result = op === ">" ? count > num : op === ">=" ? count >= num : op === "<" ? count < num : op === "<=" ? count <= num : count === num;
          }
        } catch { result = false; }
        checks.push({ assertion: trimmed, result });
        if (!result) passed = false;
      }
      return json({ passed, checks, condition });
    } catch (e) { return err(e); }
  }
);

// ── Visual diff between two URLs ─────────────────────────────────────────────

registerTool(server,
  "browser_diff",
  "Visual diff between two URLs or a URL and a gallery entry. Screenshots both, returns a pixel diff image highlighting changes in red.",
  {
    session_id: z.string().optional(),
    url1: z.string().describe("First URL to screenshot"),
    url2: z.string().describe("Second URL to screenshot"),
    threshold: z.number().optional().default(10).describe("Pixel difference threshold (0-255, default 10)"),
    wait_ms: z.number().optional().default(1000).describe("Wait time after navigation before screenshot (ms)"),
    include_diff_base64: z.boolean().optional().default(false),
  },
  async ({ session_id, url1, url2, threshold, wait_ms, include_diff_base64 }) => {
    try {
      const sid = resolveSessionId(session_id);
      const page = getSessionPage(sid);

      // Screenshot URL 1
      await page.goto(url1, { waitUntil: "domcontentloaded" });
      await new Promise((r) => setTimeout(r, wait_ms));
      const ss1 = await takeScreenshot(page, { maxWidth: 1280, compress: true, track: false });

      // Screenshot URL 2
      await page.goto(url2, { waitUntil: "domcontentloaded" });
      await new Promise((r) => setTimeout(r, wait_ms));
      const ss2 = await takeScreenshot(page, { maxWidth: 1280, compress: true, track: false });

      // Diff the two screenshots
      const { diffImages } = await import("../lib/gallery-diff.js");
      const diff = await diffImages(ss1.path, ss2.path, threshold);

      logEvent(sid, "diff", { url1, url2, changed_percent: diff.changed_percent });

      return json({
        url1,
        url2,
        changed_pixels: diff.changed_pixels,
        total_pixels: diff.total_pixels,
        changed_percent: Math.round(diff.changed_percent * 100) / 100,
        diff_path: diff.diff_path,
        diff_base64: include_diff_base64 && diff.diff_base64.length <= 50000 ? diff.diff_base64 : undefined,
        diff_base64_omitted: !include_diff_base64,
        screenshot1_path: ss1.path,
        screenshot2_path: ss2.path,
      });
    } catch (e) { return err(e); }
  }
);

} // end register
