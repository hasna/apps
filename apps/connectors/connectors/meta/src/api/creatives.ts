import type { MetaClient } from './client';
import type {
  AdCreative,
  AdCreativeCreateParams,
  AdCreativeListParams,
  AdImage,
  AdImageUploadParams,
  AdVideo,
  AdVideoCreateParams,
  PaginatedResponse,
} from '../types';
import { formatAdAccountId } from '../utils/config';

const DEFAULT_CREATIVE_FIELDS = [
  'id',
  'name',
  'account_id',
  'actor_id',
  'body',
  'call_to_action_type',
  'effective_object_story_id',
  'image_hash',
  'image_url',
  'link_url',
  'object_story_id',
  'object_story_spec',
  'object_type',
  'status',
  'thumbnail_url',
  'title',
  'url_tags',
  'video_id',
  'created_time',
];

const DEFAULT_IMAGE_FIELDS = [
  'id',
  'hash',
  'name',
  'account_id',
  'created_time',
  'height',
  'width',
  'original_height',
  'original_width',
  'permalink_url',
  'status',
  'url',
  'url_128',
];

const DEFAULT_VIDEO_FIELDS = [
  'id',
  'title',
  'description',
  'length',
  'picture',
  'source',
  'status',
  'thumbnails',
  'created_time',
  'updated_time',
];

/**
 * Meta Ad Creatives API
 * Create and manage ad creatives including images, videos, and carousels
 */
export class CreativesApi {
  constructor(private readonly client: MetaClient) {}

  // ============================================
  // Ad Creatives
  // ============================================

  /**
   * List ad creatives for an ad account
   */
  async list(adAccountId: string, params?: AdCreativeListParams): Promise<PaginatedResponse<AdCreative>> {
    const formattedId = formatAdAccountId(adAccountId);
    const fields = params?.fields || DEFAULT_CREATIVE_FIELDS;

    return this.client.get<PaginatedResponse<AdCreative>>(`/${formattedId}/adcreatives`, {
      fields: fields.join(','),
      limit: params?.limit,
      after: params?.after,
      before: params?.before,
    });
  }

  /**
   * Get a single ad creative by ID
   */
  async get(creativeId: string, fields?: string[]): Promise<AdCreative> {
    return this.client.get<AdCreative>(`/${creativeId}`, {
      fields: (fields || DEFAULT_CREATIVE_FIELDS).join(','),
    });
  }

  /**
   * Create a new ad creative
   */
  async create(adAccountId: string, params: AdCreativeCreateParams): Promise<{ id: string }> {
    const formattedId = formatAdAccountId(adAccountId);

    const body: Record<string, unknown> = { ...params };

    if (params.object_story_spec) {
      body.object_story_spec = JSON.stringify(params.object_story_spec);
    }

    return this.client.post<{ id: string }>(`/${formattedId}/adcreatives`, body);
  }

  /**
   * Update an ad creative (limited fields can be updated)
   */
  async update(creativeId: string, params: { name?: string; url_tags?: string }): Promise<{ success: boolean }> {
    return this.client.post<{ success: boolean }>(`/${creativeId}`, params as Record<string, unknown>);
  }

  /**
   * Delete an ad creative
   */
  async delete(creativeId: string): Promise<{ success: boolean }> {
    return this.client.delete<{ success: boolean }>(`/${creativeId}`);
  }

  // ============================================
  // Ad Images
  // ============================================

  /**
   * List ad images for an ad account
   */
  async listImages(adAccountId: string, params?: { fields?: string[]; limit?: number; after?: string; hashes?: string[] }): Promise<PaginatedResponse<AdImage>> {
    const formattedId = formatAdAccountId(adAccountId);
    const fields = params?.fields || DEFAULT_IMAGE_FIELDS;

    const queryParams: Record<string, string | number | boolean | string[] | undefined> = {
      fields: fields.join(','),
      limit: params?.limit,
      after: params?.after,
    };

    if (params?.hashes) {
      queryParams.hashes = JSON.stringify(params.hashes);
    }

    return this.client.get<PaginatedResponse<AdImage>>(`/${formattedId}/adimages`, queryParams);
  }

  /**
   * Get an ad image by hash
   */
  async getImage(adAccountId: string, imageHash: string): Promise<{ data: Record<string, AdImage> }> {
    const formattedId = formatAdAccountId(adAccountId);
    return this.client.get<{ data: Record<string, AdImage> }>(`/${formattedId}/adimages`, {
      hashes: JSON.stringify([imageHash]),
      fields: DEFAULT_IMAGE_FIELDS.join(','),
    });
  }

