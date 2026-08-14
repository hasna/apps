import type { ConnectorClient } from './client';
import type { Case, CaseCreateParams, CaseReopenParams, ChatMessageParams, EmailMessageParams, SmsMessageParams, ListParams } from '../types';

export class CasesApi {
  constructor(private readonly client: ConnectorClient) {}

  async list(params?: ListParams): Promise<unknown> {
    const queryParams: Record<string, string | number | boolean | undefined> = {};
    if (params?.limit) queryParams.limit = params.limit;
    if (params?.where) queryParams.where = params.where;
    if (params?.relations) queryParams.relations = params.relations;
    return this.client.get<unknown>('/crm/objects/case', queryParams);
  }

  async create(params: CaseCreateParams): Promise<Case> {
    return this.client.post<Case>('/crm/messenger/chat/create', undefined, {
      contactId: String(params.contactId),
    });
  }

  async reopen(params: CaseReopenParams): Promise<Case> {
    return this.client.post<Case>('/crm/messenger/chat/create', {
      sessionId: params.sessionId,
      threadId: params.threadId,
    }, {
      contactId: String(params.contactId),
    });
  }

  async sendMessage(params: ChatMessageParams): Promise<unknown> {
    return this.client.post<unknown>('/crm/messenger/chat/add-message', params);
  }

  async sendEmail(params: EmailMessageParams): Promise<unknown> {
    return this.client.post<unknown>('/mail/add-message', params);
  }

  async sendSms(params: SmsMessageParams): Promise<unknown> {
    return this.client.post<unknown>('/voip/send-sms', params);
  }

  async deleteMessage(messageId: number): Promise<void> {
    await this.client.delete(`/crm/objects/case-message/${messageId}`);
  }
}
