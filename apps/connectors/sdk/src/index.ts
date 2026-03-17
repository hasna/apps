/**
 * @hasna/connectors-sdk
 * Zero-dependency TypeScript SDK for the @hasna/connectors REST API.
 * Default server port: 19426 (matches connectors-serve default).
 */

// ── Types ──────────────────────────────────────────────────────────────────

export interface AuthStatus {
  type: "api_key" | "oauth" | "none";
  connected: boolean;
  expiresAt?: number | null;
  profile?: string;
}

export interface ConnectorSummary {
  name: string;
  category: string;
  installed: boolean;
}

export interface Connector {
  name: string;
  displayName: string;
  description: string;
  category: string;
  version?: string;
  installed: boolean;
  auth: AuthStatus | null;
  overview?: string | null;
}

export interface Profile {
  id: string;
  [key: string]: unknown;
}

export interface ProfilesResponse {
  current: string;
  profiles: Profile[];
}

export interface ActivityEntry {
  action: string;
  connector: string;
  timestamp: number;
  detail?: string;
}

export interface UpdateResult {
  name: string;
  success: boolean;
  error?: string;
}

export interface UpdateResponse {
  results: UpdateResult[];
  count: number;
  total: number;
}

export interface InstallResponse {
  success: boolean;
  name: string;
}

export interface UninstallResponse {
  success: boolean;
  name: string;
}

export interface SetKeyResponse {
  success: boolean;
}

export interface RefreshResponse {
  success: boolean;
  expiresAt?: number | null;
  error?: string;
}

export interface SwitchProfileResponse {
  success: boolean;
  profile: string;
}

export interface ApiError {
  error: string;
}

export interface ConnectorsClientOptions {
  /** Base URL of the connectors server. Defaults to http://localhost:19426 */
  serverUrl?: string;
}

export interface ListOptions {
  /** Return compact list (name, category, installed only) */
  compact?: boolean;
  /** Comma-separated list of fields to return */
  fields?: string;
}

// ── Client ─────────────────────────────────────────────────────────────────

export class ConnectorsClient {
  private readonly baseUrl: string;

  constructor(options: ConnectorsClientOptions = {}) {
    this.baseUrl = (options.serverUrl ?? "http://localhost:19426").replace(/\/$/, "");
  }

  private async request<T>(
    path: string,
    options?: RequestInit
  ): Promise<T> {
    const url = `${this.baseUrl}${path}`;
    const res = await fetch(url, {
      headers: { "Content-Type": "application/json" },
      ...options,
    });

    const data = await res.json() as T | ApiError;

    if (!res.ok) {
      const err = data as ApiError;
      throw new Error(err.error ?? `Request failed with status ${res.status}`);
    }

    return data as T;
  }

  /**
   * List all connectors.
   * @param opts.compact - Return compact list (name, category, installed only)
   * @param opts.fields - Comma-separated list of fields to return
   */
  async list(opts: ListOptions & { compact: true }): Promise<ConnectorSummary[]>;
  async list(opts?: ListOptions): Promise<Connector[]>;
  async list(opts: ListOptions = {}): Promise<Connector[] | ConnectorSummary[]> {
    const params = new URLSearchParams();
    if (opts.compact) params.set("compact", "true");
    if (opts.fields) params.set("fields", opts.fields);
    const qs = params.toString() ? `?${params.toString()}` : "";
    return this.request<Connector[]>(`/api/connectors${qs}`);
  }

  /**
   * Get a single connector by name.
   */
  async get(name: string): Promise<Connector> {
    return this.request<Connector>(`/api/connectors/${encodeURIComponent(name)}`);
  }

  /**
   * Install a connector.
   */
  async install(name: string): Promise<InstallResponse> {
    return this.request<InstallResponse>(`/api/connectors/${encodeURIComponent(name)}/install`, {
      method: "POST",
    });
  }

  /**
   * Uninstall a connector.
   */
  async uninstall(name: string): Promise<UninstallResponse> {
    return this.request<UninstallResponse>(`/api/connectors/${encodeURIComponent(name)}/uninstall`, {
      method: "POST",
    });
  }

  /**
   * Save an API key for a connector.
   * @param name - Connector name
   * @param key - The API key value
   * @param field - Optional field name (for connectors with multiple key fields)
   */
  async setKey(name: string, key: string, field?: string): Promise<SetKeyResponse> {
    return this.request<SetKeyResponse>(`/api/connectors/${encodeURIComponent(name)}/key`, {
      method: "POST",
      body: JSON.stringify({ key, ...(field ? { field } : {}) }),
    });
  }

  /**
   * Refresh OAuth tokens for a connector.
   */
  async refresh(name: string): Promise<RefreshResponse> {
    return this.request<RefreshResponse>(`/api/connectors/${encodeURIComponent(name)}/refresh`, {
      method: "POST",
    });
  }

  /**
   * Get profiles for a connector.
   */
  async getProfiles(name: string): Promise<ProfilesResponse> {
    return this.request<ProfilesResponse>(`/api/connectors/${encodeURIComponent(name)}/profiles`);
  }

  /**
   * Switch the active profile for a connector.
   */
  async switchProfile(name: string, profileId: string): Promise<SwitchProfileResponse> {
    return this.request<SwitchProfileResponse>(`/api/connectors/${encodeURIComponent(name)}/profiles/switch`, {
      method: "POST",
      body: JSON.stringify({ profile: profileId }),
    });
  }

  /**
   * Delete a profile for a connector. Cannot delete the "default" profile.
   */
  async deleteProfile(name: string, profileId: string): Promise<{ success: boolean }> {
    return this.request<{ success: boolean }>(
      `/api/connectors/${encodeURIComponent(name)}/profiles/${encodeURIComponent(profileId)}`,
      { method: "DELETE" }
    );
  }

  /**
   * Get the activity log.
   * @param limit - Maximum number of entries to return (client-side truncation)
   */
  async getActivity(limit?: number): Promise<ActivityEntry[]> {
    const entries = await this.request<ActivityEntry[]>("/api/activity");
    return limit !== undefined ? entries.slice(0, limit) : entries;
  }

  /**
   * Re-install all installed connectors (update from package).
   */
  async update(): Promise<UpdateResponse> {
    return this.request<UpdateResponse>("/api/update", { method: "POST" });
  }

  /**
   * Export all connector credentials.
   */
  async export(): Promise<{ connectors: Record<string, unknown>; exportedAt: string }> {
    return this.request<{ connectors: Record<string, unknown>; exportedAt: string }>("/api/export");
  }

  /**
   * Import connector credentials from backup JSON.
   */
  async import(data: { connectors: Record<string, { profiles: Record<string, unknown> }> }): Promise<{ success: boolean; imported: number }> {
    return this.request<{ success: boolean; imported: number }>("/api/import", {
      method: "POST",
      body: JSON.stringify(data),
    });
  }
}

export default ConnectorsClient;
