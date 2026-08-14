import type { ConnectorClient } from './client';
import { encodePathSegment } from './client';
import type {
  AnonymousConversationHistoryParams,
  ConversationHistoryParams,
  ListConversationsParams,
  SendMessageParams,
} from '../types';

export class ChatApi {
  constructor(private readonly client: ConnectorClient) {}

  async sendMessage(params: SendMessageParams = {}): Promise<unknown> {
    const { identity_token, model, subdomain, ...rest } = params;
    const body = this.client.withProductBody({
      ...rest,
      ...(identity_token !== undefined ? { identity_token } : {}),
      ...(model !== undefined ? { model } : {}),
      ...(subdomain !== undefined ? { subdomain } : {}),
    });
    return this.client.post('/api/chat/message', body);
  }

  async listConversations(params: ListConversationsParams = {}): Promise<unknown> {
    const { identity_token, ...query } = params;
    return this.client.get('/api/chat/conversations', this.client.identityQuery({
      ...query,
      ...(identity_token !== undefined ? { identity_token } : {}),
    }));
  }

  async getConversationHistory(params: ConversationHistoryParams): Promise<unknown> {
    const { conversationId, identity_token, ...query } = params;
    const path = `/api/chat/conversations/${encodePathSegment(conversationId)}/history`;
    return this.client.get(path, this.client.identityQuery({
      ...query,
      ...(identity_token !== undefined ? { identity_token } : {}),
    }));
  }

  async getAnonymousConversationHistory(params: AnonymousConversationHistoryParams): Promise<unknown> {
    const { conversationId, ...query } = params;
    const path = `/api/chat/conversations/${encodePathSegment(conversationId)}/history/anonymous`;
    return this.client.get(path, this.client.productQuery(query));
  }
}
