// LiveAgent Connector — Help desk and live chat customer support
import { LiveAgentClient } from './client';
import type { LiveAgentConfig, LATicket, LAAgent, LADepartment, LAContact, LAChatSession } from '../types';
export { LiveAgentClient } from './client';

export class LiveAgent {
  private readonly client: LiveAgentClient;
  constructor(config: LiveAgentConfig) { this.client = new LiveAgentClient(config); }
  static fromEnv(): LiveAgent {
    const domain = process.env.LIVEAGENT_DOMAIN;
    const apiKey = process.env.LIVEAGENT_API_KEY;
    if (!domain || !apiKey) throw new Error('LIVEAGENT_DOMAIN and LIVEAGENT_API_KEY are required');
    return new LiveAgent({ domain, apiKey });
  }

  async listTickets(options?: { page?: number; per_page?: number; status?: string }): Promise<{ tickets: LATicket[] }> {
    return this.client.request('/tickets', { params: { _page: options?.page, _perPage: options?.per_page, status: options?.status } });
  }
  async getTicket(ticketId: string): Promise<LATicket> { return this.client.request<LATicket>(`/tickets/${ticketId}`); }
  async createTicket(data: { subject: string; message: string; requester_email: string; department_id?: string; tags?: string[] }): Promise<LATicket> {
    return this.client.request<LATicket>('/tickets', { method: 'POST', body: data as Record<string, unknown> });
  }
  async replyToTicket(ticketId: string, message: string): Promise<void> {
    await this.client.request(`/tickets/${ticketId}/messages`, { method: 'POST', body: { body: message } });
  }
  async updateTicketStatus(ticketId: string, status: string): Promise<LATicket> {
    return this.client.request<LATicket>(`/tickets/${ticketId}`, { method: 'PUT', body: { status } });
  }

  async listAgents(): Promise<{ agents: LAAgent[] }> { return this.client.request('/agents'); }
  async listDepartments(): Promise<{ departments: LADepartment[] }> { return this.client.request('/departments'); }

  async listContacts(options?: { page?: number; per_page?: number }): Promise<{ contacts: LAContact[] }> {
    return this.client.request('/contacts', { params: { _page: options?.page, _perPage: options?.per_page } });
  }
  async getContact(contactId: string): Promise<LAContact> { return this.client.request<LAContact>(`/contacts/${contactId}`); }

  async listChatSessions(options?: { status?: string }): Promise<{ chats: LAChatSession[] }> {
    return this.client.request('/chats', { params: { status: options?.status } });
  }

  getClient(): LiveAgentClient { return this.client; }
}
