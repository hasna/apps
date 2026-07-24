// Pinned public declarations from e1eed58db9157f150eefc4d2a29810199ecc9b46.
export interface Note {
    "id": string;
    "short_id"?: string | null;
    "title": string;
    "content": string;
    "url"?: string | null;
    "tags": Array<string>;
    "metadata"?: Record<string, unknown>;
    "archived": boolean;
    "created_at": string;
    "updated_at": string;
}
export interface NoteInput {
    "title": string;
    "content"?: string;
    "url"?: string | null;
    "tags"?: Array<string>;
    "metadata"?: Record<string, unknown>;
}
export interface NotePatch {
    "title"?: string;
    "content"?: string;
    "url"?: string | null;
    "tags"?: Array<string>;
    "metadata"?: Record<string, unknown>;
    "archived"?: boolean;
}
export interface NoteList {
    "items": Array<Note>;
    "total": number;
}
export interface KnowledgeApiClientOptions {
    /** Base URL, e.g. process.env.APP_API_URL. */
    baseUrl: string;
    /** API key, e.g. process.env.APP_API_KEY. Sent as the 'x-api-key' header. */
    apiKey?: string;
    /** Custom fetch (defaults to global fetch). */
    fetch?: typeof fetch;
    /** Extra headers merged into every request. */
    headers?: Record<string, string>;
}
export declare class ApiError extends Error {
    readonly status: number;
    readonly body: unknown;
    constructor(status: number, message: string, body: unknown);
}
export declare class KnowledgeApiClient {
    private readonly baseUrl;
    private readonly apiKey;
    private readonly fetchImpl;
    private readonly baseHeaders;
    constructor(options: KnowledgeApiClientOptions);
    private request;
    /** List knowledge items */
    listNotes(query?: {
        "limit"?: number;
        "offset"?: number;
        "search"?: string;
    }, init?: RequestInit): Promise<NoteList>;
    /** Create a knowledge item */
    createNote(body: NoteInput, init?: RequestInit): Promise<Note>;
    /** Fetch a knowledge item */
    getNote(id: string, init?: RequestInit): Promise<Note>;
    /** Delete a knowledge item */
    deleteNote(id: string, init?: RequestInit): Promise<void>;
    /** Update a knowledge item */
    updateNote(id: string, body: NotePatch, init?: RequestInit): Promise<Note>;
    /** Knowledge registry contract */
    getRegistry(init?: RequestInit): Promise<Record<string, unknown>>;
}
