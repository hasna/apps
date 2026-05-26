import type { ConnectorClient } from './client';
import type { Note, NoteCreateParams, NoteUpdateParams } from '../types';

export class NotesApi {
  constructor(private readonly client: ConnectorClient) {}

  async list(params?: { limit?: number }): Promise<unknown> {
    const queryParams: Record<string, string | number | boolean | undefined> = {};
    if (params?.limit) queryParams.limit = params.limit;
    return this.client.get<unknown>('/crm/objects/note', queryParams);
  }

  async create(params: NoteCreateParams): Promise<Note> {
    return this.client.post<Note>('/crm/objects/note', params);
  }

  async update(noteId: number, params: NoteUpdateParams): Promise<Note> {
    return this.client.put<Note>(`/crm/objects/note/${noteId}`, params);
  }

  async delete(noteId: number): Promise<void> {
    await this.client.delete(`/crm/objects/note/${noteId}`);
  }
}
