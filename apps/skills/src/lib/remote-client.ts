import { getApiKey as getStoredApiKey, getApiUrl } from "./auth-store.js";
import { normalizeRemoteSkillRunContract, type RemoteSkillRunContract } from "./remote-run-contract.js";

/**
 * A server that predates this client's pin/tag/incremental-sync routes answered
 * 404/405 for them. The caller must never mistake that for "no pins" or "empty
 * listing" — a silently-empty sync would look like success and drop nothing on
 * the next push. This error is how the version-skew surfaces fail-closed.
 */
export class RemoteRouteUnsupportedError extends Error {
  constructor(
    readonly path: string,
    readonly status: number,
    readonly instance: string,
  ) {
    super(
      `The configured Skills instance does not support ${path} (HTTP ${status}). ` +
        `The instance at ${instance} predates this client feature — upgrade the server, or ` +
        `use a client version that matches it.`,
    );
    this.name = "RemoteRouteUnsupportedError";
  }
}

/** Any other non-ok response on the new-route methods, with the status attached. */
export class RemoteRequestError extends Error {
  constructor(
    readonly path: string,
    readonly status: number,
    statusText: string,
  ) {
    super(`Remote request to ${path} failed: HTTP ${status}${statusText ? ` ${statusText}` : ""}`);
    this.name = "RemoteRequestError";
  }
}

/** A remote pin on a skill. `version`/`pinnedAt` are server-reported and may be absent. */
export interface RemotePin {
  slug: string;
  version?: string;
  pinnedAt?: string;
}

/** The minimal per-skill row the pin/tag/updated-since routes serve. */
export interface RemoteSkillSummary {
  slug: string;
  name?: string;
  version?: string;
  updatedAt?: string;
}

/**
 * One page of an incremental listing. `nextCursor` is an opaque continuation
 * token; null (or an absent field) means the listing is complete.
 */
export interface UpdatedSincePage {
  skills: RemoteSkillSummary[];
  nextCursor: string | null;
}

export class RemoteSkillsClient {
  private apiUrl: string;
  private apiKey: string;

  constructor(apiKey: string, apiUrl = getApiUrl()) {
    this.apiKey = apiKey;
    this.apiUrl = apiUrl.replace(/\/$/, "");
  }

