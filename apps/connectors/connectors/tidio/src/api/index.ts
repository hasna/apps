import type {
  BatchContactsParams,
  AskLyroTicketParams,
  Contact,
  ContactMessage,
  ContactProperty,
  CreateContactParams,
  CreateLyroQaDataSourceParams,
  CreateTicketAsContactParams,
  Department,
  ListContactMessagesParams,
  ListContactsParams,
  ListLyroDataSourcesParams,
  ListTicketsParams,
  LyroDataSource,
  MessageAccepted,
  Operator,
  PaginatedResponse,
  Product,
  Project,
  ReplyTicketParams,
  ScrapeLyroWebsiteParams,
  SendContactMessageParams,
  TidioConfig,
  Ticket,
  TicketCustomField,
  TicketTag,
  UpdateContactParams,
  UpdateTicketParams,
  UpsertLyroWebsiteDataSourceParams,
  UuidResponse,
} from '../types';
import { TidioClient } from './client';

function compactRecord(input: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(input).filter(([, value]) => value !== undefined));
}

function contactBody(params: CreateContactParams | UpdateContactParams): Record<string, unknown> {
  return compactRecord({
    email: params.email,
    phone: params.phone,
    first_name: params.firstName,
    last_name: params.lastName,
    distinct_id: params.distinctId,
    properties: params.properties,
    email_consent: params.emailConsent,
  });
}

export class Tidio {
  private readonly client: TidioClient;

  constructor(config: TidioConfig) {
    this.client = new TidioClient(config);
  }

  static fromEnv(): Tidio {
    const clientId = process.env.TIDIO_CLIENT_ID;
    const clientSecret = process.env.TIDIO_CLIENT_SECRET;
    if (!clientId || !clientSecret) {
      throw new Error('TIDIO_CLIENT_ID and TIDIO_CLIENT_SECRET environment variables are required');
    }
    return new Tidio({ clientId, clientSecret });
  }

  getClientIdPreview(): string {
    return this.client.getClientIdPreview();
  }

  getClient(): TidioClient {
    return this.client;
  }

  async listContacts(params: ListContactsParams = {}): Promise<PaginatedResponse<Contact>> {
    return this.client.get<PaginatedResponse<Contact>>('/contacts', {
      limit: params.limit,
      cursor: params.cursor,
      updated_after: params.updatedAfter,
      updated_before: params.updatedBefore,
    });
  }

  async getContact(contactId: string): Promise<Contact> {
    return this.client.get<Contact>(`/contacts/${encodeURIComponent(contactId)}`);
  }

  async createContact(params: CreateContactParams): Promise<UuidResponse> {
    if (!params.email && !params.phone && !params.firstName && !params.lastName && !params.distinctId) {
      throw new Error('createContact requires email, phone, firstName, lastName, or distinctId');
    }
    return this.client.post<UuidResponse>('/contacts', contactBody(params));
  }

  async createContactsBatch(params: BatchContactsParams<CreateContactParams>): Promise<unknown> {
    return this.client.post('/contacts/batch', {
      contacts: params.contacts.map(contactBody),
    });
  }

  async updateContact(contactId: string, params: UpdateContactParams): Promise<void> {
    const body = contactBody(params);
    if (Object.keys(body).length === 0) {
      throw new Error('updateContact requires at least one update field');
    }
    await this.client.patch(`/contacts/${encodeURIComponent(contactId)}`, body);
  }

  async updateContactsBatch(params: BatchContactsParams<UpdateContactParams>): Promise<unknown> {
    return this.client.patch('/contacts/batch', {
      contacts: params.contacts.map(contactBody),
    });
  }

  async deleteContact(contactId: string): Promise<void> {
    await this.client.delete(`/contacts/${encodeURIComponent(contactId)}`);
  }

  async getContactProperties(): Promise<PaginatedResponse<ContactProperty>> {
    return this.client.get<PaginatedResponse<ContactProperty>>('/contact-properties');
  }

  async getContactViewedPages(contactId: string): Promise<unknown> {
    return this.client.get(`/contacts/${encodeURIComponent(contactId)}/viewed-pages`);
  }

  async listContactMessages(
    contactId: string,
    params: ListContactMessagesParams = {},
  ): Promise<PaginatedResponse<ContactMessage>> {
    return this.client.get<PaginatedResponse<ContactMessage>>(
      `/contacts/${encodeURIComponent(contactId)}/messages`,
      {
        cursor: params.cursor,
      },
    );
  }

