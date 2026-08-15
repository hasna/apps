import {
  LOCAL_PROVIDER_NAMES,
  PROVIDER_NAMES,
  type SearchProviderName,
  type SearchRouting,
} from "../types/index.js";

const PROVIDER_DESCRIPTIONS: Record<SearchProviderName, string> = {
  files: "Local file names and paths. Best for known filenames, path fragments, extensions, and repo navigation.",
  content: "Local indexed file contents. Best for code symbols, exact phrases, docs, snippets, and grep-style discovery.",
  google: "General web search through SerpAPI. Best for broad web coverage and current public pages.",
  serpapi: "SerpAPI multi-engine web search. Best for general web queries when Google-style results are desired.",
  exa: "Neural/semantic web search. Best for research, conceptual queries, docs, and high-relevance pages.",
  perplexity: "Answer-oriented web research with citations. Best for synthesized factual questions and research summaries.",
  brave: "General independent web search. Best for current web, news-like, product, and navigational queries.",
  bing: "General web search. Best for current web and Microsoft/Bing-indexed pages.",
  twitter: "X/Twitter search. Best for tweets, social reactions, breaking discourse, and people posting updates.",
  reddit: "Reddit search. Best for opinions, product experiences, troubleshooting threads, and community recommendations.",
  youtube: "YouTube search. Best for videos, tutorials, talks, demos, and channels.",
  hackernews: "Hacker News search. Best for startup, programming, launch, and technical discussion threads.",
  github: "GitHub code and repository search. Best for open-source repos, code examples, packages, and implementation details.",
  arxiv: "arXiv academic search. Best for papers, preprints, ML/AI/math/physics research, and scholarly topics.",
};

interface RouteOptions {
  maxProviders?: number;
  timeoutMs?: number;
  model?: string;
}

interface CerebrasChatResponse {
  choices?: Array<{
    message?: {
      content?: string | null;
    };
  }>;
}

interface RouterModelOutput {
  selectedProviders?: unknown;
  reason?: unknown;
  confidence?: unknown;
}

interface CachedRouting {
  expiresAt: number;
  route: SearchRouting;
}

const ROUTER_CACHE_TTL_MS = 10 * 60_000;
const routerCache = new Map<string, CachedRouting>();

export function clearRouterCache(): void {
  routerCache.clear();
}

function clampMaxProviders(value: number | undefined): number {
  if (value === undefined || !Number.isFinite(value)) return 3;
  return Math.max(1, Math.min(5, Math.floor(value)));
}

function clampConfidence(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.max(0, Math.min(1, value))
    : 0.5;
}

function normalizeCandidates(candidates: SearchProviderName[]): SearchProviderName[] {
  const allowed = new Set<SearchProviderName>(PROVIDER_NAMES);
  const seen = new Set<SearchProviderName>();
  const normalized: SearchProviderName[] = [];
  for (const candidate of candidates) {
    if (!allowed.has(candidate) || seen.has(candidate)) continue;
    seen.add(candidate);
    normalized.push(candidate);
  }
  return normalized;
}

function cacheKey(
  query: string,
  candidates: SearchProviderName[],
  maxProviders: number,
  model: string,
): string {
  return JSON.stringify({
    query: query.trim().toLowerCase().replace(/\s+/g, " "),
    candidates,
    maxProviders,
    model,
  });
}

function cloneRoute(route: SearchRouting, cached = false): SearchRouting {
  return {
    ...route,
    selectedProviders: [...route.selectedProviders],
    candidates: [...route.candidates],
    ...(cached && { cached: true }),
  };
}

function localFastPath(route: SearchRouting): SearchRouting | null {
  if (route.selectedProviders.length === 0) return null;
  if (!LOCAL_PROVIDER_NAMES.has(route.selectedProviders[0]!)) return null;
  if (route.confidence < 0.8) return null;
  if (!/(local-file|code\/content)/.test(route.reason)) return null;

  const localProviders = route.selectedProviders.filter((provider) => LOCAL_PROVIDER_NAMES.has(provider));
  if (localProviders.length === 0) return null;
  return {
    ...route,
    selectedProviders: localProviders,
    reason: `${route.reason}; local fast-path skipped LLM routing`,
  };
}

function addScore(
  scores: Map<SearchProviderName, number>,
  candidateSet: Set<SearchProviderName>,
  provider: SearchProviderName,
  amount: number,
): void {
  if (!candidateSet.has(provider)) return;
  scores.set(provider, (scores.get(provider) ?? 0) + amount);
}

function hasAny(query: string, patterns: RegExp[]): boolean {
  return patterns.some((pattern) => pattern.test(query));
}

