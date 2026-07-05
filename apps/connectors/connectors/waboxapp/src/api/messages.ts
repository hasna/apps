import type { WaboxappClient } from './client';
import type {
  SendChatParams,
  SendImageParams,
  SendLinkParams,
  SendMediaParams,
  WaboxappSendResponse,
} from '../types';

function toBody(params: Record<string, string | number | boolean | undefined>): Record<string, string | number | boolean | undefined> {
  return params;
}

export class MessagesApi {
  constructor(private readonly client: WaboxappClient) {}

  async sendChat(params: SendChatParams): Promise<WaboxappSendResponse> {
    const uid = params.uid ?? this.client.getUid();
    return this.client.post<WaboxappSendResponse>('/send/chat', toBody({ ...params, uid }));
  }

  async sendImage(params: SendImageParams): Promise<WaboxappSendResponse> {
    const uid = params.uid ?? this.client.getUid();
    return this.client.post<WaboxappSendResponse>('/send/image', toBody({ ...params, uid }));
  }

  async sendLink(params: SendLinkParams): Promise<WaboxappSendResponse> {
    const uid = params.uid ?? this.client.getUid();
    return this.client.post<WaboxappSendResponse>('/send/link', toBody({ ...params, uid }));
  }

  async sendMedia(params: SendMediaParams): Promise<WaboxappSendResponse> {
    const uid = params.uid ?? this.client.getUid();
    return this.client.post<WaboxappSendResponse>('/send/media', toBody({ ...params, uid }));
  }
}
