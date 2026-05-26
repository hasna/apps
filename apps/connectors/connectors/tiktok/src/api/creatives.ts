import type { TikTokClient } from './client';
import type { ImageInfo, VideoInfo, PaginatedData } from '../types';

/**
 * TikTok Creatives API
 * Upload and manage images, videos, and other creative assets
 */
export class CreativesApi {
  constructor(private readonly client: TikTokClient) {}

  // ============================================
  // Image Management
  // ============================================

  /**
   * Upload an image by URL
   * POST /file/image/ad/upload/
   */
  async uploadImageByUrl(
    advertiserId: string,
    imageUrl: string,
    fileName?: string
  ): Promise<ImageInfo> {
    return this.client.post<ImageInfo>('/file/image/ad/upload/', {
      advertiser_id: advertiserId,
      upload_type: 'UPLOAD_BY_URL',
      image_url: imageUrl,
      file_name: fileName,
    });
  }

  /**
   * Get image info
   * GET /file/image/ad/info/
   */
  async getImage(advertiserId: string, imageIds: string[]): Promise<{ list: ImageInfo[] }> {
    return this.client.get<{ list: ImageInfo[] }>('/file/image/ad/info/', {
      advertiser_id: advertiserId,
      image_ids: imageIds,
    });
  }

  /**
   * List images
   * GET /file/image/ad/get/
   */
  async listImages(
    advertiserId: string,
    params?: {
      filtering?: {
        image_ids?: string[];
        material_ids?: string[];
      };
      page?: number;
      page_size?: number;
    }
  ): Promise<PaginatedData<ImageInfo>> {
    return this.client.get<PaginatedData<ImageInfo>>('/file/image/ad/get/', {
      advertiser_id: advertiserId,
      filtering: params?.filtering ? JSON.stringify(params.filtering) : undefined,
      page: params?.page,
      page_size: params?.page_size,
    });
  }

  // ============================================
  // Video Management
  // ============================================

  /**
   * Upload a video by URL
   * POST /file/video/ad/upload/
   */
  async uploadVideoByUrl(
    advertiserId: string,
    videoUrl: string,
    fileName?: string,
    options?: {
      flaw_detect?: boolean;
      auto_fix_enabled?: boolean;
      auto_bind_enabled?: boolean;
    }
  ): Promise<VideoInfo> {
    return this.client.post<VideoInfo>('/file/video/ad/upload/', {
      advertiser_id: advertiserId,
      upload_type: 'UPLOAD_BY_URL',
      video_url: videoUrl,
      file_name: fileName,
      flaw_detect: options?.flaw_detect,
      auto_fix_enabled: options?.auto_fix_enabled,
      auto_bind_enabled: options?.auto_bind_enabled,
    });
  }

  /**
   * Get video info
   * GET /file/video/ad/info/
   */
  async getVideo(advertiserId: string, videoIds: string[]): Promise<{ list: VideoInfo[] }> {
    return this.client.get<{ list: VideoInfo[] }>('/file/video/ad/info/', {
      advertiser_id: advertiserId,
      video_ids: videoIds,
    });
  }

  /**
   * List videos
   * GET /file/video/ad/get/
   */
  async listVideos(
    advertiserId: string,
    params?: {
      filtering?: {
        video_ids?: string[];
        material_ids?: string[];
      };
      page?: number;
      page_size?: number;
    }
  ): Promise<PaginatedData<VideoInfo>> {
    return this.client.get<PaginatedData<VideoInfo>>('/file/video/ad/get/', {
      advertiser_id: advertiserId,
      filtering: params?.filtering ? JSON.stringify(params.filtering) : undefined,
      page: params?.page,
      page_size: params?.page_size,
    });
  }

  /**
   * Search videos
   * GET /file/video/ad/search/
   */
  async searchVideos(
    advertiserId: string,
    params?: {
      filtering?: {
        video_ids?: string[];
        material_ids?: string[];
        display_name?: string;
      };
      page?: number;
      page_size?: number;
    }
  ): Promise<PaginatedData<VideoInfo>> {
    return this.client.get<PaginatedData<VideoInfo>>('/file/video/ad/search/', {
      advertiser_id: advertiserId,
      filtering: params?.filtering ? JSON.stringify(params.filtering) : undefined,
      page: params?.page,
      page_size: params?.page_size,
    });
  }

  /**
   * Update video info
   * POST /file/video/ad/update/
   */
  async updateVideo(
    advertiserId: string,
    videoId: string,
    displayName: string
  ): Promise<{ video_id: string }> {
    return this.client.post<{ video_id: string }>('/file/video/ad/update/', {
      advertiser_id: advertiserId,
      video_id: videoId,
      display_name: displayName,
    });
  }

  // ============================================
  // Music Management
  // ============================================

  /**
   * List available music
   * GET /creative/music/search/
   */
  async searchMusic(
    advertiserId: string,
    params?: {
      query?: string;
      page?: number;
      page_size?: number;
    }
  ): Promise<PaginatedData<{
    music_id: string;
    music_name: string;
    artist_name: string;
    duration: number;
    preview_url: string;
  }>> {
    return this.client.get('/creative/music/search/', {
      advertiser_id: advertiserId,
      search_text: params?.query,
      page: params?.page,
      page_size: params?.page_size,
    });
  }

  // ============================================
  // Portfolio Management
  // ============================================

  /**
   * Create a creative portfolio
   * POST /creative/portfolio/create/
   */
  async createPortfolio(params: {
    advertiser_id: string;
    portfolio_name: string;
    creative_type: 'VIDEO' | 'IMAGE' | 'CAROUSEL';
    video_ids?: string[];
    image_ids?: string[];
  }): Promise<{ portfolio_id: string }> {
    return this.client.post<{ portfolio_id: string }>('/creative/portfolio/create/', params);
  }

  /**
   * List creative portfolios
   * GET /creative/portfolio/get/
   */
  async listPortfolios(
    advertiserId: string,
    params?: {
      filtering?: {
        portfolio_ids?: string[];
      };
      page?: number;
      page_size?: number;
    }
  ): Promise<PaginatedData<{
    portfolio_id: string;
    portfolio_name: string;
    creative_type: string;
    creative_count: number;
    create_time: string;
  }>> {
    return this.client.get('/creative/portfolio/get/', {
      advertiser_id: advertiserId,
      filtering: params?.filtering ? JSON.stringify(params.filtering) : undefined,
      page: params?.page,
      page_size: params?.page_size,
    });
  }

  // ============================================
  // Smart Creative Features
  // ============================================

  /**
   * Get smart video templates
   * GET /creative/smart_video/template/get/
   */
  async getSmartVideoTemplates(
    advertiserId: string,
    params?: {
      template_type?: string;
      page?: number;
      page_size?: number;
    }
  ): Promise<PaginatedData<{
    template_id: string;
    template_name: string;
    template_type: string;
    preview_url: string;
    duration: number;
  }>> {
    return this.client.get('/creative/smart_video/template/get/', {
      advertiser_id: advertiserId,
      template_type: params?.template_type,
      page: params?.page,
      page_size: params?.page_size,
    });
  }

  /**
   * Generate smart video
   * POST /creative/smart_video/create/
   */
  async generateSmartVideo(params: {
    advertiser_id: string;
    template_id: string;
    video_name: string;
    product_images?: string[];
    product_info?: {
      product_name?: string;
      product_description?: string;
      price?: string;
      sale_price?: string;
    };
  }): Promise<{ video_id: string; task_id: string }> {
    return this.client.post('/creative/smart_video/create/', params);
  }
}
