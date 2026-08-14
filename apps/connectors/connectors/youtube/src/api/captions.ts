import type { YouTubeClient } from './client';
import type {
  Caption,
  CaptionListParams,
  ListResponse,
} from '../types';

export interface CaptionInsertParams {
  part: string[];
  onBehalfOf?: string;
  onBehalfOfContentOwner?: string;
  sync?: boolean;
}

export interface CaptionUpdateParams {
  part: string[];
  onBehalfOf?: string;
  onBehalfOfContentOwner?: string;
  sync?: boolean;
}

export interface CaptionDownloadParams {
  tfmt?: 'sbv' | 'scc' | 'srt' | 'ttml' | 'vtt';
  tlang?: string;
  onBehalfOf?: string;
  onBehalfOfContentOwner?: string;
}

export class CaptionsApi {
  constructor(private readonly client: YouTubeClient) {}

  /**
   * List captions for a video
   * Quota cost: 50 units
   */
  async list(params: CaptionListParams): Promise<ListResponse<Caption>> {
    return this.client.get<ListResponse<Caption>>('/captions', {
      part: params.part,
      videoId: params.videoId,
      id: params.id,
      onBehalfOf: params.onBehalfOf,
      onBehalfOfContentOwner: params.onBehalfOfContentOwner,
    });
  }

  /**
   * Get all captions for a video
   */
  async getForVideo(
    videoId: string,
    parts: string[] = ['snippet']
  ): Promise<ListResponse<Caption>> {
    return this.list({
      part: parts,
      videoId,
    });
  }

  /**
   * Get a specific caption by ID
   */
  async get(
    captionId: string,
    videoId: string,
    parts: string[] = ['snippet']
  ): Promise<Caption | null> {
    const response = await this.list({
      part: parts,
      videoId,
      id: captionId,
    });
    return response.items[0] || null;
  }

  /**
   * Insert (upload) a caption track
   * Quota cost: 400 units
   */
  async insert(
    videoId: string,
    language: string,
    name: string,
    captionData: string | Buffer,
    params: Partial<CaptionInsertParams> = {}
  ): Promise<Caption> {
    // Note: This requires multipart upload
    // For simplicity, we use the metadata-only approach
    // Full implementation would require multipart/related request
    const caption = {
      snippet: {
        videoId,
        language,
        name,
        isDraft: false,
      },
    };

    return this.client.post<Caption>(
      '/captions',
      caption,
      {
        part: params.part || ['snippet'],
        onBehalfOf: params.onBehalfOf,
        onBehalfOfContentOwner: params.onBehalfOfContentOwner,
        sync: params.sync,
      }
    );
  }

  /**
   * Update a caption
   * Quota cost: 450 units
   */
  async update(
    caption: Partial<Caption> & { id: string },
    params: CaptionUpdateParams
  ): Promise<Caption> {
    return this.client.put<Caption>(
      '/captions',
      caption as Record<string, unknown>,
      {
        part: params.part,
        onBehalfOf: params.onBehalfOf,
        onBehalfOfContentOwner: params.onBehalfOfContentOwner,
        sync: params.sync,
      }
    );
  }

  /**
   * Update caption metadata
   */
  async updateMetadata(
    captionId: string,
    isDraft?: boolean
  ): Promise<Caption> {
    const caption: Partial<Caption> & { id: string } = { id: captionId };
    if (isDraft !== undefined) {
      caption.snippet = { isDraft } as Caption['snippet'];
    }
    return this.update(caption, { part: ['snippet'] });
  }

  /**
   * Download a caption track
   * Quota cost: 200 units
   */
  async download(
    captionId: string,
    params: CaptionDownloadParams = {}
  ): Promise<string> {
    return this.client.get<string>(`/captions/${captionId}`, {
      tfmt: params.tfmt,
      tlang: params.tlang,
      onBehalfOf: params.onBehalfOf,
      onBehalfOfContentOwner: params.onBehalfOfContentOwner,
    });
  }

  /**
   * Download caption as SRT
   */
  async downloadSrt(captionId: string): Promise<string> {
    return this.download(captionId, { tfmt: 'srt' });
  }

  /**
   * Download caption as VTT
   */
  async downloadVtt(captionId: string): Promise<string> {
    return this.download(captionId, { tfmt: 'vtt' });
  }

  /**
   * Download caption as TTML
   */
  async downloadTtml(captionId: string): Promise<string> {
    return this.download(captionId, { tfmt: 'ttml' });
  }

  /**
   * Delete a caption track
   * Quota cost: 50 units
   */
  async delete(
    captionId: string,
    onBehalfOf?: string,
    onBehalfOfContentOwner?: string
  ): Promise<void> {
    await this.client.delete('/captions', {
      id: captionId,
      onBehalfOf,
      onBehalfOfContentOwner,
    });
  }
}
