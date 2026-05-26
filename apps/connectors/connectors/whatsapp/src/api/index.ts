// WhatsApp Business Cloud Connector
// Send messages, manage templates, and handle webhooks

import { WhatsAppClient } from './client';
import type {
  WhatsAppConfig,
  SendMessageInput,
  SendMessageResponse,
  BusinessProfile,
  PhoneNumber,
  PhoneNumbersResponse,
  MessageTemplate,
  MessageTemplatesResponse,
  MediaObject,
  TextMessage,
  Media,
  Location,
  Contact,
  Interactive,
  Template,
  Reaction,
} from '../types';

export { WhatsAppClient } from './client';

export class WhatsApp {
  private client: WhatsAppClient;

  constructor(config: WhatsAppConfig) {
    this.client = new WhatsAppClient(config);
  }

  // ============================================
  // Message Operations
  // ============================================

  async sendMessage(input: SendMessageInput): Promise<SendMessageResponse> {
    const phoneNumberId = this.client.getPhoneNumberId();
    return this.client.post<SendMessageResponse>(
      `/${phoneNumberId}/messages`,
      input as unknown as Record<string, unknown>
    );
  }

  async sendText(to: string, text: string, options?: {
    previewUrl?: boolean;
    replyToMessageId?: string;
  }): Promise<SendMessageResponse> {
    const message: SendMessageInput = {
      messaging_product: 'whatsapp',
      to,
      type: 'text',
      text: {
        body: text,
        preview_url: options?.previewUrl,
      },
    };
    if (options?.replyToMessageId) {
      message.context = { message_id: options.replyToMessageId };
    }
    return this.sendMessage(message);
  }

  async sendImage(to: string, image: Media, options?: {
    replyToMessageId?: string;
  }): Promise<SendMessageResponse> {
    const message: SendMessageInput = {
      messaging_product: 'whatsapp',
      to,
      type: 'image',
      image,
    };
    if (options?.replyToMessageId) {
      message.context = { message_id: options.replyToMessageId };
    }
    return this.sendMessage(message);
  }

  async sendAudio(to: string, audio: Media, options?: {
    replyToMessageId?: string;
  }): Promise<SendMessageResponse> {
    const message: SendMessageInput = {
      messaging_product: 'whatsapp',
      to,
      type: 'audio',
      audio,
    };
    if (options?.replyToMessageId) {
      message.context = { message_id: options.replyToMessageId };
    }
    return this.sendMessage(message);
  }

  async sendVideo(to: string, video: Media, options?: {
    replyToMessageId?: string;
  }): Promise<SendMessageResponse> {
    const message: SendMessageInput = {
      messaging_product: 'whatsapp',
      to,
      type: 'video',
      video,
    };
    if (options?.replyToMessageId) {
      message.context = { message_id: options.replyToMessageId };
    }
    return this.sendMessage(message);
  }

  async sendDocument(to: string, document: Media, options?: {
    replyToMessageId?: string;
  }): Promise<SendMessageResponse> {
    const message: SendMessageInput = {
      messaging_product: 'whatsapp',
      to,
      type: 'document',
      document,
    };
    if (options?.replyToMessageId) {
      message.context = { message_id: options.replyToMessageId };
    }
    return this.sendMessage(message);
  }

  async sendSticker(to: string, sticker: Media, options?: {
    replyToMessageId?: string;
  }): Promise<SendMessageResponse> {
    const message: SendMessageInput = {
      messaging_product: 'whatsapp',
      to,
      type: 'sticker',
      sticker,
    };
    if (options?.replyToMessageId) {
      message.context = { message_id: options.replyToMessageId };
    }
    return this.sendMessage(message);
  }

  async sendLocation(to: string, location: Location, options?: {
    replyToMessageId?: string;
  }): Promise<SendMessageResponse> {
    const message: SendMessageInput = {
      messaging_product: 'whatsapp',
      to,
      type: 'location',
      location,
    };
    if (options?.replyToMessageId) {
      message.context = { message_id: options.replyToMessageId };
    }
    return this.sendMessage(message);
  }

  async sendContacts(to: string, contacts: Contact[], options?: {
    replyToMessageId?: string;
  }): Promise<SendMessageResponse> {
    const message: SendMessageInput = {
      messaging_product: 'whatsapp',
      to,
      type: 'contacts',
      contacts,
    };
    if (options?.replyToMessageId) {
      message.context = { message_id: options.replyToMessageId };
    }
    return this.sendMessage(message);
  }

  async sendInteractive(to: string, interactive: Interactive, options?: {
    replyToMessageId?: string;
  }): Promise<SendMessageResponse> {
    const message: SendMessageInput = {
      messaging_product: 'whatsapp',
      to,
      type: 'interactive',
      interactive,
    };
    if (options?.replyToMessageId) {
      message.context = { message_id: options.replyToMessageId };
    }
    return this.sendMessage(message);
  }

  async sendTemplate(to: string, template: Template, options?: {
    replyToMessageId?: string;
  }): Promise<SendMessageResponse> {
    const message: SendMessageInput = {
      messaging_product: 'whatsapp',
      to,
      type: 'template',
      template,
    };
    if (options?.replyToMessageId) {
      message.context = { message_id: options.replyToMessageId };
    }
    return this.sendMessage(message);
  }

