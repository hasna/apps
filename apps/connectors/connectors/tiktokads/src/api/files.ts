import type { TikTokAdsClient } from './client';
import type { ImageInfo, PaginatedData, VideoInfo } from '../types';

export class FilesApi {
  constructor(private readonly client: TikTokAdsClient) {}

  async listVideos(
    advertiserId: string,
    params?: { page?: number; page_size?: number; filtering?: Record<string, unknown> },
  ): Promise<PaginatedData<VideoInfo>> {
    return this.client.get<PaginatedData<VideoInfo>>('/file/video/ad/search/', {
      advertiser_id: advertiserId,
      filtering: params?.filtering ? JSON.stringify(params.filtering) : undefined,
      page: params?.page,
      page_size: params?.page_size,
    });
  }

  async uploadVideo(params: {
    advertiser_id: string;
    upload_type?: string;
    video_url?: string;
    file_name?: string;
    [key: string]: unknown;
  }): Promise<VideoInfo> {
    return this.client.post<VideoInfo>('/file/video/ad/upload/', {
      upload_type: 'UPLOAD_BY_URL',
      ...params,
    });
  }

  async listImages(
    advertiserId: string,
    params?: { page?: number; page_size?: number; filtering?: Record<string, unknown> },
  ): Promise<PaginatedData<ImageInfo>> {
    return this.client.get<PaginatedData<ImageInfo>>('/file/image/ad/search/', {
      advertiser_id: advertiserId,
      filtering: params?.filtering ? JSON.stringify(params.filtering) : undefined,
      page: params?.page,
      page_size: params?.page_size,
    });
  }

  async uploadImage(params: {
    advertiser_id: string;
    upload_type?: string;
    image_url?: string;
    file_name?: string;
    [key: string]: unknown;
  }): Promise<ImageInfo> {
    return this.client.post<ImageInfo>('/file/image/ad/upload/', {
      upload_type: 'UPLOAD_BY_URL',
      ...params,
    });
  }
}
