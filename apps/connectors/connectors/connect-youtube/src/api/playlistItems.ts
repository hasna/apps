import type { YouTubeClient } from './client';
import type {
  PlaylistItem,
  PlaylistItemListParams,
  ListResponse,
} from '../types';

export interface PlaylistItemInsertParams {
  part: string[];
  onBehalfOfContentOwner?: string;
}

export interface PlaylistItemUpdateParams {
  part: string[];
  onBehalfOfContentOwner?: string;
}

export class PlaylistItemsApi {
  constructor(private readonly client: YouTubeClient) {}

  /**
   * List playlist items
   * Quota cost: 1 unit per request
   */
  async list(params: PlaylistItemListParams): Promise<ListResponse<PlaylistItem>> {
    return this.client.get<ListResponse<PlaylistItem>>('/playlistItems', {
      part: params.part,
      id: params.id,
      playlistId: params.playlistId,
      maxResults: params.maxResults,
      onBehalfOfContentOwner: params.onBehalfOfContentOwner,
      pageToken: params.pageToken,
      videoId: params.videoId,
    });
  }

  /**
   * Get all items from a playlist
   */
  async getAll(
    playlistId: string,
    maxResults = 50,
    parts: string[] = ['snippet', 'contentDetails', 'status']
  ): Promise<ListResponse<PlaylistItem>> {
    return this.list({
      part: parts,
      playlistId,
      maxResults,
    });
  }

  /**
   * Get a playlist item by video ID within a playlist
   */
  async getByVideo(
    playlistId: string,
    videoId: string,
    parts: string[] = ['snippet', 'contentDetails']
  ): Promise<PlaylistItem | null> {
    const response = await this.list({
      part: parts,
      playlistId,
      videoId,
    });
    return response.items[0] || null;
  }

  /**
   * Insert (add) a video to a playlist
   * Quota cost: 50 units
   */
  async insert(
    item: Omit<PlaylistItem, 'kind' | 'etag' | 'id'>,
    params: PlaylistItemInsertParams
  ): Promise<PlaylistItem> {
    return this.client.post<PlaylistItem>(
      '/playlistItems',
      item as Record<string, unknown>,
      {
        part: params.part,
        onBehalfOfContentOwner: params.onBehalfOfContentOwner,
      }
    );
  }

  /**
   * Add a video to a playlist at a specific position
   */
  async add(
    playlistId: string,
    videoId: string,
    position?: number,
    note?: string
  ): Promise<PlaylistItem> {
    const item: Record<string, unknown> = {
      snippet: {
        playlistId,
        resourceId: {
          kind: 'youtube#video',
          videoId,
        },
        position,
      },
    };

    if (note !== undefined) {
      item.contentDetails = { note };
    }

    const parts = ['snippet'];
    if (note !== undefined) {
      parts.push('contentDetails');
    }

    return this.insert(item as Omit<PlaylistItem, 'kind' | 'etag' | 'id'>, { part: parts });
  }

  /**
   * Update a playlist item (change position or note)
   * Quota cost: 50 units
   */
  async update(
    item: Partial<PlaylistItem> & { id: string },
    params: PlaylistItemUpdateParams
  ): Promise<PlaylistItem> {
    return this.client.put<PlaylistItem>(
      '/playlistItems',
      item as Record<string, unknown>,
      {
        part: params.part,
        onBehalfOfContentOwner: params.onBehalfOfContentOwner,
      }
    );
  }

  /**
   * Move a playlist item to a new position
   */
  async move(
    playlistItemId: string,
    playlistId: string,
    videoId: string,
    newPosition: number
  ): Promise<PlaylistItem> {
    return this.update(
      {
        id: playlistItemId,
        snippet: {
          playlistId,
          resourceId: {
            kind: 'youtube#video',
            videoId,
          },
          position: newPosition,
        },
      } as Partial<PlaylistItem> & { id: string },
      { part: ['snippet'] }
    );
  }

  /**
   * Delete a playlist item (remove video from playlist)
   * Quota cost: 50 units
   */
  async delete(playlistItemId: string, onBehalfOfContentOwner?: string): Promise<void> {
    await this.client.delete('/playlistItems', {
      id: playlistItemId,
      onBehalfOfContentOwner,
    });
  }

  /**
   * Remove a video from a playlist by video ID
   * First finds the playlist item, then deletes it
   */
  async removeVideo(playlistId: string, videoId: string): Promise<boolean> {
    const item = await this.getByVideo(playlistId, videoId);
    if (item) {
      await this.delete(item.id);
      return true;
    }
    return false;
  }
}
