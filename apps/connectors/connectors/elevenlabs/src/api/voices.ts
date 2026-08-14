import type { ElevenLabsClient } from './client';
import type { Voice, VoicesResponse, VoiceSettings } from '../types';

/**
 * Voices API module
 * Manage voices - list, get, add (clone), edit, delete
 */
export class VoicesApi {
  constructor(private readonly client: ElevenLabsClient) {}

  /**
   * List all voices (v2 API with pagination)
   */
  async list(options?: {
    pageSize?: number;
    search?: string;
    category?: 'premade' | 'cloned' | 'generated' | 'professional';
    sort?: 'created_at_asc' | 'created_at_desc' | 'name_asc' | 'name_desc';
    cursor?: string;
  }): Promise<VoicesResponse> {
    const params: Record<string, string | number | boolean | undefined> = {
      page_size: options?.pageSize,
      search: options?.search,
      category: options?.category,
      sort: options?.sort,
      cursor: options?.cursor,
    };

    return this.client.get<VoicesResponse>('/v2/voices', params);
  }

  /**
   * List all voices (v1 API - simpler, no pagination)
   */
  async listAll(): Promise<{ voices: Voice[] }> {
    return this.client.get<{ voices: Voice[] }>('/v1/voices');
  }

  /**
   * Get a specific voice by ID
   */
  async get(voiceId: string, withSettings: boolean = true): Promise<Voice> {
    return this.client.get<Voice>(`/v1/voices/${voiceId}`, {
      with_settings: withSettings,
    });
  }

  /**
   * Get default voice settings
   */
  async getDefaultSettings(): Promise<VoiceSettings> {
    return this.client.get<VoiceSettings>('/v1/voices/settings/default');
  }

  /**
   * Get voice settings
   */
  async getSettings(voiceId: string): Promise<VoiceSettings> {
    return this.client.get<VoiceSettings>(`/v1/voices/${voiceId}/settings`);
  }

  /**
   * Edit voice settings
   */
  async editSettings(voiceId: string, settings: VoiceSettings): Promise<VoiceSettings> {
    return this.client.post<VoiceSettings>(`/v1/voices/${voiceId}/settings/edit`, settings);
  }

  /**
   * Add/clone a voice from audio files
   * Use FormData to upload files
   */
  async add(options: {
    name: string;
    files: File[] | Blob[];
    description?: string;
    labels?: Record<string, string>;
    removeBackgroundNoise?: boolean;
  }): Promise<Voice> {
    const formData = new FormData();
    formData.append('name', options.name);

    if (options.description) {
      formData.append('description', options.description);
    }

    if (options.labels) {
      formData.append('labels', JSON.stringify(options.labels));
    }

    if (options.removeBackgroundNoise) {
      formData.append('remove_background_noise', 'true');
    }

    for (const file of options.files) {
      formData.append('files', file);
    }

    return this.client.uploadFile<Voice>('/v1/voices/add', formData);
  }

  /**
   * Edit a voice's metadata
   */
  async edit(voiceId: string, options: {
    name?: string;
    description?: string;
    labels?: Record<string, string>;
  }): Promise<Voice> {
    const formData = new FormData();

    if (options.name) {
      formData.append('name', options.name);
    }
    if (options.description) {
      formData.append('description', options.description);
    }
    if (options.labels) {
      formData.append('labels', JSON.stringify(options.labels));
    }

    return this.client.uploadFile<Voice>(`/v1/voices/${voiceId}/edit`, formData);
  }

  /**
   * Delete a voice
   */
  async delete(voiceId: string): Promise<{ status: string }> {
    return this.client.delete<{ status: string }>(`/v1/voices/${voiceId}`);
  }

  /**
   * Get shared voices from the voice library
   */
  async getShared(options?: {
    pageSize?: number;
    category?: string;
    gender?: string;
    age?: string;
    accent?: string;
    language?: string;
    search?: string;
    sort?: string;
    page?: number;
  }): Promise<{ voices: Voice[]; has_more: boolean }> {
    const params: Record<string, string | number | boolean | undefined> = {
      page_size: options?.pageSize || 30,
      category: options?.category,
      gender: options?.gender,
      age: options?.age,
      accent: options?.accent,
      language: options?.language,
      search: options?.search,
      sort: options?.sort,
      page: options?.page,
    };

    return this.client.get<{ voices: Voice[]; has_more: boolean }>('/v1/shared-voices', params);
  }

  /**
   * Add a shared voice to your library
   */
  async addShared(publicOwnerId: string, voiceId: string, newName: string): Promise<Voice> {
    return this.client.post<Voice>(`/v1/voices/add/${publicOwnerId}/${voiceId}`, {
      new_name: newName,
    });
  }
}
