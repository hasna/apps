import type {
  PinterestConfig,
  UserAccount,
  Board,
  BoardListResponse,
  BoardCreateParams,
  BoardUpdateParams,
  Pin,
  PinListResponse,
  PinCreateParams,
  PinUpdateParams,
  BoardSection,
  BoardSectionListResponse,
  BoardSectionCreateParams,
  MediaUpload,
  PinAnalytics,
  UserAnalytics,
} from '../types';
import { PinterestClient } from './client';

export class Pinterest {
  private readonly client: PinterestClient;

  constructor(config: PinterestConfig) {
    this.client = new PinterestClient(config);
  }

  static fromEnv(): Pinterest {
    const accessToken = process.env.PINTEREST_ACCESS_TOKEN;

    if (!accessToken) {
      throw new Error('PINTEREST_ACCESS_TOKEN environment variable is required');
    }
    return new Pinterest({ accessToken });
  }

  getAccessTokenPreview(): string {
    return this.client.getAccessTokenPreview();
  }

  getClient(): PinterestClient {
    return this.client;
  }

  // ============================================
  // User Account Methods
  // ============================================

  async getUserAccount(): Promise<UserAccount> {
    return this.client.get<UserAccount>('/user_account');
  }

  async getUserAnalytics(params?: {
    start_date: string;
    end_date: string;
    metric_types?: string[];
    app_types?: string;
    split_field?: string;
  }): Promise<UserAnalytics> {
    return this.client.get<UserAnalytics>('/user_account/analytics', {
      ...params,
      metric_types: params?.metric_types?.join(','),
    });
  }

  // ============================================
  // Board Methods
  // ============================================

  async listBoards(params?: { bookmark?: string; page_size?: number; privacy?: string }): Promise<BoardListResponse> {
    return this.client.get<BoardListResponse>('/boards', params);
  }

  async getBoard(boardId: string): Promise<Board> {
    return this.client.get<Board>(`/boards/${boardId}`);
  }

  async createBoard(params: BoardCreateParams): Promise<Board> {
    return this.client.post<Board>('/boards', params);
  }

  async updateBoard(boardId: string, params: BoardUpdateParams): Promise<Board> {
    return this.client.patch<Board>(`/boards/${boardId}`, params);
  }

  async deleteBoard(boardId: string): Promise<void> {
    return this.client.delete<void>(`/boards/${boardId}`);
  }

  async listBoardPins(boardId: string, params?: { bookmark?: string; page_size?: number }): Promise<PinListResponse> {
    return this.client.get<PinListResponse>(`/boards/${boardId}/pins`, params);
  }

  // ============================================
  // Board Section Methods
  // ============================================

  async listBoardSections(boardId: string, params?: { bookmark?: string; page_size?: number }): Promise<BoardSectionListResponse> {
    return this.client.get<BoardSectionListResponse>(`/boards/${boardId}/sections`, params);
  }

  async createBoardSection(boardId: string, params: BoardSectionCreateParams): Promise<BoardSection> {
    return this.client.post<BoardSection>(`/boards/${boardId}/sections`, params);
  }

  async updateBoardSection(boardId: string, sectionId: string, params: BoardSectionCreateParams): Promise<BoardSection> {
    return this.client.patch<BoardSection>(`/boards/${boardId}/sections/${sectionId}`, params);
  }

  async deleteBoardSection(boardId: string, sectionId: string): Promise<void> {
    return this.client.delete<void>(`/boards/${boardId}/sections/${sectionId}`);
  }

  async listBoardSectionPins(boardId: string, sectionId: string, params?: { bookmark?: string; page_size?: number }): Promise<PinListResponse> {
    return this.client.get<PinListResponse>(`/boards/${boardId}/sections/${sectionId}/pins`, params);
  }

  // ============================================
  // Pin Methods
  // ============================================

  async getPin(pinId: string): Promise<Pin> {
    return this.client.get<Pin>(`/pins/${pinId}`);
  }

  async createPin(params: PinCreateParams): Promise<Pin> {
    return this.client.post<Pin>('/pins', params);
  }

  async updatePin(pinId: string, params: PinUpdateParams): Promise<Pin> {
    return this.client.patch<Pin>(`/pins/${pinId}`, params);
  }

  async deletePin(pinId: string): Promise<void> {
    return this.client.delete<void>(`/pins/${pinId}`);
  }

  async savePin(pinId: string, boardId: string, boardSectionId?: string): Promise<Pin> {
    return this.client.post<Pin>(`/pins/${pinId}/save`, {
      board_id: boardId,
      board_section_id: boardSectionId,
    });
  }

  async getPinAnalytics(pinId: string, params: {
    start_date: string;
    end_date: string;
    metric_types: string[];
    app_types?: string;
    split_field?: string;
  }): Promise<PinAnalytics> {
    return this.client.get<PinAnalytics>(`/pins/${pinId}/analytics`, {
      ...params,
      metric_types: params.metric_types.join(','),
    });
  }

  // ============================================
  // Media Upload Methods
  // ============================================

  async registerMediaUpload(mediaType: 'video'): Promise<MediaUpload> {
    return this.client.post<MediaUpload>('/media', {
      media_type: mediaType,
    });
  }

  // ============================================
  // Search Methods
  // ============================================

  async searchUserPins(query: string, params?: { bookmark?: string; page_size?: number }): Promise<PinListResponse> {
    return this.client.get<PinListResponse>('/search/pins', {
      query,
      ...params,
    });
  }

  async searchUserBoards(query: string, params?: { bookmark?: string; page_size?: number }): Promise<BoardListResponse> {
    return this.client.get<BoardListResponse>('/search/boards', {
      query,
      ...params,
    });
  }

  // ============================================
  // Following Methods
  // ============================================

  async listFollowingBoards(params?: { bookmark?: string; page_size?: number }): Promise<BoardListResponse> {
    return this.client.get<BoardListResponse>('/user_account/following/boards', params);
  }

  async followBoard(boardId: string): Promise<void> {
    return this.client.post<void>(`/boards/${boardId}/followers`);
  }

  async unfollowBoard(boardId: string): Promise<void> {
    return this.client.delete<void>(`/boards/${boardId}/followers`);
  }
}

export { PinterestClient } from './client';