  /**
   * Upload an ad image (base64 encoded)
   */
  async uploadImage(adAccountId: string, params: AdImageUploadParams): Promise<{ images: Record<string, AdImage> }> {
    const formattedId = formatAdAccountId(adAccountId);

    const body: Record<string, unknown> = {};

    if (params.bytes) {
      body.bytes = params.bytes;
    }

    if (params.filename) {
      body.filename = params.filename;
    }

    if (params.copy_from) {
      body.copy_from = JSON.stringify(params.copy_from);
    }

    return this.client.post<{ images: Record<string, AdImage> }>(`/${formattedId}/adimages`, body);
  }

  /**
   * Delete an ad image
   */
  async deleteImage(adAccountId: string, imageHash: string): Promise<{ success: boolean }> {
    const formattedId = formatAdAccountId(adAccountId);
    return this.client.delete<{ success: boolean }>(`/${formattedId}/adimages`, {
      hash: imageHash,
    });
  }

  // ============================================
  // Ad Videos
  // ============================================

  /**
   * List ad videos for an ad account
   */
  async listVideos(adAccountId: string, params?: { fields?: string[]; limit?: number; after?: string }): Promise<PaginatedResponse<AdVideo>> {
    const formattedId = formatAdAccountId(adAccountId);
    const fields = params?.fields || DEFAULT_VIDEO_FIELDS;

    return this.client.get<PaginatedResponse<AdVideo>>(`/${formattedId}/advideos`, {
      fields: fields.join(','),
      limit: params?.limit,
      after: params?.after,
    });
  }

  /**
   * Get an ad video by ID
   */
  async getVideo(videoId: string, fields?: string[]): Promise<AdVideo> {
    return this.client.get<AdVideo>(`/${videoId}`, {
      fields: (fields || DEFAULT_VIDEO_FIELDS).join(','),
    });
  }

  /**
   * Create an ad video from URL
   */
  async createVideo(adAccountId: string, params: AdVideoCreateParams): Promise<{ id: string }> {
    const formattedId = formatAdAccountId(adAccountId);

    const body: Record<string, unknown> = {};

    if (params.file_url) {
      body.file_url = params.file_url;
    }

    if (params.title) {
      body.title = params.title;
    }

    if (params.description) {
      body.description = params.description;
    }

    return this.client.post<{ id: string }>(`/${formattedId}/advideos`, body);
  }

  /**
   * Get video thumbnails
   */
  async getVideoThumbnails(videoId: string): Promise<{ data: { id: string; height: number; width: number; uri: string }[] }> {
    return this.client.get<{ data: { id: string; height: number; width: number; uri: string }[] }>(`/${videoId}/thumbnails`);
  }

  // ============================================
  // Creative Helpers
  // ============================================

  /**
   * Create a single image creative
   */
  async createImageCreative(adAccountId: string, params: {
    name: string;
    pageId: string;
    imageHash: string;
    message: string;
    link: string;
    callToAction?: string;
  }): Promise<{ id: string }> {
    return this.create(adAccountId, {
      name: params.name,
      object_story_spec: {
        page_id: params.pageId,
        link_data: {
          link: params.link,
          message: params.message,
          image_hash: params.imageHash,
          call_to_action: params.callToAction ? {
            type: params.callToAction as 'LEARN_MORE' | 'SHOP_NOW',
            value: { link: params.link },
          } : undefined,
        },
      },
    });
  }

  /**
   * Create a video creative
   */
  async createVideoCreative(adAccountId: string, params: {
    name: string;
    pageId: string;
    videoId: string;
    title?: string;
    message: string;
    link: string;
    thumbnailUrl?: string;
    callToAction?: string;
  }): Promise<{ id: string }> {
    return this.create(adAccountId, {
      name: params.name,
      object_story_spec: {
        page_id: params.pageId,
        video_data: {
          video_id: params.videoId,
          title: params.title,
          message: params.message,
          image_url: params.thumbnailUrl,
          call_to_action: params.callToAction ? {
            type: params.callToAction as 'LEARN_MORE' | 'SHOP_NOW',
            value: { link: params.link },
          } : undefined,
        },
      },
    });
  }

  /**
   * Create a carousel creative
   */
  async createCarouselCreative(adAccountId: string, params: {
    name: string;
    pageId: string;
    message: string;
    link: string;
    childAttachments: {
      link: string;
      name?: string;
      description?: string;
      imageHash?: string;
      picture?: string;
    }[];
    callToAction?: string;
  }): Promise<{ id: string }> {
    return this.create(adAccountId, {
      name: params.name,
      object_story_spec: {
        page_id: params.pageId,
        link_data: {
          link: params.link,
          message: params.message,
          child_attachments: params.childAttachments.map(child => ({
            link: child.link,
            name: child.name,
            description: child.description,
            image_hash: child.imageHash,
            picture: child.picture,
            call_to_action: params.callToAction ? {
              type: params.callToAction as 'LEARN_MORE' | 'SHOP_NOW',
              value: { link: child.link },
            } : undefined,
          })),
          multi_share_optimized: true,
        },
      },
    });
  }
}
