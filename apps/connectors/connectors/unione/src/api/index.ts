import { UniOneClient } from './client';
import type {
  UniOneConfig,
  SendEmailParams,
  SendEmailResponse,
  SubscribeEmailParams,
  SubscribeEmailResponse,
  ValidateEmailParams,
  ValidateEmailResponse,
  SetTemplateParams,
  SetTemplateResponse,
  GetTemplateParams,
  GetTemplateResponse,
  ListTemplatesParams,
  ListTemplatesResponse,
  ListWebhooksResponse,
  ListProjectsResponse,
} from '../types';

export { UniOneClient } from './client';

/**
 * UniOne transactional email API wrapper.
 * @see https://docs.unione.io/en/web-api-ref
 */
export class UniOne {
  private readonly client: UniOneClient;

  constructor(config: UniOneConfig) {
    this.client = new UniOneClient(config);
  }

  static fromEnv(): UniOne {
    const apiKey = process.env.UNIONE_API_KEY;
    if (!apiKey) {
      throw new Error('UNIONE_API_KEY is required');
    }
    return new UniOne({ apiKey });
  }

  getClient(): UniOneClient {
    return this.client;
  }

  async sendEmail(params: SendEmailParams): Promise<SendEmailResponse> {
    return this.client.request<SendEmailResponse>('/email/send.json', { body: params as unknown as Record<string, unknown> });
  }

  async subscribeEmail(params: SubscribeEmailParams): Promise<SubscribeEmailResponse> {
    return this.client.request<SubscribeEmailResponse>('/email/subscribe.json', { body: params as unknown as Record<string, unknown> });
  }

  async validateEmail(params: ValidateEmailParams): Promise<ValidateEmailResponse> {
    return this.client.request<ValidateEmailResponse>('/email-validation/single.json', { body: params as unknown as Record<string, unknown> });
  }

  async setTemplate(params: SetTemplateParams): Promise<SetTemplateResponse> {
    return this.client.request<SetTemplateResponse>('/template/set.json', { body: params as unknown as Record<string, unknown> });
  }

  async getTemplate(params: GetTemplateParams): Promise<GetTemplateResponse> {
    return this.client.request<GetTemplateResponse>('/template/get.json', { body: params as unknown as Record<string, unknown> });
  }

  async listTemplates(params: ListTemplatesParams = {}): Promise<ListTemplatesResponse> {
    return this.client.request<ListTemplatesResponse>('/template/list.json', { body: params as unknown as Record<string, unknown> });
  }

  async listWebhooks(): Promise<ListWebhooksResponse> {
    return this.client.request<ListWebhooksResponse>('/webhook/list.json');
  }

  async listProjects(): Promise<ListProjectsResponse> {
    return this.client.request<ListProjectsResponse>('/project/list.json');
  }
}
