// HubSpot Connector
// CRM contacts, companies, deals, and tickets

import { HubSpotClient } from './client';
import type {
  HubSpotConfig,
  HubSpotListResponse,
  Contact,
  CreateContactInput,
  UpdateContactInput,
  Company,
  CreateCompanyInput,
  UpdateCompanyInput,
  Deal,
  CreateDealInput,
  UpdateDealInput,
  Ticket,
  CreateTicketInput,
  UpdateTicketInput,
  Owner,
  Note,
  CreateNoteInput,
  SearchRequest,
  SearchResponse,
} from '../types';

export { HubSpotClient } from './client';

export class HubSpot {
  private client: HubSpotClient;

  constructor(config: HubSpotConfig) {
    this.client = new HubSpotClient(config);
  }

  // ============================================
  // Contacts
  // ============================================

  /**
   * List all contacts
   */
  async listContacts(params?: {
    limit?: number;
    after?: string;
    properties?: string[];
  }): Promise<HubSpotListResponse<Contact>> {
    return this.client.get('/crm/v3/objects/contacts', {
      limit: params?.limit,
      after: params?.after,
      properties: params?.properties?.join(','),
    });
  }

  /**
   * Get a contact by ID
   */
  async getContact(contactId: string, properties?: string[]): Promise<Contact> {
    return this.client.get(`/crm/v3/objects/contacts/${contactId}`, {
      properties: properties?.join(','),
    });
  }

  /**
   * Create a contact
   */
  async createContact(data: CreateContactInput): Promise<Contact> {
    return this.client.post('/crm/v3/objects/contacts', data);
  }

  /**
   * Update a contact
   */
  async updateContact(contactId: string, data: UpdateContactInput): Promise<Contact> {
    return this.client.patch(`/crm/v3/objects/contacts/${contactId}`, data);
  }

  /**
   * Delete a contact
   */
  async deleteContact(contactId: string): Promise<void> {
    await this.client.delete(`/crm/v3/objects/contacts/${contactId}`);
  }

  /**
   * Search contacts
   */
  async searchContacts(request: SearchRequest): Promise<SearchResponse<Contact>> {
    return this.client.post('/crm/v3/objects/contacts/search', request);
  }

  // ============================================
  // Companies
  // ============================================

  /**
   * List all companies
   */
  async listCompanies(params?: {
    limit?: number;
    after?: string;
    properties?: string[];
  }): Promise<HubSpotListResponse<Company>> {
    return this.client.get('/crm/v3/objects/companies', {
      limit: params?.limit,
      after: params?.after,
      properties: params?.properties?.join(','),
    });
  }

  /**
   * Get a company by ID
   */
  async getCompany(companyId: string, properties?: string[]): Promise<Company> {
    return this.client.get(`/crm/v3/objects/companies/${companyId}`, {
      properties: properties?.join(','),
    });
  }

  /**
   * Create a company
   */
  async createCompany(data: CreateCompanyInput): Promise<Company> {
    return this.client.post('/crm/v3/objects/companies', data);
  }

  /**
   * Update a company
   */
  async updateCompany(companyId: string, data: UpdateCompanyInput): Promise<Company> {
    return this.client.patch(`/crm/v3/objects/companies/${companyId}`, data);
  }

  /**
   * Delete a company
   */
  async deleteCompany(companyId: string): Promise<void> {
    await this.client.delete(`/crm/v3/objects/companies/${companyId}`);
  }

  /**
   * Search companies
   */
  async searchCompanies(request: SearchRequest): Promise<SearchResponse<Company>> {
    return this.client.post('/crm/v3/objects/companies/search', request);
  }

  // ============================================
  // Deals
  // ============================================

  /**
   * List all deals
   */
  async listDeals(params?: {
    limit?: number;
    after?: string;
    properties?: string[];
  }): Promise<HubSpotListResponse<Deal>> {
    return this.client.get('/crm/v3/objects/deals', {
      limit: params?.limit,
      after: params?.after,
      properties: params?.properties?.join(','),
    });
  }

  /**
   * Get a deal by ID
   */
  async getDeal(dealId: string, properties?: string[]): Promise<Deal> {
    return this.client.get(`/crm/v3/objects/deals/${dealId}`, {
      properties: properties?.join(','),
    });
  }

  /**
   * Create a deal
   */
  async createDeal(data: CreateDealInput): Promise<Deal> {
    return this.client.post('/crm/v3/objects/deals', data);
  }

  /**
   * Update a deal
   */
  async updateDeal(dealId: string, data: UpdateDealInput): Promise<Deal> {
    return this.client.patch(`/crm/v3/objects/deals/${dealId}`, data);
  }

