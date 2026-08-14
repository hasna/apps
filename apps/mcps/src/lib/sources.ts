import { mkdirSync, existsSync, readFileSync, writeFileSync, readdirSync, unlinkSync } from "fs";
import { join } from "path";
import { getDb } from "./db.js";
import { MCPS_DIR } from "./config.js";
import type { McpSource, AddSourceOptions, FinderResult, RegistryServerEntry } from "../types.js";

// --- File-based caching ---

const CACHE_DIR = join(MCPS_DIR, "cache");
const DEFAULT_TTL_MS = 10 * 60 * 1000; // 10 minutes

function getCacheFile(sourceId: string): string {
  return join(CACHE_DIR, `${sourceId}.json`);
}

function readCache(sourceId: string): { results: FinderResult[]; cachedAt: number } | null {
  try {
    const file = getCacheFile(sourceId);
    if (!existsSync(file)) return null;
    const data = JSON.parse(readFileSync(file, "utf-8"));
    return data;
  } catch {
    return null;
  }
}

function writeCache(sourceId: string, results: FinderResult[]): void {
  try {
    mkdirSync(CACHE_DIR, { recursive: true });
    writeFileSync(getCacheFile(sourceId), JSON.stringify({ results, cachedAt: Date.now() }), "utf-8");
  } catch {}
}

export function clearCache(sourceId?: string): void {
  try {
    if (!existsSync(CACHE_DIR)) return;
    const files = readdirSync(CACHE_DIR);
    for (const file of files) {
      if (!file.endsWith(".json")) continue;
      if (!sourceId || file.startsWith(`${sourceId}.`)) {
        try { unlinkSync(join(CACHE_DIR, file)); } catch {}
      }
    }
  } catch {}
}

// --- CRUD ---

function generateId(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

export function listSources(): McpSource[] {
  const db = getDb();
  const rows = db.query("SELECT * FROM sources ORDER BY created_at ASC").all() as any[];
  return rows.map((r) => ({ ...r, enabled: r.enabled === 1 }));
}

export function getSource(id: string): McpSource | null {
  const db = getDb();
  const row = db.query("SELECT * FROM sources WHERE id = ?").get(id) as any;
  if (!row) return null;
  return { ...row, enabled: row.enabled === 1 };
}

export function addSource(opts: AddSourceOptions): McpSource {
  const db = getDb();
  const id = generateId(opts.name);
  db.run(
    "INSERT INTO sources (id, name, type, url, description) VALUES (?, ?, ?, ?, ?)",
    [id, opts.name, opts.type, opts.url, opts.description ?? null]
  );
  return getSource(id)!;
}

export function removeSource(id: string): void {
  const db = getDb();
  db.run("DELETE FROM sources WHERE id = ?", [id]);
}

export function enableSource(id: string): void {
  const db = getDb();
  db.run("UPDATE sources SET enabled = 1 WHERE id = ?", [id]);
}

export function disableSource(id: string): void {
  const db = getDb();
  db.run("UPDATE sources SET enabled = 0 WHERE id = ?", [id]);
}

// --- Per-source search functions ---

async function searchMcpRegistry(source: McpSource, query: string): Promise<FinderResult[]> {
  try {
    const res = await fetch(source.url);
    if (!res.ok) return [];
    const data = (await res.json()) as { servers: RegistryServerEntry[] };
    const q = query.toLowerCase();
    return (data.servers || [])
      .map((e) => e.server)
      .filter(
        (s) =>
          q === "" ||
          s.name.toLowerCase().includes(q) ||
          (s.description || "").toLowerCase().includes(q)
      )
      .map((s) => ({
        name: s.name,
        description: s.description || "",
        source: "registry" as const,
        sourceId: source.id,
        url: s.repository?.url,
        githubRepo: s.repository?.url,
        installCmd: s.packages?.[0]
          ? s.packages[0].registryType === "npm"
            ? `npx -y ${s.packages[0].identifier}`
            : s.packages[0].identifier
          : undefined,
        npmPackage: s.packages?.find((p) => p.registryType === "npm")?.identifier,
      }));
  } catch {
    return [];
  }
}

async function searchAwesomeList(source: McpSource, query: string): Promise<FinderResult[]> {
  try {
    const res = await fetch(source.url);
    if (!res.ok) return [];
    const text = await res.text();
    const results: FinderResult[] = [];
    const linkPattern = /\[([^\]]+)\]\((https?:\/\/[^)]+)\)(?:\s*[-–]\s*([^\n]+))?/g;
    const q = query.toLowerCase();
    let match;
    while ((match = linkPattern.exec(text)) !== null) {
      const name = match[1].trim();
      const url = match[2].trim();
      const description = match[3]?.trim() || "";
      if (
        (url.includes("github.com") || url.includes("npmjs.com")) &&
        name.length > 2
      ) {
        if (q === "" || `${name} ${description}`.toLowerCase().includes(q)) {
          results.push({
            name,
            description,
            source: "awesome" as const,
            sourceId: source.id,
            url,
            githubRepo: url.includes("github.com") ? url : undefined,
            installCmd: url.includes("npmjs.com")
              ? `npx -y ${url.split("/").pop()}`
              : undefined,
          });
        }
      }
    }
    return results;
  } catch {
    return [];
  }
}

interface NpmSearchResult {
  objects: Array<{
    package: {
      name: string;
      description?: string;
      links?: { npm?: string; repository?: string };
      keywords?: string[];
      version?: string;
    };
  }>;
}

