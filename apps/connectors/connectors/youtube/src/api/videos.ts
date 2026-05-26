import type { YouTubeClient } from './client';
import type {
  Video,
  VideoListParams,
  VideoInsertParams,
  VideoUpdateParams,
  VideoRating,
  VideoRatingListResponse,
  VideoAbuseReportReason,
  ListResponse,
  UploadProgress,
} from '../types';

const CHUNK_SIZE = 256 * 1024; // 256KB chunks for resumable upload

export class VideosApi {
  constructor(private readonly client: YouTubeClient) {}

  /**
   * List videos
   * Quota cost: 1 unit per request
   */
  async list(params: VideoListParams): Promise<ListResponse<Video>> {
    return this.client.get<ListResponse<Video>>('/videos', {
      part: params.part,
      chart: params.chart,
      id: params.id,
      myRating: params.myRating,
      hl: params.hl,
      maxHeight: params.maxHeight,
      maxResults: params.maxResults,
      maxWidth: params.maxWidth,
      onBehalfOfContentOwner: params.onBehalfOfContentOwner,
      pageToken: params.pageToken,
      regionCode: params.regionCode,
      videoCategoryId: params.videoCategoryId,
    });
  }

  /**
   * Get a single video by ID
   */
  async get(videoId: string, parts: string[] = ['snippet', 'contentDetails', 'statistics', 'status']): Promise<Video | null> {
    const response = await this.list({ part: parts, id: videoId });
    return response.items[0] || null;
  }

  /**
   * Get multiple videos by IDs
   */
  async getMany(videoIds: string[], parts: string[] = ['snippet', 'contentDetails', 'statistics']): Promise<Video[]> {
    const response = await this.list({ part: parts, id: videoIds });
    return response.items;
  }

  /**
   * Get most popular videos
   */
  async getMostPopular(
    regionCode?: string,
    categoryId?: string,
    maxResults = 25,
    parts: string[] = ['snippet', 'contentDetails', 'statistics']
  ): Promise<ListResponse<Video>> {
    return this.list({
      part: parts,
      chart: 'mostPopular',
      regionCode,
      videoCategoryId: categoryId,
      maxResults,
    });
  }

  /**
   * Insert (upload) a video
   * Quota cost: 1600 units
   *
   * Note: For large files, use uploadResumable instead
   */
  async insert(
    videoData: Buffer | Uint8Array,
    metadata: Partial<Video>,
    params: VideoInsertParams,
    onProgress?: (progress: UploadProgress) => void
  ): Promise<Video> {
    // Use resumable upload for all uploads
    return this.uploadResumable(videoData, metadata, params, onProgress);
  }

  /**
   * Upload a video using resumable upload
   * Quota cost: 1600 units
   */
  async uploadResumable(
    videoData: Buffer | Uint8Array,
    metadata: Partial<Video>,
    params: VideoInsertParams,
    onProgress?: (progress: UploadProgress) => void
  ): Promise<Video> {
    const totalSize = videoData.length;

    // Initialize resumable upload
    const uploadUrl = await this.client.initResumableUpload(
      '/videos',
      {
        ...metadata,
        part: params.part.join(','),
      },
      'video/*',
      totalSize
    );

    // Upload in chunks
    let bytesUploaded = 0;
    const data = videoData instanceof Uint8Array ? videoData : new Uint8Array(videoData);

    while (bytesUploaded < totalSize) {
      const chunkEnd = Math.min(bytesUploaded + CHUNK_SIZE, totalSize);
      const chunk = data.slice(bytesUploaded, chunkEnd);

      const result = await this.client.uploadChunk(uploadUrl, chunk, bytesUploaded, totalSize);
      bytesUploaded = result.bytesUploaded;

      if (onProgress) {
        onProgress({
          bytesUploaded,
          totalBytes: totalSize,
          percentage: Math.round((bytesUploaded / totalSize) * 100),
        });
      }

      if (result.complete) {
        return result.response as Video;
      }
    }

    throw new Error('Upload did not complete');
  }

  /**
   * Update a video
   * Quota cost: 50 units
   */
  async update(video: Partial<Video> & { id: string }, params: VideoUpdateParams): Promise<Video> {
    return this.client.put<Video>('/videos', video as Record<string, unknown>, {
      part: params.part,
      onBehalfOfContentOwner: params.onBehalfOfContentOwner,
    });
  }

  /**
   * Delete a video
   * Quota cost: 50 units
   */
  async delete(videoId: string, onBehalfOfContentOwner?: string): Promise<void> {
    await this.client.delete('/videos', {
      id: videoId,
      onBehalfOfContentOwner,
    });
  }

  /**
   * Rate a video (like, dislike, or remove rating)
   * Quota cost: 50 units
   */
  async rate(videoId: string, rating: 'like' | 'dislike' | 'none'): Promise<void> {
    await this.client.post('/videos/rate', undefined, {
      id: videoId,
      rating,
    });
  }

  /**
   * Get rating for videos
   * Quota cost: 1 unit
   */
  async getRating(videoIds: string | string[], onBehalfOfContentOwner?: string): Promise<VideoRatingListResponse> {
    return this.client.get<VideoRatingListResponse>('/videos/getRating', {
      id: videoIds,
      onBehalfOfContentOwner,
    });
  }

  /**
   * Report a video for abuse
   * Quota cost: 50 units
   */
  async reportAbuse(
    videoId: string,
    reasonId: string,
    secondaryReasonId?: string,
    comments?: string,
    language?: string,
    onBehalfOfContentOwner?: string
  ): Promise<void> {
    await this.client.post('/videos/reportAbuse', {
      videoId,
      reasonId,
      secondaryReasonId,
      comments,
      language,
    }, {
      onBehalfOfContentOwner,
    });
  }

  /**
   * List video abuse report reasons
   * Quota cost: 1 unit
   */
  async listAbuseReportReasons(hl?: string): Promise<ListResponse<VideoAbuseReportReason>> {
    return this.client.get<ListResponse<VideoAbuseReportReason>>('/videoAbuseReportReasons', {
      part: ['snippet'],
      hl,
    });
  }
}
