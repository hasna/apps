import type { AWSClient } from './client';
import type {
  SesEmailIdentity,
  SesSendEmailRequest,
  SesSendEmailResponse,
  SesListIdentitiesResponse,
  SesCreateIdentityResponse,
  SesDkimAttributes,
  SesSendStatistics,
  SesSuppressedDestination,
  SesSuppressedDestinationsResponse,
} from '../types';

/**
 * SES v2 API client
 */
export class AwsAwsSesApi {
  private readonly client: AWSClient;

  constructor(client: AWSClient) {
    this.client = client;
  }

  /**
   * Send a transactional email
   */
  async sendEmail(opts: SesSendEmailRequest): Promise<SesSendEmailResponse> {
    const body: Record<string, unknown> = {
      FromEmailAddress: opts.from,
      Destination: {
        ToAddresses: Array.isArray(opts.to) ? opts.to : [opts.to],
        ...(opts.cc && { CcAddresses: Array.isArray(opts.cc) ? opts.cc : [opts.cc] }),
        ...(opts.bcc && { BccAddresses: Array.isArray(opts.bcc) ? opts.bcc : [opts.bcc] }),
      },
      Content: {
        Simple: {
          Subject: {
            Data: opts.subject,
            Charset: 'UTF-8',
          },
          Body: {
            ...(opts.html && {
              Html: {
                Data: opts.html,
                Charset: 'UTF-8',
              },
            }),
            ...(opts.text && {
              Text: {
                Data: opts.text,
                Charset: 'UTF-8',
              },
            }),
          },
          ...(opts.attachments && opts.attachments.length > 0 && {
            Attachments: opts.attachments.map(att => ({
              FileName: att.filename,
              Data: att.data,
              ContentType: att.contentType,
            })),
          }),
        },
      },
      ...(opts.replyTo && { ReplyToAddresses: Array.isArray(opts.replyTo) ? opts.replyTo : [opts.replyTo] }),
    };

    const response = await this.client.request<{ MessageId: string }>('/v2/email/outbound-emails', {
      method: 'POST',
      service: 'sesv2',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });

    return {
      messageId: response.MessageId,
    };
  }

  /**
   * List verified email/domain identities
   */
  async listIdentities(type?: 'EMAIL_ADDRESS' | 'DOMAIN'): Promise<SesListIdentitiesResponse> {
    const params: Record<string, string | number | boolean | undefined> = {
      ...(type && { IdentityType: type }),
    };

    const response = await this.client.request<{
      EmailIdentities?: Array<{
        IdentityName?: string;
        IdentityType?: string;
        SendingEnabled?: boolean;
        VerificationStatus?: string;
      }>;
      NextToken?: string;
    }>('/v2/email/identities', {
      method: 'GET',
      service: 'sesv2',
      params,
      headers: {
        'Content-Type': 'application/json',
      },
    });

    return {
      identities: (response.EmailIdentities || []).map(identity => ({
        identityName: identity.IdentityName || '',
        identityType: (identity.IdentityType as 'EMAIL_ADDRESS' | 'DOMAIN') || 'EMAIL_ADDRESS',
        sendingEnabled: identity.SendingEnabled ?? false,
        verificationStatus: identity.VerificationStatus || 'NOT_STARTED',
      })),
      nextToken: response.NextToken,
    };
  }

