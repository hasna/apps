import type { ConnectorClient } from './client';
import type { Note, NoteCreateParams } from '../types';

export class NotesApi {
  constructor(private readonly client: ConnectorClient) {}

  async getByContact(contactId: number): Promise<Note[]> {
    return this.client.get<Note[]>(`/contacts/${contactId}/notes`);
  }

  async create(data: NoteCreateParams): Promise<Note> {
    return this.client.post<Note>('/notes', data);
  }

  async deleteFromContact(contactId: number, noteId: number): Promise<void> {
    await this.client.delete(`/contacts/${contactId}/notes/${noteId}`);
  }

  async getByDeal(dealId: number): Promise<Note[]> {
    return this.client.get<Note[]>(`/opportunity/${dealId}/notes`);
  }

  async createForDeal(data: NoteCreateParams): Promise<Note> {
    return this.client.post<Note>('/opportunity/deals/notes', data);
  }
}
