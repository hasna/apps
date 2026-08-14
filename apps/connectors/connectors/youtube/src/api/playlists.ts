import type { YouTubeClient } from './client';
import type {
  Playlist,
  PlaylistListParams,
  ListResponse,
} from '../types';

export interface PlaylistInsertParams {
  part: string[];
  onBehalfOfContentOwner?: string;
  onBehalfOfContentOwnerChannel?: string;
}

export interface PlaylistUpdateParams {
  part: string[];
  onBehalfOfContentOwner?: string;
}

export class PlaylistsApi {
  constructor(private readonly client: YouTubeClient) {}

  /**
   * List playlists
   * Quota cost: 1 unit per request
   */
  async list(params: PlaylistListParams): Promise<ListResponse<Playlist>> {
    return this.client.get<ListResponse<Playlist>>('/playlists', {
      part: params.part,
      channelId: params.channelId,
      id: params.id,
      mine: params.mine,
      hl: params.hl,
      maxResults: params.maxResults,
      onBehalfOfContentOwner: params.onBehalfOfContentOwner,
      onBehalfOfContentOwnerChannel: params.onBehalfOfContentOwnerChannel,
      pageToken: params.pageToken,
    });
  }

  /**
   * Get a single playlist by ID
   */
  async get(playlistId: string, parts: string[] = ['snippet', 'contentDetails', 'status']): Promise<Playlist | null> {
    const response = await this.list({ part: parts, id: playlistId });
    return response.items[0] || null;
  }

  /**
   * Get playlists for a channel
   */
  async getByChannel(
    channelId: string,
    maxResults = 25,
    parts: string[] = ['snippet', 'contentDetails']
  ): Promise<ListResponse<Playlist>> {
    return this.list({
      part: parts,
      channelId,
      maxResults,
    });
  }

  /**
   * Get the authenticated user's playlists
   */
  async getMine(maxResults = 25, parts: string[] = ['snippet', 'contentDetails', 'status']): Promise<ListResponse<Playlist>> {
    return this.list({
      part: parts,
      mine: true,
      maxResults,
    });
  }

  /**
   * Insert (create) a playlist
   * Quota cost: 50 units
   */
  async insert(
    playlist: Omit<Playlist, 'kind' | 'etag' | 'id'>,
    params: PlaylistInsertParams
  ): Promise<Playlist> {
    return this.client.post<Playlist>(
      '/playlists',
      playlist as Record<string, unknown>,
      {
        part: params.part,
        onBehalfOfContentOwner: params.onBehalfOfContentOwner,
        onBehalfOfContentOwnerChannel: params.onBehalfOfContentOwnerChannel,
      }
    );
  }

  /**
   * Create a new playlist with title and description
   */
  async create(
    title: string,
    description?: string,
    privacyStatus: 'public' | 'private' | 'unlisted' = 'private',
    tags?: string[]
  ): Promise<Playlist> {
    const playlistData = {
      snippet: {
        title,
        description: description || '',
        tags,
      },
      status: {
        privacyStatus,
      },
    };
    return this.client.post<Playlist>(
      '/playlists',
      playlistData as unknown as Record<string, unknown>,
      { part: ['snippet', 'status'] }
    );
  }

  /**
   * Update a playlist
   * Quota cost: 50 units
   */
  async update(
    playlist: Partial<Playlist> & { id: string },
    params: PlaylistUpdateParams
  ): Promise<Playlist> {
    return this.client.put<Playlist>(
      '/playlists',
      playlist as Record<string, unknown>,
      {
        part: params.part,
        onBehalfOfContentOwner: params.onBehalfOfContentOwner,
      }
    );
  }

  /**
   * Update playlist title and description
   */
  async updateMetadata(
    playlistId: string,
    title?: string,
    description?: string,
    privacyStatus?: 'public' | 'private' | 'unlisted'
  ): Promise<Playlist> {
    const parts: string[] = [];
    const playlist: Partial<Playlist> & { id: string } = { id: playlistId };

    if (title !== undefined || description !== undefined) {
      parts.push('snippet');
      playlist.snippet = {} as Playlist['snippet'];
      if (title !== undefined) playlist.snippet!.title = title;
      if (description !== undefined) playlist.snippet!.description = description;
    }

    if (privacyStatus !== undefined) {
      parts.push('status');
      playlist.status = { privacyStatus };
    }

    return this.update(playlist, { part: parts });
  }

  /**
   * Delete a playlist
   * Quota cost: 50 units
   */
  async delete(playlistId: string, onBehalfOfContentOwner?: string): Promise<void> {
    await this.client.delete('/playlists', {
      id: playlistId,
      onBehalfOfContentOwner,
    });
  }
}