  /**
   * Create (verify) an email address or domain identity
   */
  async createIdentity(identity: string): Promise<SesCreateIdentityResponse> {
    const response = await this.client.request<{
      IdentityType?: string;
      VerifiedForSendingStatus?: boolean;
      DkimAttributes?: {
        SigningEnabled?: boolean;
        Status?: string;
        Tokens?: string[];
        SigningAttributesOrigin?: string;
        NextSigningKeyLength?: string;
        CurrentSigningKeyLength?: string;
        LastKeyGenerationTimestamp?: string;
      };
    }>('/v2/email/identities', {
      method: 'POST',
      service: 'sesv2',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ EmailIdentity: identity }),
    });

    return {
      identityType: (response.IdentityType as 'EMAIL_ADDRESS' | 'DOMAIN') || 'EMAIL_ADDRESS',
      verifiedForSendingStatus: response.VerifiedForSendingStatus ?? false,
      dkimAttributes: response.DkimAttributes
        ? {
            signingEnabled: response.DkimAttributes.SigningEnabled ?? false,
            status: response.DkimAttributes.Status || 'NOT_STARTED',
            tokens: response.DkimAttributes.Tokens || [],
          }
        : undefined,
    };
  }

  /**
   * Delete an email address or domain identity
   */
  async deleteIdentity(identity: string): Promise<void> {
    await this.client.request<Record<string, never>>(
      `/v2/email/identities/${encodeURIComponent(identity)}`,
      {
        method: 'DELETE',
        service: 'sesv2',
        headers: {
          'Content-Type': 'application/json',
        },
      }
    );
  }

  /**
   * Get DKIM signing attributes and DNS records for a domain identity
   */
  async getDkimAttributes(identity: string): Promise<SesDkimAttributes> {
    const response = await this.client.request<{
      DkimAttributes?: {
        SigningEnabled?: boolean;
        Status?: string;
        Tokens?: string[];
        SigningAttributesOrigin?: string;
        NextSigningKeyLength?: string;
        CurrentSigningKeyLength?: string;
        LastKeyGenerationTimestamp?: string;
      };
      IdentityType?: string;
      FeedbackForwardingStatus?: boolean;
      VerifiedForSendingStatus?: boolean;
    }>(`/v2/email/identities/${encodeURIComponent(identity)}`, {
      method: 'GET',
      service: 'sesv2',
      headers: {
        'Content-Type': 'application/json',
      },
    });

    const dkim = response.DkimAttributes || {};
    const region = this.client.getRegion();
    const tokens = dkim.Tokens || [];

    return {
      signingEnabled: dkim.SigningEnabled ?? false,
      status: dkim.Status || 'NOT_STARTED',
      tokens,
      signingAttributesOrigin: dkim.SigningAttributesOrigin || 'AWS_SES',
      dnsRecords: tokens.map(token => ({
        name: `${token}._domainkey.${identity}`,
        type: 'CNAME',
        value: `${token}.dkim.amazonses.com`,
        region,
      })),
    };
  }

  /**
   * Get send statistics for a given period
   */
  async getStatistics(period?: string): Promise<SesSendStatistics> {
    const response = await this.client.request<{
      SendDataPoints?: Array<{
        Timestamp?: string;
        DeliveryAttempts?: number;
        Bounces?: number;
        Complaints?: number;
        Rejects?: number;
      }>;
    }>('/v2/email/account/sending-statistics', {
      method: 'GET',
      service: 'sesv2',
      headers: {
        'Content-Type': 'application/json',
      },
    });

    const dataPoints = response.SendDataPoints || [];

    // Filter by period if provided (period is expected as ISO duration or cutoff date string)
    let filtered = dataPoints;
    if (period) {
      const cutoff = new Date(period);
      if (!isNaN(cutoff.getTime())) {
        filtered = dataPoints.filter(dp => dp.Timestamp && new Date(dp.Timestamp) >= cutoff);
      }
    }

    // Aggregate totals
    const totals = filtered.reduce(
      (acc, dp) => ({
        deliveryAttempts: acc.deliveryAttempts + (dp.DeliveryAttempts || 0),
        bounces: acc.bounces + (dp.Bounces || 0),
        complaints: acc.complaints + (dp.Complaints || 0),
        rejects: acc.rejects + (dp.Rejects || 0),
      }),
      { deliveryAttempts: 0, bounces: 0, complaints: 0, rejects: 0 }
    );

    return {
      ...totals,
      dataPoints: filtered.map(dp => ({
        timestamp: dp.Timestamp || '',
        deliveryAttempts: dp.DeliveryAttempts || 0,
        bounces: dp.Bounces || 0,
        complaints: dp.Complaints || 0,
        rejects: dp.Rejects || 0,
      })),
    };
  }

  /**
   * List suppression list entries
   */
  async getSuppressedDestinations(options?: {
    reasons?: Array<'BOUNCE' | 'COMPLAINT'>;
    startDate?: string;
    endDate?: string;
    nextToken?: string;
    pageSize?: number;
  }): Promise<SesSuppressedDestinationsResponse> {
    const params: Record<string, string | number | boolean | undefined> = {
      ...(options?.reasons && { Reason: options.reasons.join(',') }),
      ...(options?.startDate && { StartDate: options.startDate }),
      ...(options?.endDate && { EndDate: options.endDate }),
      ...(options?.nextToken && { NextToken: options.nextToken }),
      ...(options?.pageSize && { PageSize: options.pageSize }),
    };

    const response = await this.client.request<{
      SuppressedDestinationSummaries?: Array<{
        EmailAddress?: string;
        Reason?: string;
        LastUpdateTime?: string;
      }>;
      NextToken?: string;
    }>('/v2/email/suppression/addresses', {
      method: 'GET',
      service: 'sesv2',
      params,
      headers: {
        'Content-Type': 'application/json',
      },
    });

    return {
      suppressedDestinations: (response.SuppressedDestinationSummaries || []).map(entry => ({
        emailAddress: entry.EmailAddress || '',
        reason: (entry.Reason as 'BOUNCE' | 'COMPLAINT') || 'BOUNCE',
        lastUpdateTime: entry.LastUpdateTime || '',
      })),
      nextToken: response.NextToken,
    };
  }
}
