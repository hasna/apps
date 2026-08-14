import type { SnapClient } from './client';
import type {
  Segment,
  SegmentCreateParams,
  SegmentUpdateParams,
  SegmentResponse,
  SAMUploadParams,
  LookalikeCreateParams,
  RetentionInDays,
} from '../types';

/**
 * Snapchat Audiences/Segments API
 * Manage custom audiences and segments
 */
export class AudiencesApi {
  constructor(private readonly client: SnapClient) {}

  /**
   * List all segments for an ad account
   */
  async list(adAccountId: string): Promise<Segment[]> {
    const response = await this.client.get<SegmentResponse>(
      `/adaccounts/${adAccountId}/segments`
    );
    return response.segments?.map(s => s.segment) || [];
  }

  /**
   * Get a specific segment by ID
   */
  async get(segmentId: string): Promise<Segment> {
    const response = await this.client.get<SegmentResponse>(`/segments/${segmentId}`);
    const segment = response.segments?.[0]?.segment;
    if (!segment) {
      throw new Error(`Segment ${segmentId} not found`);
    }
    return segment;
  }

  /**
   * Create a new segment
   */
  async create(params: SegmentCreateParams): Promise<Segment> {
    const response = await this.client.post<SegmentResponse>(
      `/adaccounts/${params.ad_account_id}/segments`,
      {
        segments: [params],
      }
    );
    const segment = response.segments?.[0]?.segment;
    if (!segment) {
      throw new Error('Failed to create segment');
    }
    return segment;
  }

  /**
   * Update a segment
   */
  async update(segmentId: string, params: SegmentUpdateParams): Promise<Segment> {
    const response = await this.client.put<SegmentResponse>(
      `/segments/${segmentId}`,
      {
        segments: [{ id: segmentId, ...params }],
      }
    );
    const segment = response.segments?.[0]?.segment;
    if (!segment) {
      throw new Error('Failed to update segment');
    }
    return segment;
  }

  /**
   * Delete a segment
   */
  async delete(segmentId: string): Promise<void> {
    await this.client.delete(`/segments/${segmentId}`);
  }

  /**
   * Upload user data to a SAM (Snap Audience Match) segment
   */
  async uploadSAMData(segmentId: string, params: SAMUploadParams): Promise<void> {
    await this.client.post(
      `/segments/${segmentId}/users`,
      {
        users: params.data.map(row => ({
          schema: params.schema,
          data: row,
        })),
      }
    );
  }

  /**
   * Remove user data from a SAM segment
   */
  async removeSAMData(segmentId: string, params: SAMUploadParams): Promise<void> {
    await this.client.delete(`/segments/${segmentId}/users`);
  }

  /**
   * Create a lookalike audience from a seed segment
   */
  async createLookalike(params: LookalikeCreateParams): Promise<Segment> {
    const response = await this.client.post<SegmentResponse>(
      `/adaccounts/${params.ad_account_id}/segments`,
      {
        segments: [{
          name: params.name,
          ad_account_id: params.ad_account_id,
          source_type: 'LOOKALIKE',
          seed_segment_id: params.seed_segment_id,
          lookalike_spec: {
            country: params.country,
            type: params.type,
          },
        }],
      }
    );
    const segment = response.segments?.[0]?.segment;
    if (!segment) {
      throw new Error('Failed to create lookalike audience');
    }
    return segment;
  }

  /**
   * Create a pixel-based retargeting segment
   */
  async createPixelSegment(
    adAccountId: string,
    name: string,
    pixelId: string,
    options?: {
      description?: string;
      retentionInDays?: RetentionInDays;
      eventType?: string;
    }
  ): Promise<Segment> {
    return this.create({
      name,
      ad_account_id: adAccountId,
      source_type: 'PIXEL',
      description: options?.description,
      retention_in_days: options?.retentionInDays,
    });
  }

  /**
   * Create an engagement segment (users who engaged with ads)
   */
  async createEngagementSegment(
    adAccountId: string,
    name: string,
    options?: {
      description?: string;
      retentionInDays?: RetentionInDays;
    }
  ): Promise<Segment> {
    return this.create({
      name,
      ad_account_id: adAccountId,
      source_type: 'ENGAGEMENT',
      description: options?.description,
      retention_in_days: options?.retentionInDays,
    });
  }

  /**
   * Create a first-party data segment (email/phone/MAID)
   */
  async createFirstPartySegment(
    adAccountId: string,
    name: string,
    sourceType: 'EMAIL' | 'PHONE' | 'MOBILE_AD_ID',
    options?: {
      description?: string;
      retentionInDays?: RetentionInDays;
    }
  ): Promise<Segment> {
    return this.create({
      name,
      ad_account_id: adAccountId,
      source_type: sourceType,
      description: options?.description,
      retention_in_days: options?.retentionInDays,
    });
  }

  /**
   * Get segment approximate size
   */
  async getSize(segmentId: string): Promise<number | undefined> {
    const segment = await this.get(segmentId);
    return segment.approximate_count;
  }

  /**
   * Check if segment is ready for targeting
   */
  async isTargetable(segmentId: string): Promise<boolean> {
    const segment = await this.get(segmentId);
    return segment.targetable_status === 'READY';
  }
}