function scoreNpmPackage(pkg: { name: string; description?: string; keywords?: string[] }): number {
  const name = pkg.name.toLowerCase();
  const keywords = (pkg.keywords || []).map((k) => k.toLowerCase());
  let score = 0;
  if (name.includes("mcp-server")) score += 3;
  else if (name.startsWith("mcp-") || name.endsWith("-mcp")) score += 2;
  else if (name.includes("mcp")) score += 1;
  if (keywords.includes("mcp")) score += 1;
  if (keywords.includes("mcp-server")) score += 2;
  if (keywords.some((k) => k.includes("modelcontextprotocol"))) score += 2;
  return score;
}

async function searchNpm(source: McpSource, query: string): Promise<FinderResult[]> {
  try {
    const url = new URL(source.url);
    url.searchParams.set("text", `mcp-server ${query}`);
    url.searchParams.set("size", "50");

    const res = await fetch(url.toString());
    if (!res.ok) return [];

    const data = (await res.json()) as NpmSearchResult;
    const q = query.toLowerCase();

    const scored = (data.objects || [])
      .map((o) => ({ pkg: o.package, score: scoreNpmPackage(o.package) }))
      .filter(({ pkg, score }) => {
        if (score < 1) return false;
        const text = `${pkg.name} ${pkg.description || ""} ${(pkg.keywords || []).join(" ")}`.toLowerCase();
        return q === "" || text.includes(q);
      });
    scored.sort((a, b) => b.score - a.score);

    return scored.map(({ pkg }) => ({
      name: pkg.name,
      description: pkg.description || "",
      source: "npm" as const,
      sourceId: source.id,
      url: pkg.links?.repository || pkg.links?.npm,
      npmPackage: pkg.name,
      installCmd: `npx -y ${pkg.name}`,
    }));
  } catch {
    return [];
  }
}

interface GitHubRepo {
  full_name: string;
  description: string | null;
  html_url: string;
  stargazers_count: number;
  topics: string[];
}

async function searchGitHubTopic(source: McpSource, query: string): Promise<FinderResult[]> {
  const token = process.env.GITHUB_TOKEN;
  try {
    const url = new URL(source.url);
    const q = query ? `${query} topic:mcp-server` : "topic:mcp-server";
    url.searchParams.set("q", q);
    url.searchParams.set("sort", "stars");
    url.searchParams.set("per_page", "30");

    const headers: Record<string, string> = {
      Accept: "application/vnd.github.v3+json",
    };
    if (token) headers["Authorization"] = `Bearer ${token}`;

    const res = await fetch(url.toString(), { headers });
    if (!res.ok) return [];

    const data = (await res.json()) as { items?: GitHubRepo[] };
    return (data.items || []).map((repo) => ({
      name: repo.full_name,
      description: repo.description || "",
      source: "github" as const,
      sourceId: source.id,
      url: repo.html_url,
      githubRepo: repo.html_url,
      stars: repo.stargazers_count,
    }));
  } catch {
    return [];
  }
}

async function fetchSource(source: McpSource): Promise<FinderResult[]> {
  switch (source.type) {
    case "mcp-registry":
      return searchMcpRegistry(source, "");
    case "awesome-list":
      return searchAwesomeList(source, "");
    case "npm-search":
      return searchNpm(source, "");
    case "github-topic":
      return searchGitHubTopic(source, "");
    default:
      return [];
  }
}

function filterResults(results: FinderResult[], query: string): FinderResult[] {
  if (!query) return results;
  const q = query.toLowerCase();
  return results.filter((r) => {
    const text = `${r.name} ${r.description || ""}`.toLowerCase();
    return text.includes(q);
  });
}

export async function searchSource(source: McpSource, query: string, noCache = false): Promise<FinderResult[]> {
  if (!noCache) {
    const cached = readCache(source.id);
    if (cached && Date.now() - cached.cachedAt < DEFAULT_TTL_MS) {
      return filterResults(cached.results, query);
    }
  }
  const results = await fetchSource(source);
  writeCache(source.id, results);
  return filterResults(results, query);
}

// --- Main findServers ---

export interface FindOptions {
  /** Source IDs to use (default: all enabled) */
  sources?: string[];
  /** Max results per source. Default: 20 */
  limit?: number;
  /** Bypass source cache and fetch fresh results */
  noCache?: boolean;
}

function deduplicate(results: FinderResult[]): FinderResult[] {
  const seen = new Set<string>();
  return results.filter((r) => {
    const key = r.npmPackage || r.githubRepo || r.name.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export async function findServers(
  query: string,
  opts: FindOptions = {}
): Promise<FinderResult[]> {
  let sources = listSources().filter((s) => s.enabled);
  if (opts.sources && opts.sources.length > 0) {
    sources = sources.filter((s) => opts.sources!.includes(s.id));
  }
  const limit = opts.limit ?? 20;

  const all = await Promise.all(sources.map((s) => searchSource(s, query, opts.noCache)));
  const flat = all.flat();
  const deduped = deduplicate(flat);

  // Sort: registry first, then awesome, npm, github; then by stars descending
  const typeOrder: Record<string, number> = {
    "mcp-registry": 0,
    "awesome-list": 1,
    "npm-search": 2,
    "github-topic": 3,
  };
  // Map sourceId to type for sorting
  const sourceTypeMap = new Map(sources.map((s) => [s.id, s.type]));
  deduped.sort((a, b) => {
    const aType = a.sourceId ? (sourceTypeMap.get(a.sourceId) ?? "") : a.source;
    const bType = b.sourceId ? (sourceTypeMap.get(b.sourceId) ?? "") : b.source;
    const ao = typeOrder[aType] ?? 99;
    const bo = typeOrder[bType] ?? 99;
    if (ao !== bo) return ao - bo;
    return (b.stars ?? 0) - (a.stars ?? 0);
  });

  return deduped.slice(0, limit * Math.max(sources.length, 1));
}
