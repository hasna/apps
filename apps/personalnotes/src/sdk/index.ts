// @generated from OpenAPI by @hasna/contracts SDK generator — DO NOT EDIT.
// Source: PersonalNotes 0.0.0

export interface Note { "id": string; "title"?: string; "body"?: string; "labels"?: Array<string>; "status"?: string; "folder"?: string; "createdAt"?: string; "updatedAt"?: string }

export interface NoteList { "items": Array<Note>; "limit"?: number; "offset"?: number; "total"?: number; "hasMore"?: boolean; "nextOffset"?: number }

export interface Settings { "trashRetentionDays"?: number }

export interface PurgeResult { "purged": Array<string>; "count": number }

export interface Ok { "ok": boolean }

export interface Error { "error": string; "message"?: string }

export interface PersonalNotesClientOptions {
  /** Base URL, e.g. process.env.APP_API_URL. */
  baseUrl: string;
  /** API key, e.g. process.env.APP_API_KEY. Sent as the 'x-api-key' header. */
  apiKey?: string;
  /** Custom fetch (defaults to global fetch). */
  fetch?: typeof fetch;
  /** Extra headers merged into every request. */
  headers?: Record<string, string>;
}

export class ApiError extends Error {
  constructor(readonly status: number, message: string, readonly body: unknown) {
    super(message);
    this.name = "ApiError";
  }
}

export class PersonalNotesClient {
  private readonly baseUrl: string;
  private readonly apiKey: string | undefined;
  private readonly fetchImpl: typeof fetch;
  private readonly baseHeaders: Record<string, string>;

  constructor(options: PersonalNotesClientOptions) {
    if (!options.baseUrl) throw new Error("PersonalNotesClient requires a baseUrl.");
    this.baseUrl = options.baseUrl.replace(/\/$/, "");
    this.apiKey = options.apiKey;
    this.fetchImpl = options.fetch ?? globalThis.fetch;
    this.baseHeaders = options.headers ?? {};
  }

  private async request<T>(method: string, path: string, opts: { body?: unknown; query?: Record<string, unknown>; init?: RequestInit }): Promise<T> {
    const url = new URL(this.baseUrl + path);
    if (opts.query) {
      for (const [key, value] of Object.entries(opts.query)) {
        if (value !== undefined && value !== null) url.searchParams.set(key, String(value));
      }
    }
    const headers: Record<string, string> = { Accept: "application/json", ...this.baseHeaders, ...(opts.init?.headers as Record<string, string> | undefined) };
    if (this.apiKey) headers["x-api-key"] = this.apiKey;
    let payload: BodyInit | undefined;
    if (opts.body !== undefined) {
      headers["Content-Type"] = "application/json";
      payload = JSON.stringify(opts.body);
    }
    const response = await this.fetchImpl(url.toString(), { ...opts.init, method, headers, body: payload });
    const text = await response.text();
    const data = text ? (() => { try { return JSON.parse(text); } catch { return text; } })() : undefined;
    if (!response.ok) {
      throw new ApiError(response.status, `${method} ${path} failed: ${response.status}`, data);
    }
    return data as T;
  }

    /** List persisted labels. */
    async loadLabelList(init?: RequestInit): Promise<Array<string>> {
      return this.request("GET", `/v1/labels`, {
        body: undefined,
        query: undefined,
        init,
      });
    }

    /** Replace the persisted label list. */
    async saveLabelList(body: { "labels": Array<string> }, init?: RequestInit): Promise<Array<string>> {
      return this.request("PUT", `/v1/labels`, {
        body,
        query: undefined,
        init,
      });
    }

    /** Rename a label everywhere it appears. */
    async renameLabel(body: { "from": string; "to": string }, init?: RequestInit): Promise<Ok> {
      return this.request("POST", `/v1/labels/rename`, {
        body,
        query: undefined,
        init,
      });
    }

    /** Delete a label everywhere it appears. */
    async deleteLabel(name: string, init?: RequestInit): Promise<Ok> {
      return this.request("DELETE", `/v1/labels/${encodeURIComponent(String(name))}`, {
        body: undefined,
        query: undefined,
        init,
      });
    }

    /** List notes with pagination and filters. */
    async listNotes(query?: { "limit"?: number; "offset"?: number; "label"?: string; "machine"?: string; "status"?: string; "includeTrash"?: boolean; "includeArchived"?: boolean; "query"?: string }, init?: RequestInit): Promise<NoteList> {
      return this.request("GET", `/v1/notes`, {
        body: undefined,
        query,
        init,
      });
    }

    /** Create or update (upsert) a note. */
    async saveNote(body: Note, init?: RequestInit): Promise<Note> {
      return this.request("POST", `/v1/notes`, {
        body,
        query: undefined,
        init,
      });
    }

    /** Load every note (unpaged). */
    async loadNotes(init?: RequestInit): Promise<Array<Note>> {
      return this.request("GET", `/v1/notes/all`, {
        body: undefined,
        query: undefined,
        init,
      });
    }

    /** Read one note by id. */
    async getNote(id: string, init?: RequestInit): Promise<Note> {
      return this.request("GET", `/v1/notes/${encodeURIComponent(String(id))}`, {
        body: undefined,
        query: undefined,
        init,
      });
    }

    /** Permanently delete a note. */
    async deleteNote(id: string, init?: RequestInit): Promise<Ok> {
      return this.request("DELETE", `/v1/notes/${encodeURIComponent(String(id))}`, {
        body: undefined,
        query: undefined,
        init,
      });
    }

    /** Archive a note. */
    async archiveNote(id: string, init?: RequestInit): Promise<Note> {
      return this.request("POST", `/v1/notes/${encodeURIComponent(String(id))}/archive`, {
        body: undefined,
        query: undefined,
        init,
      });
    }

    /** Assign a label to a note. */
    async assignLabel(id: string, body: { "label": string }, init?: RequestInit): Promise<Note> {
      return this.request("POST", `/v1/notes/${encodeURIComponent(String(id))}/labels`, {
        body,
        query: undefined,
        init,
      });
    }

    /** Remove a label from a note. */
    async unassignLabel(id: string, label: string, init?: RequestInit): Promise<Note> {
      return this.request("DELETE", `/v1/notes/${encodeURIComponent(String(id))}/labels/${encodeURIComponent(String(label))}`, {
        body: undefined,
        query: undefined,
        init,
      });
    }

    /** Restore a note from Trash/Archive. */
    async restoreNote(id: string, init?: RequestInit): Promise<Note> {
      return this.request("POST", `/v1/notes/${encodeURIComponent(String(id))}/restore`, {
        body: undefined,
        query: undefined,
        init,
      });
    }

    /** Move a note to Trash. */
    async trashNote(id: string, body?: { "retentionDays"?: number }, init?: RequestInit): Promise<Note> {
      return this.request("POST", `/v1/notes/${encodeURIComponent(String(id))}/trash`, {
        body,
        query: undefined,
        init,
      });
    }

    /** Read persisted settings. */
    async loadSettings(init?: RequestInit): Promise<Settings> {
      return this.request("GET", `/v1/settings`, {
        body: undefined,
        query: undefined,
        init,
      });
    }

    /** Replace persisted settings. */
    async saveSettings(body: Settings, init?: RequestInit): Promise<Settings> {
      return this.request("PUT", `/v1/settings`, {
        body,
        query: undefined,
        init,
      });
    }

    /** Purge expired Trash notes. */
    async purgeExpiredTrash(init?: RequestInit): Promise<PurgeResult> {
      return this.request("POST", `/v1/trash/purge`, {
        body: undefined,
        query: undefined,
        init,
      });
    }
}
