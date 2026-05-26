import type { ConnectorClient } from './client';
import type { Note, NoteCreateParams } from '../types';

export class NotesApi {
  constructor(private readonly client: ConnectorClient) {}

  async get(noteId: string): Promise<{ note: Note }> {
    return this.client.get<{ note: Note }>(`/notes/${noteId}`);
  }

  async create(params: NoteCreateParams): Promise<{ note: Note }> {
    return this.client.post<{ note: Note }>('/notes', { note: params });
  }

  async update(noteId: string, note: string): Promise<{ note: Note }> {
    return this.client.put<{ note: Note }>(`/notes/${noteId}`, { note: { note } });
  }

  async delete(noteId: string): Promise<void> {
    await this.client.delete(`/notes/${noteId}`);
  }
}