  private async request(path: string, options?: RequestInit): Promise<Response> {
    return fetch(`${this.apiUrl}${path}`, {
      ...options,
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        "Content-Type": "application/json",
        ...options?.headers,
      },
    });
  }

  /**
   * Fail-closed version-skew guard for the pin/tag/updated-since routes.
   *
   * A server that predates these routes answers 404 (unmatched path) or 405
   * (unmatched method). Both are surfaced as `RemoteRouteUnsupportedError` —
   * never as an empty listing, which would read as "no pins / no changes" and
   * silently desynchronize the caller. Every other non-ok response becomes a
   * `RemoteRequestError` carrying the status.
   */
  private async requestNewRoute(path: string, options?: RequestInit): Promise<Response> {
    const response = await this.request(path, options);
    // Route identity for the error excludes the query string — the query is
    // caller data (cursor/since), not the route that is missing.
    const routePath = path.split("?")[0];
    if (response.status === 404 || response.status === 405) {
      throw new RemoteRouteUnsupportedError(routePath, response.status, this.apiUrl);
    }
    if (!response.ok) {
      throw new RemoteRequestError(routePath, response.status, response.statusText);
    }
    return response;
  }

  async listSkills(): Promise<any[]> {
    const res = await this.request("/api/v1/skills");
    return res.json();
  }

  async getSkillMd(slug: string): Promise<string | null> {
    const res = await this.request(`/api/v1/skills/${slug}/skill.md`);
    if (!res.ok) return null;
    return res.text();
  }

  async getSkill(slug: string): Promise<any | null> {
    const res = await this.request(`/api/v1/skills/${slug}`);
    if (!res.ok) return null;
    return res.json();
  }

  async submitRun(slug: string, input?: Record<string, unknown>, args?: string[]): Promise<RemoteSkillRunContract> {
    const res = await this.request(`/api/v1/runs/${slug}`, {
      method: "POST",
      body: JSON.stringify({ input, args }),
    });
    return normalizeRemoteSkillRunContract(await res.json(), slug);
  }

  async getRun(runId: string): Promise<RemoteSkillRunContract | null> {
    const res = await this.request(`/api/v1/runs/${runId}`);
    if (!res.ok) return null;
    return normalizeRemoteSkillRunContract(await res.json());
  }

  async getRunLogs(runId: string): Promise<any[]> {
    const res = await this.request(`/api/v1/runs/${runId}/logs`);
    if (!res.ok) return [];
    const payload = await res.json();
    return Array.isArray(payload) ? payload : [];
  }

  async listRuns(limit = 20): Promise<any[]> {
    const res = await this.request(`/api/v1/runs?limit=${limit}`);
    return res.json();
  }

  async getRunArtifacts(runId: string): Promise<any[]> {
    const res = await this.request(`/api/v1/runs/${runId}/artifacts`);
    return res.json();
  }

  async downloadRunArtifact(runId: string, artifactId: string): Promise<Response> {
    return this.request(`/api/v1/runs/${runId}/artifacts/${artifactId}/download`, {
      method: "GET",
    });
  }

  /**
   * Publish a skill to the configured instance.
   *
   * Sent as multipart rather than as JSON with a base64 field. A base64 body would inflate
   * the bundle by a third and would have to pass through the server's JSON reader, whose
   * 1 MB cap exists to keep JSON bodies sane; multipart keeps the tarball on its own path
   * with its own, larger limit.
   *
   * Note the deliberate absence of `request()`: that helper pins
   * `Content-Type: application/json`, and a multipart body whose Content-Type does not
   * carry the generated boundary is unparseable at the other end.
   */
  async publishSkill(manifest: Record<string, unknown>, bundle?: Uint8Array): Promise<Response> {
    const form = new FormData();
    form.set("manifest", JSON.stringify(manifest));
    if (bundle) {
      form.set("bundle", new Blob([bundle as BlobPart], { type: "application/gzip" }), `${String(manifest.slug ?? "skill")}.tar.gz`);
    }
    return fetch(`${this.apiUrl}/api/v1/skills`, {
      method: "POST",
      headers: { Authorization: `Bearer ${this.apiKey}` },
      body: form,
    });
  }

  async deleteSkill(slug: string): Promise<Response> {
    return this.request(`/api/v1/skills/${encodeURIComponent(slug)}`, { method: "DELETE" });
  }

  async downloadSkillBundle(slug: string): Promise<Response> {
    return this.request(`/api/v1/skills/${encodeURIComponent(slug)}/bundle`, { method: "GET" });
  }

  /**
   * Bundle fetch for the verified-pull path. Returns the raw Response so the caller can
   * read the X-Skill-Bundle-Sha256 / X-Skill-Bundle-Signature headers, or null when the
   * instance serves no bundle for this skill (the metadata-only fallback path).
   */
  async getBundle(slug: string): Promise<Response | null> {
    const response = await this.request(`/api/v1/skills/${encodeURIComponent(slug)}/bundle`, { method: "GET" });
    if (response.status === 404) return null;
    return response;
  }

  /** List the pins the instance holds for this principal. */
  async listPins(): Promise<RemotePin[]> {
    const response = await this.requestNewRoute("/api/v1/pins");
    return normalizePinList(await response.json());
  }

  /** Pin a skill on the instance (idempotent — pinning again refreshes it). */
  async pin(slug: string): Promise<RemotePin> {
    const path = `/api/v1/pins/${encodeURIComponent(slug)}`;
    const response = await this.requestNewRoute(path, { method: "PUT" });
    return normalizePin(await response.json());
  }

  /** Unpin a skill on the instance. */
  async unpin(slug: string): Promise<void> {
    const path = `/api/v1/pins/${encodeURIComponent(slug)}`;
    await this.requestNewRoute(path, { method: "DELETE" });
  }

  /** List the tag names the instance serves. */
  async listTags(): Promise<string[]> {
    const response = await this.requestNewRoute("/api/v1/tags");
    const payload: unknown = await response.json();
    if (!Array.isArray(payload)) {
      throw new Error("Remote tags payload did not match the expected contract (expected an array of tag names)");
    }
    return payload.filter((tag): tag is string => typeof tag === "string" && tag.trim().length > 0);
  }

  /** List the skills carrying a tag on the instance. */
  async skillsByTag(tag: string): Promise<RemoteSkillSummary[]> {
    const path = `/api/v1/tags/${encodeURIComponent(tag)}/skills`;
    const response = await this.requestNewRoute(path);
    return normalizeSkillSummaryList(await response.json());
  }

  /**
   * Cursor-based incremental listing of skills updated after `since` (ISO 8601).
   * Each page carries an opaque `nextCursor`; null means the listing is complete.
   * This is the feed T9's sync reconciliation verb consumes.
   */
  async listUpdatedSince(since: string, options: { cursor?: string; limit?: number } = {}): Promise<UpdatedSincePage> {
    const params = new URLSearchParams({ since });
    if (options.cursor) params.set("cursor", options.cursor);
    if (options.limit !== undefined) params.set("limit", String(options.limit));
    const response = await this.requestNewRoute(`/api/v1/skills/updated?${params.toString()}`);
    return normalizeUpdatedSincePage(await response.json());
  }
}