export function routeSearchProvidersHeuristic(
  query: string,
  candidates: SearchProviderName[],
  options: Pick<RouteOptions, "maxProviders"> = {},
): SearchRouting {
  const normalized = normalizeCandidates(candidates);
  const maxProviders = clampMaxProviders(options.maxProviders);
  if (normalized.length === 0) {
    return {
      strategy: "heuristic",
      selectedProviders: [],
      candidates: [],
      reason: "No configured providers were available to route.",
      confidence: 0,
    };
  }

  const candidateSet = new Set(normalized);
  const scores = new Map<SearchProviderName, number>();
  const reasons: string[] = [];
  const q = query.trim().toLowerCase();

  for (const candidate of normalized) scores.set(candidate, 0.05);

  if (
    hasAny(q, [
      /\b(file|filename|path|folder|directory|repo|workspace)\b/,
      /(^|[/\s])[\w.-]+\.(ts|tsx|js|jsx|py|rs|go|md|json|yaml|yml|css|html)\b/,
    ])
  ) {
    addScore(scores, candidateSet, "files", 5);
    addScore(scores, candidateSet, "content", 3);
    reasons.push("query looks local-file oriented");
  }

  if (
    hasAny(q, [
      /\b(function|class|interface|type|const|import|export|error|stack|symbol|grep|regex)\b/,
      /[A-Za-z_$][\w$]*\([^)]*\)/,
      /[A-Za-z_$][\w$]*::[A-Za-z_$]/,
    ])
  ) {
    addScore(scores, candidateSet, "content", 5);
    addScore(scores, candidateSet, "files", 2);
    addScore(scores, candidateSet, "github", 1.5);
    reasons.push("query contains code/content lookup signals");
  }

  if (hasAny(q, [/\b(paper|papers|arxiv|preprint|doi|citation|survey|benchmark|research)\b/])) {
    addScore(scores, candidateSet, "arxiv", 5);
    addScore(scores, candidateSet, "exa", 3);
    addScore(scores, candidateSet, "perplexity", 2);
    reasons.push("query asks for scholarly or research material");
  }

  if (hasAny(q, [/\b(github|repo|repository|source code|open source|package|library|sdk|api example)\b/])) {
    addScore(scores, candidateSet, "github", 5);
    addScore(scores, candidateSet, "exa", 2);
    reasons.push("query asks for code or repository material");
  }

  if (hasAny(q, [/\b(video|youtube|tutorial|demo|talk|lecture|channel)\b/])) {
    addScore(scores, candidateSet, "youtube", 5);
    reasons.push("query asks for video material");
  }

  if (hasAny(q, [/\b(reddit|subreddit|opinion|experience|reviews?|worth it|recommendations?)\b/])) {
    addScore(scores, candidateSet, "reddit", 5);
    addScore(scores, candidateSet, "hackernews", 1.5);
    reasons.push("query asks for community discussion");
  }

  if (hasAny(q, [/\b(hacker news|hn|show hn|launch|startup)\b/])) {
    addScore(scores, candidateSet, "hackernews", 5);
    reasons.push("query asks for Hacker News style discussion");
  }

  if (hasAny(q, [/\b(twitter|tweet|tweets|x\.com|social reaction|trending)\b/])) {
    addScore(scores, candidateSet, "twitter", 5);
    reasons.push("query asks for social posts");
  }

  if (hasAny(q, [/\b(latest|today|yesterday|news|current|2025|2026|price|release|launched)\b/])) {
    addScore(scores, candidateSet, "brave", 3);
    addScore(scores, candidateSet, "bing", 2.5);
    addScore(scores, candidateSet, "google", 2.5);
    addScore(scores, candidateSet, "serpapi", 2);
    reasons.push("query appears time-sensitive");
  }

  if (reasons.length === 0) {
    addScore(scores, candidateSet, "exa", 2.5);
    addScore(scores, candidateSet, "perplexity", 2);
    addScore(scores, candidateSet, "brave", 1.5);
    addScore(scores, candidateSet, "google", 1.5);
    addScore(scores, candidateSet, "hackernews", 0.75);
    reasons.push("general query fallback");
  }

  const selectedProviders = [...scores.entries()]
    .sort((a, b) => b[1] - a[1] || normalized.indexOf(a[0]) - normalized.indexOf(b[0]))
    .slice(0, Math.min(maxProviders, normalized.length))
    .map(([provider]) => provider);

  const topScore = scores.get(selectedProviders[0]!) ?? 0;
  const confidence = Math.max(0.35, Math.min(0.9, topScore / 6));

  return {
    strategy: "heuristic",
    selectedProviders,
    candidates: normalized,
    reason: reasons.join("; "),
    confidence,
  };
}

