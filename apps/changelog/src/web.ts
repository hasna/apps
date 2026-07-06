import { mkdirSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { categoryHeadings, categoryOrder, groupChangelogEntries } from "./markdown.js";
import { LocalChangelogStore } from "./storage.js";
import type { ChangelogEntry, ChangelogStore } from "./types.js";

// Static web changelog generator: one page per app plus RSS 2.0 and
// JSON Feed 1.1 feeds, suitable for publishing from any static host.

export interface ChangelogSiteOptions {
  /** Output directory for the generated site. */
  outDir: string;
  store?: ChangelogStore;
  entries?: ChangelogEntry[];
  /** Restrict the site to one app. */
  appId?: string;
  /** Public base URL used for absolute feed links, e.g. https://changelog.hasna.com */
  baseUrl?: string;
  title?: string;
  /** Max entries per app (default 500). */
  limit?: number;
  now?: Date;
}

export interface ChangelogSiteApp {
  appId: string;
  entries: number;
  latestVersion: string | null;
  latestDate: string | null;
  pagePath: string;
  rssPath: string;
  jsonFeedPath: string;
}

export interface ChangelogSiteResult {
  outDir: string;
  generatedAt: string;
  apps: ChangelogSiteApp[];
  files: string[];
}

export function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function joinUrl(baseUrl: string | undefined, path: string): string {
  if (!baseUrl) return path;
  return `${baseUrl.replace(/\/+$/, "")}/${path.replace(/^\/+/, "")}`;
}

const PAGE_STYLE = `
:root { color-scheme: light dark; --accent: #4460d8; --muted: #71717a; --line: color-mix(in srgb, currentColor 14%, transparent); }
* { box-sizing: border-box; }
body { font: 16px/1.6 ui-sans-serif, system-ui, sans-serif; max-width: 46rem; margin: 0 auto; padding: 2.5rem 1.25rem 5rem; }
h1 { font-size: 1.6rem; letter-spacing: -0.01em; }
h2 { font-size: 1.2rem; margin-top: 2.5rem; padding-top: 1.25rem; border-top: 1px solid var(--line); }
h3 { font-size: 0.8rem; text-transform: uppercase; letter-spacing: 0.08em; color: var(--muted); margin: 1.25rem 0 0.25rem; }
a { color: var(--accent); text-decoration: none; }
a:hover { text-decoration: underline; }
ul { padding-left: 1.2rem; margin: 0.25rem 0; }
li { margin: 0.3rem 0; }
.meta { color: var(--muted); font-size: 0.85rem; }
.feeds { margin-top: 0.5rem; font-size: 0.85rem; }
nav { margin-bottom: 1.5rem; font-size: 0.85rem; }
`.trim();

function pageShell(title: string, body: string, generatedAt: string): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
<style>${PAGE_STYLE}</style>
</head>
<body>
${body}
<p class="meta">Generated ${escapeHtml(generatedAt)} by @hasna/changelog.</p>
</body>
</html>
`;
}

function entryHtml(entry: ChangelogEntry): string {
  const message = entry.message && entry.message !== entry.title ? `: ${escapeHtml(entry.message)}` : "";
  const details = entry.details ? `<br><span class="meta">${escapeHtml(entry.details)}</span>` : "";
  return `<li><strong>${escapeHtml(entry.title)}</strong>${message}${details}</li>`;
}

function appPageHtml(appId: string, entries: ChangelogEntry[], generatedAt: string, siteTitle: string): string {
  const groups = groupChangelogEntries(entries);
  const sections = groups.map((group) => {
    const heading = group.version === "Unreleased" ? "Unreleased" : `${group.version} <span class="meta">${escapeHtml(group.date)}</span>`;
    const categories = categoryOrder
      .map((kind) => {
        const kindEntries = group.entries.filter((entry) => entry.kind === kind);
        if (kindEntries.length === 0) return "";
        return `<h3>${escapeHtml(categoryHeadings[kind])}</h3>\n<ul>\n${kindEntries.map(entryHtml).join("\n")}\n</ul>`;
      })
      .filter(Boolean)
      .join("\n");
    return `<h2 id="${escapeHtml(group.version)}">${heading}</h2>\n${categories}`;
  }).join("\n");

  const body = `<nav><a href="../../index.html">${escapeHtml(siteTitle)}</a></nav>
<h1>${escapeHtml(appId)} changelog</h1>
<p class="feeds">Feeds: <a href="rss.xml">RSS</a> · <a href="feed.json">JSON</a></p>
${sections || "<p>No changes recorded yet.</p>"}`;
  return pageShell(`${appId} changelog`, body, generatedAt);
}

function indexHtml(apps: ChangelogSiteApp[], generatedAt: string, siteTitle: string): string {
  const rows = apps.map((app) => {
    const latest = app.latestVersion ? ` <span class="meta">${escapeHtml(app.latestVersion)}${app.latestDate ? ` · ${escapeHtml(app.latestDate)}` : ""}</span>` : "";
    return `<li><a href="apps/${escapeHtml(app.appId)}/index.html">${escapeHtml(app.appId)}</a>${latest} <span class="meta">(${app.entries} entries · <a href="apps/${escapeHtml(app.appId)}/rss.xml">rss</a> · <a href="apps/${escapeHtml(app.appId)}/feed.json">json</a>)</span></li>`;
  }).join("\n");
  const body = `<h1>${escapeHtml(siteTitle)}</h1>
<ul>
${rows || "<li>No apps recorded yet.</li>"}
</ul>`;
  return pageShell(siteTitle, body, generatedAt);
}

function rssDate(date: string, createdAt: string): string {
  const stamp = new Date(`${date}T00:00:00.000Z`);
  const created = new Date(createdAt);
  const best = Number.isNaN(created.valueOf()) ? stamp : created;
  return (Number.isNaN(best.valueOf()) ? new Date(0) : best).toUTCString();
}

function rssXml(appId: string, entries: ChangelogEntry[], options: ChangelogSiteOptions, generatedAt: string): string {
  const pageUrl = joinUrl(options.baseUrl, `apps/${appId}/`);
  const items = entries.slice(0, 100).map((entry) => `  <item>
    <title>${escapeHtml(`[${entry.version}] ${entry.title}`)}</title>
    <link>${escapeHtml(`${pageUrl}#${encodeURIComponent(entry.version)}`)}</link>
    <guid isPermaLink="false">${escapeHtml(entry.id)}</guid>
    <category>${escapeHtml(entry.kind)}</category>
    <pubDate>${escapeHtml(rssDate(entry.date, entry.createdAt))}</pubDate>
    <description>${escapeHtml(entry.message ?? entry.details ?? entry.title)}</description>
  </item>`).join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
<channel>
  <title>${escapeHtml(`${appId} changelog`)}</title>
  <link>${escapeHtml(pageUrl)}</link>
  <description>${escapeHtml(`Release notes for ${appId}`)}</description>
  <lastBuildDate>${escapeHtml(new Date(generatedAt).toUTCString())}</lastBuildDate>
  <generator>@hasna/changelog</generator>
${items}
</channel>
</rss>
`;
}

