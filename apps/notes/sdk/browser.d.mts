export type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
export interface Note {
  id: string; tenantId: string; clientId: string | null; slug: string | null;
  title: string; bodyMarkdown: string; frontmatterJson: Record<string, Json>;
  folder: string | null; labels: string[]; pinned: boolean; archived: boolean;
  revision: number; contentHash: string; source: 'local' | 'hosted' | 'mcp' | 'agent';
  agentProvenanceJson: Record<string, Json>; deletedAt: string | null;
  createdAt: string; updatedAt: string;
}
export interface NoteInput {
  clientId?: string; slug?: string; title?: string; bodyMarkdown?: string;
  frontmatterJson?: Record<string, Json>; folder?: string | null; labels?: string[];
  pinned?: boolean; archived?: boolean; source?: Note['source'];
  agentProvenanceJson?: Record<string, Json>;
}
export interface RequestOptions { signal?: AbortSignal; idempotencyKey?: string }
export interface MutationOptions extends RequestOptions { baseRevision?: number }
export interface ListOptions extends RequestOptions { limit?: number; cursor?: string; includeDeleted?: boolean; label?: string; search?: string }
export interface NotesPage { data: Note[]; nextCursor: string | null; hasMore: boolean }
export interface Change { sequence: string; noteId: string; action: 'upsert' | 'delete'; note: Note | null }
export interface ChangesPage { changes: Change[]; cursor: string; hasMore: boolean }
export interface Label { name: string; count: number }
export class NotesApiError extends Error {
  code: string; status: number; details?: unknown;
  constructor(code: string, message: string, options?: { status?: number; details?: unknown });
}
export function normalizeNotesApiBase(value: string, options?: { allowHttpLoopback?: boolean }): string;
export class NotesClient {
  constructor(options: {
    apiBase: string; credential: () => string | null | undefined | Promise<string | null | undefined>;
    fetchImpl?: typeof fetch; allowHttpLoopback?: boolean; timeoutMs?: number; maxResponseBytes?: number;
  });
  readonly apiBase: string;
  list(options?: ListOptions): Promise<NotesPage>;
  get(id: string, options?: RequestOptions): Promise<Note>;
  create(input: NoteInput, options?: RequestOptions): Promise<Note>;
  update(id: string, input: Partial<NoteInput> & { baseRevision?: number }, options?: RequestOptions): Promise<Note>;
  delete(id: string, options?: MutationOptions): Promise<{ deleted: true; id: string; revision: number }>;
  restore(id: string, options?: MutationOptions): Promise<Note>;
  changes(options?: { cursor?: string; limit?: number; signal?: AbortSignal }): Promise<ChangesPage>;
  labels(options?: RequestOptions): Promise<{ data: Label[] }>;
  renameLabel(label: string, name: string, options?: RequestOptions): Promise<{ updated: number }>;
  deleteLabel(label: string, options?: RequestOptions): Promise<{ updated: number }>;
  export(options?: RequestOptions): Promise<{ exportId: string; notes: Note[] }>;
}