  async sendContactMessage(contactId: string, params: SendContactMessageParams): Promise<MessageAccepted> {
    return this.client.post<MessageAccepted>(`/contacts/${encodeURIComponent(contactId)}/messages`, {
      message: params.message,
    });
  }

  async listOperators(): Promise<PaginatedResponse<Operator>> {
    return this.client.get<PaginatedResponse<Operator>>('/operators');
  }

  async listDepartments(): Promise<PaginatedResponse<Department>> {
    return this.client.get<PaginatedResponse<Department>>('/departments');
  }

  async getProject(): Promise<Project> {
    return this.client.get<Project>('/project');
  }

  async listTickets(params: ListTicketsParams = {}): Promise<PaginatedResponse<Ticket>> {
    return this.client.get<PaginatedResponse<Ticket>>('/tickets', {
      limit: params.limit,
      cursor: params.cursor,
      status: params.status,
      priority: params.priority,
    });
  }

  async getTicket(ticketId: string): Promise<Ticket> {
    return this.client.get<Ticket>(`/tickets/${encodeURIComponent(ticketId)}`);
  }

  async createTicketAsContact(params: CreateTicketAsContactParams): Promise<UuidResponse> {
    return this.client.post<UuidResponse>('/tickets/as-contact', {
      contact_id: params.contactId,
      message: params.message,
      subject: params.subject,
      priority: params.priority,
    });
  }

  async updateTicket(ticketId: string, params: UpdateTicketParams): Promise<Ticket> {
    return this.client.patch<Ticket>(
      `/tickets/${encodeURIComponent(ticketId)}`,
      compactRecord({
        status: params.status,
        priority: params.priority,
        assignee_id: params.assigneeId,
        department_id: params.departmentId,
      }),
    );
  }

  async replyToTicket(ticketId: string, params: ReplyTicketParams): Promise<UuidResponse> {
    return this.client.post<UuidResponse>(`/tickets/${encodeURIComponent(ticketId)}/reply`, {
      message: params.message,
      author_type: params.authorType,
    });
  }

  async deleteTicket(ticketId: string): Promise<void> {
    await this.client.delete(`/tickets/${encodeURIComponent(ticketId)}`);
  }

  async getTicketTags(): Promise<TicketTag[]> {
    return this.client.get<TicketTag[]>('/tickets/tags');
  }

  async getTicketCustomFields(): Promise<TicketCustomField[]> {
    return this.client.get<TicketCustomField[]>('/tickets/custom-fields');
  }

  async upsertProducts(products: Product[]): Promise<unknown> {
    return this.client.put('/products/batch', { products });
  }

  async deleteProduct(productId: string): Promise<void> {
    await this.client.delete(`/products/${encodeURIComponent(productId)}`);
  }

  async listLyroDataSources(params: ListLyroDataSourcesParams = {}): Promise<PaginatedResponse<LyroDataSource>> {
    return this.client.get<PaginatedResponse<LyroDataSource>>('/lyro/data-sources', {
      cursor: params.cursor,
      limit: params.limit,
      kind: params.kind,
      parent_id: params.parentId ?? undefined,
    });
  }

  async createLyroQaDataSource(params: CreateLyroQaDataSourceParams): Promise<UuidResponse> {
    return this.client.post<UuidResponse>(
      '/lyro/data-sources/qa',
      compactRecord({
        question: params.question,
        answer: params.answer,
        parent_id: params.parentId,
      }),
    );
  }

  async updateLyroQaDataSource(dataSourceId: string, params: CreateLyroQaDataSourceParams): Promise<unknown> {
    return this.client.put(`/lyro/data-sources/qa/${encodeURIComponent(dataSourceId)}`, {
      question: params.question,
      answer: params.answer,
      parent_id: params.parentId,
    });
  }

  async upsertLyroWebsiteDataSource(params: UpsertLyroWebsiteDataSourceParams): Promise<unknown> {
    return this.client.put(
      '/lyro/data-sources/website',
      compactRecord({
        url: params.url,
        title: params.title,
        content: params.content,
      }),
    );
  }

  async scrapeLyroWebsiteDataSource(params: ScrapeLyroWebsiteParams): Promise<UuidResponse> {
    return this.client.post<UuidResponse>('/lyro/data-sources/website/scrape', {
      url: params.url,
    });
  }

  async askLyroToAnswerTicket(params: AskLyroTicketParams): Promise<unknown> {
    return this.client.post('/lyro/tickets', {
      ticket_id: params.ticketId,
      subject: params.subject,
      contact_email: params.contactEmail,
      contact_name: params.contactName,
      recipient_email: params.recipientEmail,
      messages: params.messages,
    });
  }
}

export { TidioClient } from './client';
