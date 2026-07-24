import type { WatiClient } from './client';
import type {
  GetMessagesParams,
  GetMediaFileParams,
  SendInteractiveButtonsMessageParams,
  SendInteractiveListMessageParams,
  SendSessionFileParams,
  SendSessionMessageParams,
  SendTemplateMessageParams,
  SendTemplateMessagesParams,
  WatiApiResponse,
} from '../types';

export class MessagesApi {
  constructor(private readonly client: WatiClient) {}

  async sendSessionMessage(params: SendSessionMessageParams): Promise<WatiApiResponse> {
    const { whatsappNumber, messageText } = params;
    return this.client.post<WatiApiResponse>(
      `/api/v1/sendSessionMessage/${encodeURIComponent(whatsappNumber)}`,
      undefined,
      { messageText },
    );
  }

  async sendSessionFile(params: SendSessionFileParams): Promise<WatiApiResponse> {
    const { whatsappNumber, fileUrl, caption } = params;
    return this.client.post<WatiApiResponse>(
      `/api/v1/sendSessionFile/${encodeURIComponent(whatsappNumber)}`,
      { url: fileUrl, caption },
    );
  }

  async sendTemplateMessage(params: SendTemplateMessageParams): Promise<WatiApiResponse> {
    const { whatsappNumber, templateName, broadcastName, parameters, channelNumber } = params;
    return this.client.post<WatiApiResponse>(
      '/api/v1/sendTemplateMessage',
      {
        template_name: templateName,
        broadcast_name: broadcastName ?? templateName,
        parameters: parameters ?? [],
        channel_number: channelNumber,
      },
      { whatsappNumber },
    );
  }

  async sendTemplateMessages(params: SendTemplateMessagesParams): Promise<WatiApiResponse> {
    const { templateName, broadcastName, receivers, channelNumber } = params;
    return this.client.post<WatiApiResponse>('/api/v1/sendTemplateMessages', {
      template_name: templateName,
      broadcast_name: broadcastName,
      receivers,
      channel_number: channelNumber,
    });
  }

  async sendInteractiveButtonsMessage(params: SendInteractiveButtonsMessageParams): Promise<WatiApiResponse> {
    const { whatsappNumber, header, body, footer, buttons } = params;
    return this.client.post<WatiApiResponse>(
      '/api/v1/sendInteractiveButtonsMessage',
      { header, body, footer, buttons },
      { whatsappNumber },
    );
  }

  async sendInteractiveListMessage(params: SendInteractiveListMessageParams): Promise<WatiApiResponse> {
    const { whatsappNumber, header, body, footer, buttonText, sections } = params;
    return this.client.post<WatiApiResponse>(
      '/api/v1/sendInteractiveListMessage',
      { header, body, footer, buttonText, sections },
      { whatsappNumber },
    );
  }

  async getMessages(params: GetMessagesParams): Promise<WatiApiResponse> {
    const { whatsappNumber, ...query } = params;
    return this.client.get<WatiApiResponse>(
      `/api/v1/getMessages/${encodeURIComponent(whatsappNumber)}`,
      query,
    );
  }

  async getMediaFile(params: GetMediaFileParams): Promise<WatiApiResponse> {
    return this.client.get<WatiApiResponse>('/api/v1/getMedia', {
      fileName: params.fileName,
    });
  }
}
