import type { ExtractedContent, PageMetadata } from "../types/index.js";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function resolveUrl(href: string, baseUrl: string): string {
  if (!href || href.startsWith("#") || href.startsWith("javascript:")) {
    return "";
  }
  try {
    return new URL(href, baseUrl).toString();
  } catch {
    return "";
  }
}

function decodeHtmlEntities(text: string): string {
  return text
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/&#(\d+);/g, (_, code: string) =>
      String.fromCharCode(parseInt(code, 10))
    )
    .replace(/&#x([0-9a-fA-F]+);/g, (_, code: string) =>
      String.fromCharCode(parseInt(code, 16))
    );
}

function stripTag(
  html: string,
  tag: string,
  keepInner = false
): string {
  const open = new RegExp(`<${tag}(?:\\s[^>]*)?>`, "gis");
  const close = new RegExp(`</${tag}>`, "gi");

  if (keepInner) {
    return html.replace(open, "").replace(close, "");
  }

  // Remove opening tag through matching closing tag (greedy enough for nesting)
  const block = new RegExp(`<${tag}(?:\\s[^>]*)?>(?:[\\s\\S]*?)</${tag}>`, "gis");
  return html.replace(block, "");
}

function getTagContent(html: string, tag: string): string | null {
  const m = new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</${tag}>`, "i").exec(
    html
  );
  return m ? decodeHtmlEntities(m[1]?.trim() ?? "").replace(/\s+/g, " ") : null;
}

function getAttribute(tagHtml: string, attr: string): string | null {
  const m = new RegExp(
    `${attr}\\s*=\\s*(?:"([^"]*?)"|'([^']*?)'|([^\\s>]+))`,
    "i"
  ).exec(tagHtml);
  if (!m) return null;
  return decodeHtmlEntities((m[1] ?? m[2] ?? m[3] ?? "").trim());
}

function stripAllTags(html: string): string {
  return html.replace(/<[^>]+>/g, " ");
}