  async sendReaction(to: string, reaction: Reaction): Promise<SendMessageResponse> {
    const message: SendMessageInput = {
      messaging_product: 'whatsapp',
      to,
      type: 'reaction',
      reaction,
    };
    return this.sendMessage(message);
  }

  async markAsRead(messageId: string): Promise<{ success: boolean }> {
    const phoneNumberId = this.client.getPhoneNumberId();
    return this.client.post<{ success: boolean }>(
      `/${phoneNumberId}/messages`,
      {
        messaging_product: 'whatsapp',
        status: 'read',
        message_id: messageId,
      }
    );
  }

  // ============================================
  // Media Operations
  // ============================================

  async uploadMedia(file: Blob, mimeType: string, filename?: string): Promise<{ id: string }> {
    const phoneNumberId = this.client.getPhoneNumberId();
    const formData = new FormData();
    formData.append('file', file, filename);
    formData.append('messaging_product', 'whatsapp');
    formData.append('type', mimeType);

    // Note: This requires special handling for multipart/form-data
    // For now, return the endpoint info
    throw new Error('Media upload requires multipart/form-data. Use the API directly.');
  }

  async getMediaUrl(mediaId: string): Promise<MediaObject> {
    return this.client.get<MediaObject>(`/${mediaId}`);
  }

  async deleteMedia(mediaId: string): Promise<{ success: boolean }> {
    return this.client.delete<{ success: boolean }>(`/${mediaId}`);
  }

  // ============================================
  // Business Profile Operations
  // ============================================

  async getBusinessProfile(fields?: string[]): Promise<{ data: BusinessProfile[] }> {
    const phoneNumberId = this.client.getPhoneNumberId();
    const params: Record<string, string> = {};
    if (fields && fields.length > 0) {
      params.fields = fields.join(',');
    } else {
      params.fields = 'about,address,description,email,profile_picture_url,websites,vertical';
    }
    return this.client.get<{ data: BusinessProfile[] }>(
      `/${phoneNumberId}/whatsapp_business_profile`,
      params
    );
  }

  async updateBusinessProfile(profile: Partial<BusinessProfile>): Promise<{ success: boolean }> {
    const phoneNumberId = this.client.getPhoneNumberId();
    return this.client.post<{ success: boolean }>(
      `/${phoneNumberId}/whatsapp_business_profile`,
      {
        messaging_product: 'whatsapp',
        ...profile,
      }
    );
  }

  // ============================================
  // Phone Number Operations
  // ============================================

  async getPhoneNumber(): Promise<PhoneNumber> {
    const phoneNumberId = this.client.getPhoneNumberId();
    return this.client.get<PhoneNumber>(`/${phoneNumberId}`);
  }

  async listPhoneNumbers(): Promise<PhoneNumbersResponse> {
    const businessAccountId = this.client.getBusinessAccountId();
    if (!businessAccountId) {
      throw new Error('Business account ID is required to list phone numbers');
    }
    return this.client.get<PhoneNumbersResponse>(`/${businessAccountId}/phone_numbers`);
  }

  async requestVerificationCode(codeMethod: 'SMS' | 'VOICE', language: string): Promise<{ success: boolean }> {
    const phoneNumberId = this.client.getPhoneNumberId();
    return this.client.post<{ success: boolean }>(
      `/${phoneNumberId}/request_code`,
      {
        code_method: codeMethod,
        language,
      }
    );
  }

  async verifyCode(code: string): Promise<{ success: boolean }> {
    const phoneNumberId = this.client.getPhoneNumberId();
    return this.client.post<{ success: boolean }>(
      `/${phoneNumberId}/verify_code`,
      { code }
    );
  }

  // ============================================
  // Template Operations
  // ============================================

  async listTemplates(options?: {
    limit?: number;
    after?: string;
  }): Promise<MessageTemplatesResponse> {
    const businessAccountId = this.client.getBusinessAccountId();
    if (!businessAccountId) {
      throw new Error('Business account ID is required to list templates');
    }
    const params: Record<string, string | number> = {};
    if (options?.limit) {
      params.limit = options.limit;
    }
    if (options?.after) {
      params.after = options.after;
    }
    return this.client.get<MessageTemplatesResponse>(
      `/${businessAccountId}/message_templates`,
      params
    );
  }

  async getTemplate(templateId: string): Promise<MessageTemplate> {
    return this.client.get<MessageTemplate>(`/${templateId}`);
  }

  async deleteTemplate(templateName: string): Promise<{ success: boolean }> {
    const businessAccountId = this.client.getBusinessAccountId();
    if (!businessAccountId) {
      throw new Error('Business account ID is required to delete templates');
    }
    return this.client.delete<{ success: boolean }>(
      `/${businessAccountId}/message_templates`,
      { name: templateName }
    );
  }

  // ============================================
  // Utility Methods
  // ============================================

  getClient(): WhatsAppClient {
    return this.client;
  }

  getPhoneNumberId(): string {
    return this.client.getPhoneNumberId();
  }

  getBusinessAccountId(): string | undefined {
    return this.client.getBusinessAccountId();
  }
}
