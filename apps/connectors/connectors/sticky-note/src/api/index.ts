import { StickyNoteClient } from './client';
import type {
  CreateNoteInput,
  Note,
  RawRequestOptions,
  SearchInput,
  StickyNoteConfig,
  StickyNoteEvent,
} from '../types';

export { StickyNoteClient, DEFAULT_BASE_URL } from './client';

export class StickyNote {
  private client: StickyNoteClient;

  constructor(config: StickyNoteConfig) {
    this.client = new StickyNoteClient(config);
  }

  async listNotes(params?: Record<string, string | number | boolean | undefined>): Promise<unknown> {
    return this.client.get('/notes', params);
  }

  async createNote(input: CreateNoteInput): Promise<Note> {
    return this.client.post<Note>('/notes', input);
  }

  async getNote(noteId: string): Promise<Note> {
    const encoded = this.client.encodePathSegment(noteId);
    return this.client.get<Note>(`/notes/${encoded}`);
  }

  async listEvents(params?: Record<string, string | number | boolean | undefined>): Promise<unknown> {
    return this.client.get('/events', params);
  }

  async search(input: SearchInput): Promise<unknown> {
    return this.client.post('/search', input);
  }

  async rawRequest(options: RawRequestOptions): Promise<unknown> {
    const { method = 'GET', path, query, body, headers } = options;
    return this.client.request(path, { method, params: query, body, headers });
  }

  getClient(): StickyNoteClient {
    return this.client;
  }
}