function normalizePin(entry: unknown): RemotePin {
  if (!entry || typeof entry !== "object") {
    throw new Error("Remote pin payload did not match the expected contract (expected an object)");
  }
  const record = entry as Record<string, unknown>;
  const slug = typeof record.slug === "string" && record.slug.trim() ? record.slug.trim() : undefined;
  if (!slug) {
    throw new Error("Remote pin payload did not match the expected contract (missing slug)");
  }
  return {
    slug,
    ...(typeof record.version === "string" ? { version: record.version } : {}),
    ...(typeof record.pinnedAt === "string" ? { pinnedAt: record.pinnedAt } : {}),
  };
}

function normalizePinList(payload: unknown): RemotePin[] {
  if (!Array.isArray(payload)) {
    throw new Error("Remote pins payload did not match the expected contract (expected an array of pins)");
  }
  return payload.map(normalizePin);
}

function normalizeSkillSummary(entry: unknown): RemoteSkillSummary {
  if (!entry || typeof entry !== "object") {
    throw new Error("Remote skill payload did not match the expected contract (expected an object)");
  }
  const record = entry as Record<string, unknown>;
  const slug = typeof record.slug === "string" && record.slug.trim() ? record.slug.trim() : undefined;
  if (!slug) {
    throw new Error("Remote skill payload did not match the expected contract (missing slug)");
  }
  return {
    slug,
    ...(typeof record.name === "string" ? { name: record.name } : {}),
    ...(typeof record.version === "string" ? { version: record.version } : {}),
    ...(typeof record.updatedAt === "string" ? { updatedAt: record.updatedAt } : {}),
  };
}

function normalizeSkillSummaryList(payload: unknown): RemoteSkillSummary[] {
  if (!Array.isArray(payload)) {
    throw new Error("Remote skills payload did not match the expected contract (expected an array of skills)");
  }
  return payload.map(normalizeSkillSummary);
}

function normalizeUpdatedSincePage(payload: unknown): UpdatedSincePage {
  if (!payload || typeof payload !== "object") {
    throw new Error("Updated-since payload did not match the expected contract (expected an object)");
  }
  const record = payload as Record<string, unknown>;
  if (!Array.isArray(record.skills)) {
    throw new Error("Updated-since payload did not match the expected contract (missing skills array)");
  }
  const skills = record.skills.map(normalizeSkillSummary);
  const nextCursor = record.nextCursor === undefined || record.nextCursor === null ? null : record.nextCursor;
  if (nextCursor !== null && typeof nextCursor !== "string") {
    throw new Error("Updated-since payload did not match the expected contract (nextCursor must be a string or absent)");
  }
  return { skills, nextCursor };
}

export function createRemoteSkillsClient(): RemoteSkillsClient | null {
  const apiKey = getStoredApiKey();
  if (!apiKey) return null;
  return new RemoteSkillsClient(apiKey);
}
