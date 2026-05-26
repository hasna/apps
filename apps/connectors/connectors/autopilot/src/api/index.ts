// Autopilot Connector — Marketing automation and customer journey mapping
import { AutopilotClient } from './client';
import type { AutopilotConfig, APContact, APContactList, APList, APJourney, APSmartSegment } from '../types';
export { AutopilotClient } from './client';

export class Autopilot {
  private readonly client: AutopilotClient;
  constructor(config: AutopilotConfig) { this.client = new AutopilotClient(config); }
  static fromEnv(): Autopilot {
    const apiKey = process.env.AUTOPILOT_API_KEY;
    if (!apiKey) throw new Error('AUTOPILOT_API_KEY is required');
    return new Autopilot({ apiKey });
  }

  async getContact(contactId: string): Promise<APContact> { return this.client.request<APContact>(`/contact/${contactId}`); }
  async getContactByEmail(email: string): Promise<APContact> { return this.client.request<APContact>(`/contact/${email}`); }
  async createOrUpdateContact(data: { Email: string; FirstName?: string; LastName?: string; Company?: string; Phone?: string; custom?: Record<string, unknown> }): Promise<{ contact_id: string }> {
    return this.client.request('/contact', { method: 'POST', body: { contact: data } });
  }
  async deleteContact(contactId: string): Promise<void> { await this.client.request(`/contact/${contactId}`, { method: 'DELETE' }); }

  async listContacts(options?: { bookmark?: string }): Promise<APContactList> {
    const path = options?.bookmark ? `/contacts/${options.bookmark}` : '/contacts';
    return this.client.request<APContactList>(path);
  }

  async listLists(): Promise<{ lists: APList[] }> { return this.client.request('/lists'); }
  async addContactToList(listId: string, contactId: string): Promise<void> {
    await this.client.request(`/list/${listId}/contact/${contactId}`, { method: 'POST' });
  }
  async removeContactFromList(listId: string, contactId: string): Promise<void> {
    await this.client.request(`/list/${listId}/contact/${contactId}`, { method: 'DELETE' });
  }

  async listJourneys(): Promise<{ journeys: APJourney[] }> { return this.client.request('/journeys'); }
  async addContactToJourney(journeyId: string, contactId: string): Promise<void> {
    await this.client.request(`/journey/${journeyId}/contact/${contactId}`, { method: 'POST' });
  }

  async listSmartSegments(): Promise<{ smart_segments: APSmartSegment[] }> { return this.client.request('/smart_segments'); }

  getClient(): AutopilotClient { return this.client; }
}
