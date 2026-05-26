import type { ConnectorClient } from './client';
import type { Note, NoteCreateParams, ListParams, PaginatedResponse } from '../types';

export class NotesApi {
  constructor(private readonly client: ConnectorClient) {}

  async list(params?: ListParams & { person_id?: number; organization_id?: number; opportunity_id?: number }): Promise<PaginatedResponse<Note>> {
    return this.client.get<PaginatedResponse<Note>>('/v2/notes', params as Record<string, string | number | boolean | undefined>);
  }

  async get(id: number): Promise<Note> {
    return this.client.get<Note>(`/v2/notes/${id}`);
  }

  async create(data: NoteCreateParams): Promise<Note> {
    return this.client.post<Note>('/v2/notes', data);
  }

  async update(id: number, data: { content: string }): Promise<Note> {
    return this.client.patch<Note>(`/v2/notes/${id}`, data);
  }

  async delete(id: number): Promise<void> {
    await this.client.delete(`/v2/notes/${id}`);
  }
}