function jsonFeed(appId: string, entries: ChangelogEntry[], options: ChangelogSiteOptions): string {
  const pageUrl = joinUrl(options.baseUrl, `apps/${appId}/`);
  const feed = {
    version: "https://jsonfeed.org/version/1.1",
    title: `${appId} changelog`,
    home_page_url: pageUrl,
    feed_url: joinUrl(options.baseUrl, `apps/${appId}/feed.json`),
    description: `Release notes for ${appId}`,
    items: entries.slice(0, 100).map((entry) => ({
      id: entry.id,
      url: `${pageUrl}#${encodeURIComponent(entry.version)}`,
      title: `[${entry.version}] ${entry.title}`,
      content_text: entry.details ?? entry.message ?? entry.title,
      date_published: entry.createdAt,
      tags: [entry.kind, ...entry.tags],
      _changelog: {
        appId: entry.appId,
        version: entry.version,
        kind: entry.kind,
        date: entry.date,
      },
    })),
  };
  return `${JSON.stringify(feed, null, 2)}\n`;
}

async function writeSiteFile(outDir: string, relativePath: string, content: string, files: string[]): Promise<void> {
  const target = join(outDir, relativePath);
  mkdirSync(dirname(target), { recursive: true });
  await writeFile(target, content, "utf8");
  files.push(relativePath);
}

export async function generateChangelogSite(options: ChangelogSiteOptions): Promise<ChangelogSiteResult> {
  const outDir = resolve(options.outDir);
  const now = options.now ?? new Date();
  const generatedAt = now.toISOString();
  const siteTitle = options.title ?? "Changelogs";
  const limit = options.limit ?? 500;

  const store = options.store ?? (options.entries ? null : new LocalChangelogStore());
  const entries = options.entries ?? await store!.listEntries({ appId: options.appId, limit });

  const byApp = new Map<string, ChangelogEntry[]>();
  for (const entry of entries) {
    if (options.appId && entry.appId !== options.appId) continue;
    byApp.set(entry.appId, [...(byApp.get(entry.appId) ?? []), entry]);
  }

  const files: string[] = [];
  const apps: ChangelogSiteApp[] = [];

  for (const [appId, appEntries] of [...byApp.entries()].sort(([left], [right]) => left.localeCompare(right))) {
    const groups = groupChangelogEntries(appEntries);
    const latest = groups.find((group) => group.version !== "Unreleased") ?? null;
    await writeSiteFile(outDir, `apps/${appId}/index.html`, appPageHtml(appId, appEntries, generatedAt, siteTitle), files);
    await writeSiteFile(outDir, `apps/${appId}/rss.xml`, rssXml(appId, appEntries, options, generatedAt), files);
    await writeSiteFile(outDir, `apps/${appId}/feed.json`, jsonFeed(appId, appEntries, options), files);
    apps.push({
      appId,
      entries: appEntries.length,
      latestVersion: latest?.version ?? null,
      latestDate: latest?.date ?? null,
      pagePath: `apps/${appId}/index.html`,
      rssPath: `apps/${appId}/rss.xml`,
      jsonFeedPath: `apps/${appId}/feed.json`,
    });
  }

  await writeSiteFile(outDir, "index.html", indexHtml(apps, generatedAt, siteTitle), files);
  await writeSiteFile(outDir, "site.json", `${JSON.stringify({ generatedAt, title: siteTitle, apps }, null, 2)}\n`, files);

  return { outDir, generatedAt, apps, files };
}
