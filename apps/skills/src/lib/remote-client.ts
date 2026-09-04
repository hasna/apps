import { getApiKey as getStoredApiKey, getApiKeyReadOnly, getApiUrl } from "./auth-store.js";
import { MissingApiUrlError, resolveApiUrl } from "./api-url.js";
import { loadConfigReadOnly } from "./config.js";
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

/**
 * A remote pin on a skill, matching the hosted-pins wire shape
 * (`{ slug, pinnedAt, metadata }`). `pinnedAt`/`metadata` are server-reported
 * and may be absent.
 */
export interface RemoteSkillVersion {
  slug: string;
  version: string;
  bundleSha256: string;
  bundleByteSize: number;
  storageKind?: string;
  manifest?: Record<string, unknown>;
  createdAt: string;
  current?: boolean;
}

export interface RemotePin {
  slug: string;
  pinnedAt?: string;
  metadata?: Record<string, unknown>;
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
   *
   * `domainNotFoundCodes` is the one deliberate exception: a route the server
   * DOES have can 404 for a domain reason (the hosted-pins DELETE answers
   * `{ code: "PIN_NOT_FOUND" }` when no pin exists). A 404 whose JSON body
   * carries one of those codes is returned to the caller (status intact) so it
   * can apply domain semantics instead of misreporting version skew. Every
   * other 404 — including the dispatcher's `{ code: "NOT_FOUND" }` on a route
   * the server lacks — still throws `RemoteRouteUnsupportedError`.
   */
  private async requestNewRoute(
    path: string,
    options?: RequestInit,
    opts: { domainNotFoundCodes?: string[] } = {},
  ): Promise<Response> {
    const response = await this.request(path, options);
    // Route identity for the error excludes the query string — the query is
    // caller data (cursor/since), not the route that is missing.
    const routePath = path.split("?")[0];
    if (response.status === 404 || response.status === 405) {
      if (
        response.status === 404 &&
        opts.domainNotFoundCodes?.length &&
        (await responseBodyCarriesCode(response, opts.domainNotFoundCodes))
      ) {
        return response;
      }
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

  /**
   * Raw GET for one skill, with the HTTP status surfaced. Used by the reconcile
   * re-check (registry-reconcile.ts) so it can distinguish "no such skill" (404) from
   * "the registry failed to answer" (any other non-success status) instead of treating
   * both as absent.
   */
  async getSkillStatus(slug: string): Promise<{ status: number; body: unknown }> {
    const res = await this.request(`/api/v1/skills/${encodeURIComponent(slug)}`, { method: "GET" });
    let body: unknown = null;
    try {
      body = await res.json();
    } catch {
      // A non-JSON body still leaves the status usable.
    }
    return { status: res.status, body };
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
   *
   * Optimistic concurrency (todos d061fcda): pass the revision id this client last read
   * for the slug (from getSkill().revisionId) as `ifMatch`. The instance refuses a
   * publish against a live slug that does not name its current revision with 409 — this
   * is how a push never silently overwrites a newer remote revision.
   */
  async publishSkill(manifest: Record<string, unknown>, bundle?: Uint8Array, ifMatch?: string): Promise<Response> {
    const form = new FormData();
    form.set("manifest", JSON.stringify(manifest));
    if (bundle) {
      form.set("bundle", new Blob([bundle as BlobPart], { type: "application/gzip" }), `${String(manifest.slug ?? "skill")}.tar.gz`);
    }
    const headers: Record<string, string> = { Authorization: `Bearer ${this.apiKey}` };
    if (ifMatch) headers["If-Match"] = ifMatch;
    return fetch(`${this.apiUrl}/api/v1/skills`, {
      method: "POST",
      headers,
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
  async getBundle(slug: string, version?: string): Promise<Response | null> {
    const path = version
      ? `/api/v1/skills/${encodeURIComponent(slug)}/versions/${encodeURIComponent(version)}/bundle`
      : `/api/v1/skills/${encodeURIComponent(slug)}/bundle`;
    const response = await this.request(path, { method: "GET" });
    if (response.status === 404) return null;
    return response;
  }

  /** List the pins the instance holds for this principal. */
  /** Every published version of a slug, newest first (hasna/apps#1630). */
  async listSkillVersions(slug: string): Promise<RemoteSkillVersion[]> {
    const response = await this.requestNewRoute(`/api/v1/skills/${encodeURIComponent(slug)}/versions`, undefined, { domainNotFoundCodes: ["SKILL_NOT_FOUND"] });
    if (response.status === 404) return [];
    if (!response.ok) throw new Error(`versions request failed: ${response.status}`);
    const body = (await response.json()) as { versions?: RemoteSkillVersion[] };
    return Array.isArray(body.versions) ? body.versions : [];
  }

  /** One version's manifest, or null when the slug@version was never published. */
  async getSkillVersion(slug: string, version: string): Promise<RemoteSkillVersion | null> {
    const response = await this.requestNewRoute(`/api/v1/skills/${encodeURIComponent(slug)}/versions/${encodeURIComponent(version)}`, undefined, { domainNotFoundCodes: ["SKILL_NOT_FOUND", "SKILL_VERSION_NOT_FOUND"] });
    if (response.status === 404) return null;
    if (!response.ok) throw new Error(`version request failed: ${response.status}`);
    return (await response.json()) as RemoteSkillVersion;
  }

  async listPins(): Promise<RemotePin[]> {
    const response = await this.requestNewRoute("/api/v1/pins");
    return normalizePinList(await response.json());
  }

  /**
   * Pin a skill on the instance (upsert — pinning again refreshes it). The
   * wire contract matches the hosted-pins routes: a PUT with an optional
   * `{ metadata }` body, answered with the stored pin (`slug`, `pinnedAt`,
   * `metadata`).
   */
  async pin(slug: string, metadata?: Record<string, unknown>): Promise<RemotePin> {
    const path = `/api/v1/pins/${encodeURIComponent(slug)}`;
    const response = await this.requestNewRoute(path, {
      method: "PUT",
      body: JSON.stringify({ ...(metadata ? { metadata } : {}) }),
    });
    return normalizePin(await response.json());
  }

  /**
   * Unpin a skill on the instance. Resolves true when a pin existed and was
   * deleted; false when the instance has no pin for this slug (its 404
   * carries `code: "PIN_NOT_FOUND"` — a domain answer, not version skew). A
   * bare 404 (route not deployed) still throws `RemoteRouteUnsupportedError`.
   */
  async unpin(slug: string): Promise<boolean> {
    const path = `/api/v1/pins/${encodeURIComponent(slug)}`;
    const response = await this.requestNewRoute(path, { method: "DELETE" }, { domainNotFoundCodes: ["PIN_NOT_FOUND"] });
    return response.status !== 404;
  }

  /** List the tag names the instance serves. */
  async listTags(): Promise<string[]> {
    const response = await this.requestNewRoute("/api/v1/tags");
    const payload: unknown = await response.json();
    if (!Array.isArray(payload)) {
      throw new Error("Remote tags payload did not match the expected contract (expected an array of tag names)");
    }
    // Fail-closed: a malformed element is rejected, never silently dropped —
    // a filtered tag list would quietly disagree with the instance.
    for (const tag of payload) {
      if (typeof tag !== "string" || tag.trim().length === 0) {
        throw new Error("Remote tags payload did not match the expected contract (every element must be a non-empty tag name)");
      }
    }
    return payload as string[];
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

/** Present-but-wrong-typed optional fields fail the contract instead of being dropped. */
function requireOptionalString(record: Record<string, unknown>, field: string): string | undefined {
  if (record[field] === undefined) return undefined;
  if (typeof record[field] !== "string") {
    throw new Error(`Remote payload did not match the expected contract (${field} must be a string when present)`);
  }
  return record[field] as string;
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
  let metadata: Record<string, unknown> | undefined;
  if (record.metadata !== undefined) {
    if (!record.metadata || typeof record.metadata !== "object" || Array.isArray(record.metadata)) {
      throw new Error("Remote pin payload did not match the expected contract (metadata must be a JSON object when present)");
    }
    metadata = record.metadata as Record<string, unknown>;
  }
  const pinnedAt = requireOptionalString(record, "pinnedAt");
  return {
    slug,
    ...(pinnedAt !== undefined ? { pinnedAt } : {}),
    ...(metadata ? { metadata } : {}),
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
    ...(requireOptionalString(record, "name") !== undefined ? { name: requireOptionalString(record, "name") } : {}),
    ...(requireOptionalString(record, "version") !== undefined ? { version: requireOptionalString(record, "version") } : {}),
    ...(requireOptionalString(record, "updatedAt") !== undefined ? { updatedAt: requireOptionalString(record, "updatedAt") } : {}),
  };
}

function normalizeSkillSummaryList(payload: unknown): RemoteSkillSummary[] {
  if (!Array.isArray(payload)) {
    throw new Error("Remote skills payload did not match the expected contract (expected an array of skills)");
  }
  return payload.map(normalizeSkillSummary);
}

/** True when a 404's JSON body carries one of the given `code` values. */
async function responseBodyCarriesCode(response: Response, codes: string[]): Promise<boolean> {
  try {
    const payload: unknown = await response.clone().json();
    if (!payload || typeof payload !== "object") return false;
    const code = (payload as Record<string, unknown>).code;
    return typeof code === "string" && codes.includes(code);
  } catch {
    // A bare 404 (route missing, no domain body) does not parse as JSON.
    return false;
  }
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

/**
 * Write-free client resolution for read-only paths (e.g. `sync --dry-run`).
 *
 * createRemoteSkillsClient() resolves the stored credential through
 * getAuthFilePath() and the stored origin through loadConfig() — both route
 * through getDataDir(), which WRITES (mkdirs the app dir, merges legacy ~/.skills
 * content, copies the legacy config). A dry run must resolve the same client a
 * real run would without performing any of that: the credential and the origin
 * are read from the same files at the same computed paths, and the MissingApiUrl
 * failure mode is preserved (a key with no origin still fails loudly).
 */
export function createRemoteSkillsClientReadOnly(): RemoteSkillsClient | null {
  const apiKey = getApiKeyReadOnly();
  if (!apiKey) return null;
  const apiUrl = resolveApiUrl(loadConfigReadOnly(), process.env);
  if (!apiUrl) throw new MissingApiUrlError("the cloud group's sync verb (--dry-run)");
  return new RemoteSkillsClient(apiKey, apiUrl);
}
