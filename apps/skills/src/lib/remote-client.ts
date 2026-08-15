import { getApiKey as getStoredApiKey, getApiUrl } from "./auth-store.js";
import { normalizeRemoteSkillRunContract, type RemoteSkillRunContract } from "./remote-run-contract.js";

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
}

export function createRemoteSkillsClient(): RemoteSkillsClient | null {
  const apiKey = getStoredApiKey();
  if (!apiKey) return null;
  return new RemoteSkillsClient(apiKey);
}