function routerSchema(candidates: SearchProviderName[], maxProviders: number): Record<string, unknown> {
  return {
    type: "object",
    properties: {
      selectedProviders: {
        type: "array",
        items: { type: "string", enum: candidates },
        minItems: 1,
        maxItems: maxProviders,
      },
      reason: { type: "string" },
      confidence: { type: "number", minimum: 0, maximum: 1 },
    },
    required: ["selectedProviders", "reason", "confidence"],
    additionalProperties: false,
  };
}

function parseCerebrasRouting(
  raw: string,
  candidates: SearchProviderName[],
  maxProviders: number,
): Omit<SearchRouting, "strategy" | "candidates"> | null {
  let parsed: RouterModelOutput;
  try {
    parsed = JSON.parse(raw) as RouterModelOutput;
  } catch {
    return null;
  }

  if (!Array.isArray(parsed.selectedProviders)) return null;
  const candidateSet = new Set(candidates);
  const selectedProviders = parsed.selectedProviders
    .filter((provider): provider is SearchProviderName =>
      typeof provider === "string" && candidateSet.has(provider as SearchProviderName),
    )
    .slice(0, maxProviders);

  if (selectedProviders.length === 0) return null;

  return {
    selectedProviders,
    reason: typeof parsed.reason === "string" ? parsed.reason : "Cerebras router selected providers.",
    confidence: clampConfidence(parsed.confidence),
  };
}

async function routeWithCerebras(
  query: string,
  candidates: SearchProviderName[],
  options: Required<Pick<RouteOptions, "maxProviders" | "timeoutMs" | "model">>,
): Promise<SearchRouting> {
  const apiKey = Bun.env.CEREBRAS_API_KEY;
  if (!apiKey) {
    return {
      ...routeSearchProvidersHeuristic(query, candidates, options),
      error: "CEREBRAS_API_KEY is not configured; used heuristic routing.",
    };
  }

  const providerGuide = candidates.map((name) => ({
    name,
    description: PROVIDER_DESCRIPTIONS[name],
  }));

  const res = await fetch("https://api.cerebras.ai/v1/chat/completions", {
    method: "POST",
    signal: AbortSignal.timeout(options.timeoutMs),
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: options.model,
      temperature: 0,
      messages: [
        {
          role: "system",
          content:
            "You route a search query to the smallest useful set of available search providers. Select only listed providers. Prefer local providers for local files/code in the indexed workspace. Prefer scholarly, code, video, social, or web providers when the query clearly asks for those domains.",
        },
        {
          role: "user",
          content: JSON.stringify({
            query,
            maxProviders: options.maxProviders,
            providers: providerGuide,
          }),
        },
      ],
      response_format: {
        type: "json_schema",
        json_schema: {
          name: "search_router",
          strict: true,
          schema: routerSchema(candidates, options.maxProviders),
        },
      },
    }),
  });

  if (!res.ok) {
    throw new Error(`Cerebras router error: ${res.status} ${res.statusText}`);
  }

  const data = (await res.json()) as CerebrasChatResponse;
  const content = data.choices?.[0]?.message?.content;
  if (!content) throw new Error("Cerebras router returned no content");

  const parsed = parseCerebrasRouting(content, candidates, options.maxProviders);
  if (!parsed) throw new Error("Cerebras router returned invalid provider selection");

  return {
    strategy: "cerebras",
    candidates,
    ...parsed,
  };
}

export async function routeSearchProviders(
  query: string,
  candidates: SearchProviderName[],
  options: RouteOptions = {},
): Promise<SearchRouting> {
  const normalized = normalizeCandidates(candidates);
  const maxProviders = Math.min(clampMaxProviders(options.maxProviders), Math.max(1, normalized.length));
  const timeoutMs = options.timeoutMs && Number.isFinite(options.timeoutMs)
    ? Math.max(250, Math.floor(options.timeoutMs))
    : 1200;
  const model = options.model ?? Bun.env.CEREBRAS_MODEL ?? "gpt-oss-120b";

  if (normalized.length === 0) {
    return routeSearchProvidersHeuristic(query, normalized, { maxProviders });
  }

  const heuristic = routeSearchProvidersHeuristic(query, normalized, { maxProviders });
  const fastPath = localFastPath(heuristic);
  if (fastPath) return fastPath;

  const key = cacheKey(query, normalized, maxProviders, model);
  const cached = routerCache.get(key);
  if (cached && cached.expiresAt > Date.now()) return cloneRoute(cached.route, true);
  if (cached) routerCache.delete(key);

  try {
    const route = await routeWithCerebras(query, normalized, { maxProviders, timeoutMs, model });
    if (route.strategy === "cerebras" && !route.error) {
      routerCache.set(key, {
        expiresAt: Date.now() + ROUTER_CACHE_TTL_MS,
        route: cloneRoute(route),
      });
    }
    return route;
  } catch (err) {
    return {
      ...heuristic,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}
