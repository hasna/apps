import { resolveClientConfig, type ClientEnv } from "./config.js";
import { CORE_ROUTES, type CoreOperation } from "./routes.js";

export { CORE_ROUTES, type CoreOperation } from "./routes.js";
export { httpsBaseUrl } from "./config.js";

/** Snapshot authority and credential together; neither appears in diagnostics. */
export class AccessClient {
  #baseUrl: string;
  #apiKey: string;
  #fetch: typeof fetch;

  constructor(env: ClientEnv = process.env, fetcher: typeof fetch = fetch) {
    const { baseUrl, apiKey } = resolveClientConfig(env);
    this.#baseUrl = baseUrl;
    this.#apiKey = apiKey;
    this.#fetch = fetcher;
  }

  toJSON(): { transport: string } { return { transport: "https" }; }

  async runOperation(operation: CoreOperation, input: Readonly<Record<string, unknown>> = {}): Promise<unknown> {
    if (!Object.hasOwn(CORE_ROUTES, operation)) throw new Error("Unknown Access operation.");
    const [method, template] = CORE_ROUTES[operation];
    const data = { ...input };
    let path: string = template;
    if (template.includes(":id")) {
      if (typeof data.id !== "string" || !/^[a-zA-Z0-9_-]+$/.test(data.id)) throw new Error("Access operation requires a safe id.");
      path = template.replace(":id", encodeURIComponent(data.id));
      delete data.id;
    }
    const url = new URL(`${this.#baseUrl}${path}`);
    let body: string | undefined;
    if (method === "GET" || method === "DELETE") {
      for (const [key, value] of Object.entries(data)) {
        if (value !== undefined) url.searchParams.set(key, Array.isArray(value) ? value.join(",") : String(value));
      }
    } else body = JSON.stringify(data);
    let response: Response;
    try {
      response = await this.#fetch(url, {
        method,
        headers: { Authorization: `Bearer ${this.#apiKey}`, "Content-Type": "application/json" },
        body,
        redirect: "error",
        signal: AbortSignal.timeout(30_000),
      });
    } catch {
      throw new Error("Access HTTPS request failed; no local fallback was attempted.");
    }
    if (!response.ok) throw new Error(`Access HTTPS request failed (HTTP ${response.status}).`);
    try { return await response.json(); } catch { throw new Error("Access API returned invalid JSON."); }
  }
}

export async function runOperation(operation: CoreOperation, input: Readonly<Record<string, unknown>> = {}): Promise<unknown> {
  return new AccessClient().runOperation(operation, input);
}
