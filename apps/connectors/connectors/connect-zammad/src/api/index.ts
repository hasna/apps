// Zammad Connector — Open-source helpdesk and customer support ticketing
import { ZammadClient } from './client';
import type { ZammadConfig, ZDTicket, ZDUser, ZDGroup, ZDArticle, ZDOrganization } from '../types';
export { ZammadClient } from './client';

export class Zammad {
  private readonly client: ZammadClient;
  constructor(config: ZammadConfig) { this.client = new ZammadClient(config); }
  static fromEnv(): Zammad {
    const url = process.env.ZAMMAD_URL;
    const token = process.env.ZAMMAD_TOKEN;
    if (!url || !token) throw new Error('ZAMMAD_URL and ZAMMAD_TOKEN are required');
    return new Zammad({ url, token });
  }

  async listTickets(options?: { page?: number; per_page?: number }): Promise<ZDTicket[]> { return this.client.request<ZDTicket[]>('/tickets', { params: options as Record<string, number | undefined> }); }
  async getTicket(id: number): Promise<ZDTicket> { return this.client.request<ZDTicket>(`/tickets/${id}`); }
  async createTicket(data: { title: string; group: string; customer_id: number; article: { subject: string; body: string; type?: string } }): Promise<ZDTicket> {
    return this.client.request<ZDTicket>('/tickets', { method: 'POST', body: data as Record<string, unknown> });
  }
  async updateTicket(id: number, data: Partial<{ title: string; state_id: number; priority_id: number; owner_id: number }>): Promise<ZDTicket> {
    return this.client.request<ZDTicket>(`/tickets/${id}`, { method: 'PUT', body: data as Record<string, unknown> });
  }
  async deleteTicket(id: number): Promise<void> { await this.client.request(`/tickets/${id}`, { method: 'DELETE' }); }

  async getTicketArticles(ticketId: number): Promise<ZDArticle[]> { return this.client.request<ZDArticle[]>(`/ticket_articles/by_ticket/${ticketId}`); }
  async createArticle(ticketId: number, data: { subject?: string; body: string; type?: string; internal?: boolean }): Promise<ZDArticle> {
    return this.client.request<ZDArticle>('/ticket_articles', { method: 'POST', body: { ticket_id: ticketId, ...data } });
  }

  async listUsers(options?: { page?: number; per_page?: number }): Promise<ZDUser[]> { return this.client.request<ZDUser[]>('/users', { params: options as Record<string, number | undefined> }); }
  async getUser(id: number): Promise<ZDUser> { return this.client.request<ZDUser>(`/users/${id}`); }
  async searchUsers(query: string): Promise<ZDUser[]> { return this.client.request<ZDUser[]>('/users/search', { params: { query } }); }

  async listGroups(): Promise<ZDGroup[]> { return this.client.request<ZDGroup[]>('/groups'); }
  async listOrganizations(): Promise<ZDOrganization[]> { return this.client.request<ZDOrganization[]>('/organizations'); }

  getClient(): ZammadClient { return this.client; }
}