function collapseWhitespace(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

// ─── Title ────────────────────────────────────────────────────────────────────

function extractTitle(html: string): string | null {
  // Try <title>
  const titleTag = getTagContent(html, "title");
  if (titleTag) return titleTag;

  // Try og:title
  const ogTitle = extractMetaProperty(html, "og:title");
  if (ogTitle) return ogTitle;

  // Fallback: first <h1>
  const h1 = getTagContent(html, "h1");
  if (h1) return collapseWhitespace(stripAllTags(h1));

  return null;
}

// ─── Description ─────────────────────────────────────────────────────────────

function extractMetaProperty(html: string, property: string): string | null {
  // <meta property="og:title" content="..."> or <meta name="..." content="...">
  const patterns = [
    new RegExp(
      `<meta[^>]+property\\s*=\\s*["']${property}["'][^>]+content\\s*=\\s*["']([^"']*?)["']`,
      "i"
    ),
    new RegExp(
      `<meta[^>]+content\\s*=\\s*["']([^"']*?)["'][^>]+property\\s*=\\s*["']${property}["']`,
      "i"
    ),
    new RegExp(
      `<meta[^>]+name\\s*=\\s*["']${property}["'][^>]+content\\s*=\\s*["']([^"']*?)["']`,
      "i"
    ),
    new RegExp(
      `<meta[^>]+content\\s*=\\s*["']([^"']*?)["'][^>]+name\\s*=\\s*["']${property}["']`,
      "i"
    ),
  ];

  for (const pattern of patterns) {
    const m = pattern.exec(html);
    if (m?.[1]) return decodeHtmlEntities(m[1].trim());
  }
  return null;
}

function extractDescription(html: string): string | null {
  const desc = extractMetaProperty(html, "description");
  if (desc) return desc;
  return extractMetaProperty(html, "og:description");
}

// ─── Text extraction ──────────────────────────────────────────────────────────

function extractText(html: string): string {
  let text = html;
  text = stripTag(text, "script");
  text = stripTag(text, "style");
  text = stripTag(text, "nav");
  text = stripTag(text, "footer");
  text = stripTag(text, "header");
  text = stripAllTags(text);
  text = decodeHtmlEntities(text);
  return collapseWhitespace(text);
}

// ─── Markdown conversion ──────────────────────────────────────────────────────

function htmlToMarkdown(html: string, baseUrl: string): string {
  let md = html;

  // Remove unwanted blocks first
  md = stripTag(md, "script");
  md = stripTag(md, "style");
  md = stripTag(md, "nav");
  md = stripTag(md, "footer");
  md = stripTag(md, "header");

  // <br> → newline
  md = md.replace(/<br\s*\/?>/gi, "\n");

  // <hr> → ---
  md = md.replace(/<hr\s*\/?>/gi, "\n---\n");

  // Headings
  md = md.replace(/<h1(?:\s[^>]*)?>([\s\S]*?)<\/h1>/gi, (_, inner: string) =>
    `\n# ${collapseWhitespace(stripAllTags(decodeHtmlEntities(inner)))}\n`
  );
  md = md.replace(/<h2(?:\s[^>]*)?>([\s\S]*?)<\/h2>/gi, (_, inner: string) =>
    `\n## ${collapseWhitespace(stripAllTags(decodeHtmlEntities(inner)))}\n`
  );
  md = md.replace(/<h3(?:\s[^>]*)?>([\s\S]*?)<\/h3>/gi, (_, inner: string) =>
    `\n### ${collapseWhitespace(stripAllTags(decodeHtmlEntities(inner)))}\n`
  );
  md = md.replace(/<h4(?:\s[^>]*)?>([\s\S]*?)<\/h4>/gi, (_, inner: string) =>
    `\n#### ${collapseWhitespace(stripAllTags(decodeHtmlEntities(inner)))}\n`
  );
  md = md.replace(/<h5(?:\s[^>]*)?>([\s\S]*?)<\/h5>/gi, (_, inner: string) =>
    `\n##### ${collapseWhitespace(stripAllTags(decodeHtmlEntities(inner)))}\n`
  );
  md = md.replace(/<h6(?:\s[^>]*)?>([\s\S]*?)<\/h6>/gi, (_, inner: string) =>
    `\n###### ${collapseWhitespace(stripAllTags(decodeHtmlEntities(inner)))}\n`
  );

  // Blockquotes
  md = md.replace(
    /<blockquote(?:\s[^>]*)?>([\s\S]*?)<\/blockquote>/gi,
    (_, inner: string) =>
      `\n> ${collapseWhitespace(stripAllTags(decodeHtmlEntities(inner)))}\n`
  );

  // Ordered lists — process <li> inside <ol>
  md = md.replace(/<ol(?:\s[^>]*)?>([\s\S]*?)<\/ol>/gi, (_, inner: string) => {
    let count = 0;
    const items = inner.replace(
      /<li(?:\s[^>]*)?>([\s\S]*?)<\/li>/gi,
      (_m: string, li: string) => {
        count++;
        return `\n${count}. ${collapseWhitespace(stripAllTags(decodeHtmlEntities(li)))}`;
      }
    );
    return `\n${items}\n`;
  });

  // Unordered lists
  md = md.replace(/<ul(?:\s[^>]*)?>([\s\S]*?)<\/ul>/gi, (_, inner: string) => {
    const items = inner.replace(
      /<li(?:\s[^>]*)?>([\s\S]*?)<\/li>/gi,
      (_m: string, li: string) =>
        `\n- ${collapseWhitespace(stripAllTags(decodeHtmlEntities(li)))}`
    );
    return `\n${items}\n`;
  });

  // Inline code (before strong/em to avoid conflicts)
  md = md.replace(
    /<code(?:\s[^>]*)?>([\s\S]*?)<\/code>/gi,
    (_, inner: string) => `\`${decodeHtmlEntities(inner)}\``
  );

  // Strong / bold
  md = md.replace(
    /<(?:strong|b)(?:\s[^>]*)?>([\s\S]*?)<\/(?:strong|b)>/gi,
    (_, inner: string) => `**${decodeHtmlEntities(inner)}**`
  );

  // Em / italic
  md = md.replace(
    /<(?:em|i)(?:\s[^>]*)?>([\s\S]*?)<\/(?:em|i)>/gi,
    (_, inner: string) => `*${decodeHtmlEntities(inner)}*`
  );

  // Links
  md = md.replace(
    /<a(?:\s[^>]*)?href\s*=\s*["']([^"']*?)["'][^>]*>([\s\S]*?)<\/a>/gi,
    (_, href: string, inner: string) => {
      const resolved = resolveUrl(href, baseUrl);
      const text = collapseWhitespace(stripAllTags(decodeHtmlEntities(inner)));
      if (!resolved) return text;
      return `[${text}](${resolved})`;
    }
  );

  // Strip remaining tags
  md = stripAllTags(md);
  md = decodeHtmlEntities(md);

  // Collapse multiple blank lines
  md = md.replace(/\n{3,}/g, "\n\n").trim();

  return md;
}

// ─── Links ────────────────────────────────────────────────────────────────────

function extractLinks(
  html: string,
  baseUrl: string
): Array<{ href: string; text: string }> {
  const links: Array<{ href: string; text: string }> = [];
  const pattern = /<a(?:\s[^>]*)?>[\s\S]*?<\/a>/gi;
  const fullPattern = /<a(\s[^>]*)?>([\s\S]*?)<\/a>/gi;

  let m: RegExpExecArray | null;
  while ((m = fullPattern.exec(html)) !== null) {
    const attrs = m[1] ?? "";
    const inner = m[2] ?? "";
    const href = getAttribute(attrs, "href");
    if (!href) continue;
    const resolved = resolveUrl(href, baseUrl);
    if (!resolved) continue;
    const text = collapseWhitespace(
      stripAllTags(decodeHtmlEntities(inner))
    );
    links.push({ href: resolved, text });
  }

  // Silence unused variable warning from the non-exec pattern
  void pattern;

  return links;
}

// ─── Images ──────────────────────────────────────────────────────────────────

function extractImages(
  html: string,
  baseUrl: string
): Array<{ src: string; alt: string }> {
  const images: Array<{ src: string; alt: string }> = [];
  const pattern = /<img(\s[^>]*)?>/gi;

  let m: RegExpExecArray | null;
  while ((m = pattern.exec(html)) !== null) {
    const attrs = m[1] ?? "";
    const src = getAttribute(attrs, "src");
    if (!src) continue;
    const resolved = resolveUrl(src, baseUrl);
    if (!resolved) continue;
    const alt = getAttribute(attrs, "alt") ?? "";
    images.push({ src: resolved, alt });
  }
  return images;
}

// ─── Headings ─────────────────────────────────────────────────────────────────

function extractHeadings(
  html: string
): Array<{ level: number; text: string }> {
  const headings: Array<{ level: number; text: string }> = [];
  const pattern = /<h([1-6])(?:\s[^>]*)?>([^<]*(?:<(?!\/h\1)[^>]*>[^<]*)*?)<\/h\1>/gi;

  let m: RegExpExecArray | null;
  while ((m = pattern.exec(html)) !== null) {
    const level = parseInt(m[1] ?? "1", 10);
    const inner = m[2] ?? "";
    const text = collapseWhitespace(
      stripAllTags(decodeHtmlEntities(inner))
    );
    if (text) {
      headings.push({ level, text });
    }
  }
  return headings;
}

// ─── Metadata ─────────────────────────────────────────────────────────────────

function extractMetadata(html: string, baseUrl: string): PageMetadata {
  const metadata: PageMetadata = {};

  // Open Graph
  const ogFields = [
    "og:title",
    "og:description",
    "og:image",
    "og:url",
    "og:type",
    "og:site_name",
  ];
  const openGraph: Record<string, string> = {};
  for (const field of ogFields) {
    const value = extractMetaProperty(html, field);
    if (value) openGraph[field] = value;
  }
  // Also catch any og: tags we haven't explicitly listed
  const ogPattern =
    /<meta[^>]+property\s*=\s*["'](og:[^"']+)["'][^>]+content\s*=\s*["']([^"']*?)["']/gi;
  let ogM: RegExpExecArray | null;
  while ((ogM = ogPattern.exec(html)) !== null) {
    const key = ogM[1];
    const val = ogM[2];
    if (key && val && !openGraph[key]) {
      openGraph[key] = decodeHtmlEntities(val);
    }
  }
  if (Object.keys(openGraph).length > 0) {
    metadata.openGraph = openGraph;
  }

  // Twitter Card
  const twitterPattern =
    /<meta[^>]+name\s*=\s*["'](twitter:[^"']+)["'][^>]+content\s*=\s*["']([^"']*?)["']/gi;
  const twitterCard: Record<string, string> = {};
  let twM: RegExpExecArray | null;
  while ((twM = twitterPattern.exec(html)) !== null) {
    const key = twM[1];
    const val = twM[2];
    if (key && val) twitterCard[key] = decodeHtmlEntities(val);
  }
  if (Object.keys(twitterCard).length > 0) {
    metadata.twitterCard = twitterCard;
  }

  // JSON-LD
  const jsonLd: unknown[] = [];
  const jsonLdPattern =
    /<script[^>]+type\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let jlM: RegExpExecArray | null;
  while ((jlM = jsonLdPattern.exec(html)) !== null) {
    const raw = jlM[1]?.trim() ?? "";
    if (!raw) continue;
    try {
      jsonLd.push(JSON.parse(raw));
    } catch {
      // Ignore malformed JSON-LD
    }
  }
  if (jsonLd.length > 0) {
    metadata.jsonLd = jsonLd;
  }

  // Canonical URL
  const canonicalPattern =
    /<link[^>]+rel\s*=\s*["']canonical["'][^>]+href\s*=\s*["']([^"']*?)["']/i;
  const canonM = canonicalPattern.exec(html);
  if (canonM?.[1]) {
    metadata.canonicalUrl = resolveUrl(canonM[1], baseUrl) || canonM[1];
  }

  // Lang
  const langM = /<html[^>]+lang\s*=\s*["']([^"']+)["']/i.exec(html);
  if (langM?.[1]) {
    metadata.lang = langM[1];
  }

  // Robots meta
  const robotsValue = extractMetaProperty(html, "robots");
  if (robotsValue) {
    metadata.robots = robotsValue;
  }

  // Check robots meta tag for noindex/nofollow
  const robotsMeta = html.match(/<meta\s+name=["']robots["']\s+content=["']([^"']+)["']/i)?.[1]?.toLowerCase() ?? "";
  const noindex = robotsMeta.includes("noindex");
  const nofollow = robotsMeta.includes("nofollow");
  if (noindex) metadata.noindex = true;
  if (nofollow) metadata.nofollow = true;

  return metadata;
}

// ─── Word count ───────────────────────────────────────────────────────────────

function countWords(text: string): number {
  const trimmed = text.trim();
  if (!trimmed) return 0;
  return trimmed.split(/\s+/).length;
}

// ─── Navigation strip ─────────────────────────────────────────────────────────

function stripNavigationElements(html: string): string {
  const patterns: RegExp[] = [
    /<nav[\s\S]*?<\/nav>/gi,
    /<header[\s\S]*?<\/header>/gi,
    /<footer[\s\S]*?<\/footer>/gi,
    /<aside[\s\S]*?<\/aside>/gi,
    /<[^>]+\s(?:class|id)=["'][^"']*(?:sidebar|menu|nav|breadcrumb|banner|cookie|popup|modal|overlay|advertisement|ad-|ads-)[^"']*["'][^>]*>[\s\S]*?<\/[a-z]+>/gi,
  ];
  let result = html;
  for (const p of patterns) result = result.replace(p, "");
  return result;
}

// ─── Main export ──────────────────────────────────────────────────────────────

export function extractContent(html: string, baseUrl: string, onlyMainContent?: boolean): ExtractedContent {
  // Strip navigation/chrome elements when onlyMainContent is true (default)
  const processedHtml = (onlyMainContent !== false) ? stripNavigationElements(html) : html;
  const title = extractTitle(html);
  const description = extractDescription(html);
  const text = extractText(processedHtml);
  const markdown = htmlToMarkdown(processedHtml, baseUrl);
  const links = extractLinks(html, baseUrl);
  const images = extractImages(html, baseUrl);
  const headings = extractHeadings(processedHtml);
  const metadata = extractMetadata(html, baseUrl);
  const wordCount = countWords(text);

  metadata.headings = headings;
  metadata.links = links;
  metadata.images = images;

  return {
    title,
    description,
    text,
    markdown,
    links,
    images,
    headings,
    metadata,
    wordCount,
  };
}
