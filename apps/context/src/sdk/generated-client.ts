// DO NOT EDIT — generated from the context-serve OpenAPI document.
// Regenerate with: bun run openapi:generate
// Source of truth: src/server/openapi.ts (route table) -> buildOpenApiDocument().

/** Typed HTTP client for the context-serve API (generated). */
export class ContextClient {
  private readonly baseUrl: string;
  private readonly token?: string;

  constructor(options: { baseUrl?: string; token?: string } = {}) {
    this.baseUrl = (options.baseUrl ?? "http://127.0.0.1:8080").replace(/\/$/, "");
    this.token = options.token;
  }

  private async request(method: string, path: string, query?: Record<string, unknown>, body?: unknown): Promise<unknown> {
    const url = new URL(this.baseUrl + path);
    if (query) {
      for (const [key, value] of Object.entries(query)) {
        if (value !== undefined && value !== null && value !== "") url.searchParams.set(key, String(value));
      }
    }
    const headers: Record<string, string> = { "content-type": "application/json" };
    if (this.token) headers.authorization = `Bearer ${this.token}`;
    const res = await fetch(url, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await res.text();
    if (!res.ok) {
      let message = `HTTP ${res.status} ${method} ${path}`;
      try {
        const parsed = JSON.parse(text) as { error?: string };
        if (parsed.error) message += `: ${parsed.error}`;
      } catch {
        if (text) message += `: ${text}`;
      }
      throw new Error(message);
    }
    return text ? (JSON.parse(text) as unknown) : undefined;
  }

  /** Liveness probe */
  async getHealth(params?: Record<string, string | number | boolean | undefined>): Promise<unknown> {
    return this.request("GET", "/health", params);
  }

  /** Readiness probe */
  async getReady(params?: Record<string, string | number | boolean | undefined>): Promise<unknown> {
    return this.request("GET", "/ready", params);
  }

  /** Version + build info */
  async getVersion(params?: Record<string, string | number | boolean | undefined>): Promise<unknown> {
    return this.request("GET", "/version", params);
  }

  /** Legacy liveness surface */
  async getApiHealth(params?: Record<string, string | number | boolean | undefined>): Promise<unknown> {
    return this.request("GET", "/api/health", params);
  }

  /** List libraries (optional q full-text search) */
  async listLibraries(params?: Record<string, string | number | boolean | undefined>): Promise<unknown> {
    return this.request("GET", "/api/libraries", params);
  }

  /** Register a library */
  async createLibrary(body?: unknown): Promise<unknown> {
    return this.request("POST", "/api/libraries", undefined, body);
  }

  /** Get a library by slug */
  async getLibrary(slug: string | number, params?: Record<string, string | number | boolean | undefined>): Promise<unknown> {
    return this.request("GET", `/api/libraries/${encodeURIComponent(String(slug))}`, params);
  }

  /** Delete a library */
  async deleteLibrary(slug: string | number): Promise<unknown> {
    return this.request("DELETE", `/api/libraries/${encodeURIComponent(String(slug))}`);
  }

  /** Re-crawl a library */
  async refreshLibrary(slug: string | number, body?: unknown): Promise<unknown> {
    return this.request("POST", `/api/libraries/${encodeURIComponent(String(slug))}/refresh`, undefined, body);
  }

  /** Compatibility alias for refresh */
  async crawlLibrary(slug: string | number, body?: unknown): Promise<unknown> {
    return this.request("POST", `/api/libraries/${encodeURIComponent(String(slug))}/crawl`, undefined, body);
  }

  /** Get library documentation tree */
  async getLibraryDocs(slug: string | number, params?: Record<string, string | number | boolean | undefined>): Promise<unknown> {
    return this.request("GET", `/api/libraries/${encodeURIComponent(String(slug))}/docs`, params);
  }

  /** Get library embedding status */
  async getLibraryEmbeddings(slug: string | number, params?: Record<string, string | number | boolean | undefined>): Promise<unknown> {
    return this.request("GET", `/api/libraries/${encodeURIComponent(String(slug))}/embeddings`, params);
  }

  /** Embed a library */
  async embedLibrary(slug: string | number, body?: unknown): Promise<unknown> {
    return this.request("POST", `/api/libraries/${encodeURIComponent(String(slug))}/embed`, undefined, body);
  }

  /** Full-text or semantic search over chunks */
  async search(params?: Record<string, string | number | boolean | undefined>): Promise<unknown> {
    return this.request("GET", "/api/search", params);
  }

  /** Store counts (libraries/documents/chunks) */
  async getStats(params?: Record<string, string | number | boolean | undefined>): Promise<unknown> {
    return this.request("GET", "/api/stats", params);
  }

  /** Query indexed API endpoints */
  async listEndpoints(params?: Record<string, string | number | boolean | undefined>): Promise<unknown> {
    return this.request("GET", "/api/endpoints", params);
  }

  /** AI provider backends status */
  async getAiStatus(params?: Record<string, string | number | boolean | undefined>): Promise<unknown> {
    return this.request("GET", "/api/ai/status", params);
  }

  /** AI generation */
  async aiGenerate(body?: unknown): Promise<unknown> {
    return this.request("POST", "/api/ai/generate", undefined, body);
  }

  /** Ask the docs AI */
  async aiAsk(body?: unknown): Promise<unknown> {
    return this.request("POST", "/api/ai/ask", undefined, body);
  }

  /** Plan updates for a library */
  async getUpdatePlan(params?: Record<string, string | number | boolean | undefined>): Promise<unknown> {
    return this.request("GET", "/api/updates/plan", params);
  }

  /** Create an update plan */
  async postUpdatePlan(body?: unknown): Promise<unknown> {
    return this.request("POST", "/api/updates/plan", undefined, body);
  }

  /** Dry-run a live refresh cycle */
  async getLiveCycle(params?: Record<string, string | number | boolean | undefined>): Promise<unknown> {
    return this.request("GET", "/api/live/cycle", params);
  }

  /** Run a live refresh cycle */
  async postLiveCycle(body?: unknown): Promise<unknown> {
    return this.request("POST", "/api/live/cycle", undefined, body);
  }

  /** Build a documentation context payload */
  async buildDocsContext(body?: unknown): Promise<unknown> {
    return this.request("POST", "/api/context/build", undefined, body);
  }

  /** Publish readiness report */
  async getPublishReadiness(params?: Record<string, string | number | boolean | undefined>): Promise<unknown> {
    return this.request("GET", "/api/publish/readiness", params);
  }

  /** Run the readiness verifier (read-only) */
  async verifyReadiness(params?: Record<string, string | number | boolean | undefined>): Promise<unknown> {
    return this.request("GET", "/api/verify/readiness", params);
  }

  /** Run the readiness verifier with options */
  async verifyReadinessPost(body?: unknown): Promise<unknown> {
    return this.request("POST", "/api/verify/readiness", undefined, body);
  }

  /** Alias for GET /api/verify/readiness */
  async verifyReadinessShort(params?: Record<string, string | number | boolean | undefined>): Promise<unknown> {
    return this.request("GET", "/api/verify", params);
  }

  /** Alias for POST /api/verify/readiness */
  async verifyReadinessShortPost(body?: unknown): Promise<unknown> {
    return this.request("POST", "/api/verify", undefined, body);
  }

  /** Documentation-source readiness report */
  async getSourceReadiness(params?: Record<string, string | number | boolean | undefined>): Promise<unknown> {
    return this.request("GET", "/api/sources/readiness", params);
  }

  /** List documentation sources */
  async listSources(params?: Record<string, string | number | boolean | undefined>): Promise<unknown> {
    return this.request("GET", "/api/sources", params);
  }

  /** Select seed libraries */
  async listSeeds(params?: Record<string, string | number | boolean | undefined>): Promise<unknown> {
    return this.request("GET", "/api/seeds", params);
  }

  /** Bootstrap seed sources */
  async bootstrapSeeds(body?: unknown): Promise<unknown> {
    return this.request("POST", "/api/seeds", undefined, body);
  }

  /** List webhook endpoints */
  async listWebhooks(params?: Record<string, string | number | boolean | undefined>): Promise<unknown> {
    return this.request("GET", "/api/webhooks", params);
  }

  /** Register a webhook endpoint */
  async createWebhook(body?: unknown): Promise<unknown> {
    return this.request("POST", "/api/webhooks", undefined, body);
  }

  /** Remove a webhook endpoint */
  async deleteWebhook(id: string | number): Promise<unknown> {
    return this.request("DELETE", `/api/webhooks/${encodeURIComponent(String(id))}`);
  }

  /** List webhook deliveries */
  async listWebhookDeliveries(params?: Record<string, string | number | boolean | undefined>): Promise<unknown> {
    return this.request("GET", "/api/webhooks/deliveries", params);
  }

  /** Emit a test webhook event */
  async testWebhook(body?: unknown): Promise<unknown> {
    return this.request("POST", "/api/webhooks/test", undefined, body);
  }

  /** MCP JSON-RPC over HTTP */
  async mcpJsonRpc(body?: unknown): Promise<unknown> {
    return this.request("POST", "/mcp", undefined, body);
  }

}