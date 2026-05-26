import type { TwilioClient } from './client';
import type {
  VideoRoom,
  VideoRoomListResponse,
  CreateVideoRoomParams,
  UpdateVideoRoomParams,
  ListVideoRoomsParams,
} from '../types';

const VIDEO_BASE_URL = 'https://video.twilio.com/v1';

/**
 * Twilio Video API
 * Create, list, get, and complete video rooms
 */
export class VideoApi {
  private readonly baseUrl = VIDEO_BASE_URL;

  constructor(private readonly client: TwilioClient) {}

  /**
   * Make a request to the Video API (different base URL)
   */
  private async videoRequest<T>(method: string, path: string, body?: Record<string, unknown>, params?: Record<string, string | number | boolean | undefined>): Promise<T> {
    let url = `${this.baseUrl}${path}`;

    if (params) {
      const searchParams = new URLSearchParams();
      Object.entries(params).forEach(([key, value]) => {
        if (value !== undefined && value !== null && value !== '') {
          searchParams.append(key, String(value));
        }
      });
      const queryString = searchParams.toString();
      if (queryString) {
        url += `?${queryString}`;
      }
    }

    const credentials = Buffer.from(`${this.client.getAccountSid()}:${(this.client as unknown as { authToken: string }).authToken}`).toString('base64');

    const headers: Record<string, string> = {
      'Authorization': `Basic ${credentials}`,
      'Accept': 'application/json',
    };

    const fetchOptions: RequestInit = {
      method,
      headers,
    };

    if (body && ['POST', 'PUT', 'PATCH'].includes(method)) {
      headers['Content-Type'] = 'application/x-www-form-urlencoded';
      const formParams = new URLSearchParams();
      Object.entries(body).forEach(([key, value]) => {
        if (value !== undefined && value !== null) {
          if (Array.isArray(value)) {
            value.forEach(v => formParams.append(key, String(v)));
          } else if (typeof value === 'object') {
            formParams.append(key, JSON.stringify(value));
          } else {
            formParams.append(key, String(value));
          }
        }
      });
      fetchOptions.body = formParams.toString();
      fetchOptions.headers = headers;
    }

    const response = await fetch(url, fetchOptions);

    if (response.status === 204) {
      return {} as T;
    }

    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.message || response.statusText);
    }

    return data as T;
  }

  // ============================================
  // Rooms
  // ============================================

  /**
   * Create a new video room
   */
  async create(params?: CreateVideoRoomParams): Promise<VideoRoom> {
    return this.videoRequest<VideoRoom>(
      'POST',
      '/Rooms',
      params as unknown as Record<string, unknown>
    );
  }

  /**
   * List video rooms
   */
  async list(params?: ListVideoRoomsParams): Promise<VideoRoomListResponse> {
    return this.videoRequest<VideoRoomListResponse>(
      'GET',
      '/Rooms',
      undefined,
      params as unknown as Record<string, string | number | boolean | undefined>
    );
  }

  /**
   * Get a video room by SID or UniqueName
   */
  async get(roomSid: string): Promise<VideoRoom> {
    return this.videoRequest<VideoRoom>(
      'GET',
      `/Rooms/${roomSid}`
    );
  }

  /**
   * Update a video room (complete it)
   */
  async update(roomSid: string, params: UpdateVideoRoomParams): Promise<VideoRoom> {
    return this.videoRequest<VideoRoom>(
      'POST',
      `/Rooms/${roomSid}`,
      params as unknown as Record<string, unknown>
    );
  }

  /**
   * Complete (end) a video room
   */
  async complete(roomSid: string): Promise<VideoRoom> {
    return this.update(roomSid, { Status: 'completed' });
  }

  // ============================================
  // Participants
  // ============================================

  /**
   * List participants in a room
   */
  async listParticipants(roomSid: string, params?: { Status?: 'connected' | 'disconnected'; PageSize?: number; Page?: number }): Promise<{
    participants: Array<{
      sid: string;
      room_sid: string;
      account_sid: string;
      status: 'connected' | 'disconnected';
      identity: string;
      date_created: string;
      date_updated: string;
      start_time: string;
      end_time: string | null;
      duration: number | null;
      url: string;
      links: { published_tracks: string; subscribed_tracks: string; subscribe_rules: string };
    }>;
    meta: { page: number; page_size: number };
  }> {
    return this.videoRequest(
      'GET',
      `/Rooms/${roomSid}/Participants`,
      undefined,
      params as unknown as Record<string, string | number | boolean | undefined>
    );
  }

  /**
   * Get a participant by SID
   */
  async getParticipant(roomSid: string, participantSid: string): Promise<{
    sid: string;
    room_sid: string;
    account_sid: string;
    status: 'connected' | 'disconnected';
    identity: string;
    date_created: string;
    date_updated: string;
    start_time: string;
    end_time: string | null;
    duration: number | null;
    url: string;
  }> {
    return this.videoRequest(
      'GET',
      `/Rooms/${roomSid}/Participants/${participantSid}`
    );
  }

  // ============================================
  // Recordings
  // ============================================

  /**
   * List recordings for a room
   */
  async listRecordings(roomSid: string, params?: { PageSize?: number; Page?: number }): Promise<{
    recordings: Array<{
      sid: string;
      room_sid: string;
      account_sid: string;
      status: 'processing' | 'completed' | 'deleted' | 'failed';
      date_created: string;
      type: 'audio' | 'video' | 'data';
      source_sid: string;
      size: number | null;
      duration: number | null;
      container_format: string;
      codec: string;
      grouping_sids: Record<string, string>;
      track_name: string | null;
      offset: number;
      media_external_location: string | null;
      status_callback: string | null;
      status_callback_method: string | null;
      url: string;
      links: { media: string };
    }>;
    meta: { page: number; page_size: number };
  }> {
    return this.videoRequest(
      'GET',
      `/Rooms/${roomSid}/Recordings`,
      undefined,
      params as unknown as Record<string, string | number | boolean | undefined>
    );
  }

  /**
   * Get a recording by SID
   */
  async getRecording(roomSid: string, recordingSid: string): Promise<{
    sid: string;
    room_sid: string;
    account_sid: string;
    status: 'processing' | 'completed' | 'deleted' | 'failed';
    date_created: string;
    type: 'audio' | 'video' | 'data';
    source_sid: string;
    size: number | null;
    duration: number | null;
    container_format: string;
    codec: string;
    url: string;
    links: { media: string };
  }> {
    return this.videoRequest(
      'GET',
      `/Rooms/${roomSid}/Recordings/${recordingSid}`
    );
  }

  /**
   * Delete a recording
   */
  async deleteRecording(roomSid: string, recordingSid: string): Promise<void> {
    await this.videoRequest<void>(
      'DELETE',
      `/Rooms/${roomSid}/Recordings/${recordingSid}`
    );
  }

  // ============================================
  // Convenience Methods
  // ============================================

  /**
   * Create a group video room
   */
  async createGroupRoom(uniqueName?: string, options?: Omit<CreateVideoRoomParams, 'Type' | 'UniqueName'>): Promise<VideoRoom> {
    return this.create({ ...options, Type: 'group', UniqueName: uniqueName });
  }

  /**
   * Create a peer-to-peer video room
   */
  async createP2PRoom(uniqueName?: string, options?: Omit<CreateVideoRoomParams, 'Type' | 'UniqueName'>): Promise<VideoRoom> {
    return this.create({ ...options, Type: 'peer-to-peer', UniqueName: uniqueName });
  }

  /**
   * Create a Go (small group) video room
   */
  async createGoRoom(uniqueName?: string, options?: Omit<CreateVideoRoomParams, 'Type' | 'UniqueName'>): Promise<VideoRoom> {
    return this.create({ ...options, Type: 'go', UniqueName: uniqueName });
  }

  /**
   * List in-progress video rooms
   */
  async listActive(params?: Omit<ListVideoRoomsParams, 'Status'>): Promise<VideoRoomListResponse> {
    return this.list({ ...params, Status: 'in-progress' });
  }

  /**
   * List completed video rooms
   */
  async listCompleted(params?: Omit<ListVideoRoomsParams, 'Status'>): Promise<VideoRoomListResponse> {
    return this.list({ ...params, Status: 'completed' });
  }
}