  /**
   * Delete a deal
   */
  async deleteDeal(dealId: string): Promise<void> {
    await this.client.delete(`/crm/v3/objects/deals/${dealId}`);
  }

  /**
   * Search deals
   */
  async searchDeals(request: SearchRequest): Promise<SearchResponse<Deal>> {
    return this.client.post('/crm/v3/objects/deals/search', request);
  }

  // ============================================
  // Tickets
  // ============================================

  /**
   * List all tickets
   */
  async listTickets(params?: {
    limit?: number;
    after?: string;
    properties?: string[];
  }): Promise<HubSpotListResponse<Ticket>> {
    return this.client.get('/crm/v3/objects/tickets', {
      limit: params?.limit,
      after: params?.after,
      properties: params?.properties?.join(','),
    });
  }

  /**
   * Get a ticket by ID
   */
  async getTicket(ticketId: string, properties?: string[]): Promise<Ticket> {
    return this.client.get(`/crm/v3/objects/tickets/${ticketId}`, {
      properties: properties?.join(','),
    });
  }

  /**
   * Create a ticket
   */
  async createTicket(data: CreateTicketInput): Promise<Ticket> {
    return this.client.post('/crm/v3/objects/tickets', data);
  }

  /**
   * Update a ticket
   */
  async updateTicket(ticketId: string, data: UpdateTicketInput): Promise<Ticket> {
    return this.client.patch(`/crm/v3/objects/tickets/${ticketId}`, data);
  }

  /**
   * Delete a ticket
   */
  async deleteTicket(ticketId: string): Promise<void> {
    await this.client.delete(`/crm/v3/objects/tickets/${ticketId}`);
  }

  /**
   * Search tickets
   */
  async searchTickets(request: SearchRequest): Promise<SearchResponse<Ticket>> {
    return this.client.post('/crm/v3/objects/tickets/search', request);
  }

  // ============================================
  // Owners
  // ============================================

  /**
   * List all owners
   */
  async listOwners(params?: {
    limit?: number;
    after?: string;
    email?: string;
  }): Promise<HubSpotListResponse<Owner>> {
    return this.client.get('/crm/v3/owners', {
      limit: params?.limit,
      after: params?.after,
      email: params?.email,
    });
  }

  /**
   * Get an owner by ID
   */
  async getOwner(ownerId: string): Promise<Owner> {
    return this.client.get(`/crm/v3/owners/${ownerId}`);
  }

  // ============================================
  // Notes
  // ============================================

  /**
   * List all notes
   */
  async listNotes(params?: {
    limit?: number;
    after?: string;
    properties?: string[];
  }): Promise<HubSpotListResponse<Note>> {
    return this.client.get('/crm/v3/objects/notes', {
      limit: params?.limit,
      after: params?.after,
      properties: params?.properties?.join(','),
    });
  }

  /**
   * Get a note by ID
   */
  async getNote(noteId: string, properties?: string[]): Promise<Note> {
    return this.client.get(`/crm/v3/objects/notes/${noteId}`, {
      properties: properties?.join(','),
    });
  }

  /**
   * Create a note
   */
  async createNote(data: CreateNoteInput): Promise<Note> {
    return this.client.post('/crm/v3/objects/notes', data);
  }

  /**
   * Delete a note
   */
  async deleteNote(noteId: string): Promise<void> {
    await this.client.delete(`/crm/v3/objects/notes/${noteId}`);
  }

  // ============================================
  // Associations
  // ============================================

  /**
   * Create association between objects
   */
  async createAssociation(
    fromObjectType: string,
    fromObjectId: string,
    toObjectType: string,
    toObjectId: string,
    associationType: string
  ): Promise<void> {
    await this.client.put(
      `/crm/v3/objects/${fromObjectType}/${fromObjectId}/associations/${toObjectType}/${toObjectId}/${associationType}`
    );
  }

  /**
   * Delete association between objects
   */
  async deleteAssociation(
    fromObjectType: string,
    fromObjectId: string,
    toObjectType: string,
    toObjectId: string,
    associationType: string
  ): Promise<void> {
    await this.client.delete(
      `/crm/v3/objects/${fromObjectType}/${fromObjectId}/associations/${toObjectType}/${toObjectId}/${associationType}`
    );
  }

  /**
   * Get associations for an object
   */
  async getAssociations(
    objectType: string,
    objectId: string,
    toObjectType: string
  ): Promise<{ results: { id: string; type: string }[] }> {
    return this.client.get(`/crm/v3/objects/${objectType}/${objectId}/associations/${toObjectType}`);
  }

  /**
   * Get API key preview for debugging
   */
  getApiKeyPreview(): string {
    return this.client.getApiKeyPreview();
  }
}
