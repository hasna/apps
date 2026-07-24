import type { TrustpilotClient } from './client';
import type { CreateInvitationLinkOptions, SendInvitationEmailOptions } from '../types';

export class InvitationsApi {
  constructor(private readonly client: TrustpilotClient) {}

  async createLink(options: CreateInvitationLinkOptions): Promise<unknown> {
    return this.client.post(`/private/business-units/${encodeURIComponent(options.businessUnitId)}/invitation-links`, {
      consumerEmail: options.consumer.email,
      consumerName: options.consumer.name,
      locale: options.locale,
      referenceId: options.referenceId,
      productSkus: options.productSkus,
      tags: options.tags,
    });
  }

  async sendEmail(options: SendInvitationEmailOptions): Promise<unknown> {
    return this.client.post(`/private/business-units/${encodeURIComponent(options.businessUnitId)}/invitations`, {
      consumerEmail: options.consumerEmail,
      consumerName: options.consumerName,
      locale: options.locale,
      referenceId: options.referenceId,
      replyTo: options.replyTo,
      senderEmail: options.senderEmail,
      senderName: options.senderName,
      tags: options.tags,
      templateId: options.templateId,
      preferredSendTime: options.preferredSendTime,
    });
  }

  async listTemplates(businessUnitId: string): Promise<unknown> {
    return this.client.get(`/private/business-units/${encodeURIComponent(businessUnitId)}/templates`);
  }
}
