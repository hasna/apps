import type {
  ResembleConfig,
  VoicesListResponse,
  VoiceResponse,
  Voice,
  ProjectsListResponse,
  ProjectResponse,
  Project,
  ClipsListResponse,
  ClipResponse,
  Clip,
  CreateVoiceOptions,
  CreateClipOptions,
  SyncClipResponse,
} from '../types';
import { ResembleClient } from './client';

/**
 * Resemble AI API Client
 * Voice cloning and text-to-speech API
 */
export class Resemble {
  private readonly client: ResembleClient;

  constructor(config: ResembleConfig) {
    this.client = new ResembleClient(config);
  }

  /**
   * Create a client from environment variables
   */
  static fromEnv(): Resemble {
    const apiKey = process.env.RESEMBLE_API_KEY;

    if (!apiKey) {
      throw new Error('RESEMBLE_API_KEY environment variable is required');
    }
    return new Resemble({ apiKey });
  }

  // ============================================
  // Voice Methods
  // ============================================

  /**
   * List all voices
   */
  async listVoices(page: number = 1): Promise<VoicesListResponse> {
    return this.client.get<VoicesListResponse>('/voices', { page });
  }

  /**
   * Get a voice by UUID
   */
  async getVoice(voiceUuid: string): Promise<Voice> {
    const response = await this.client.get<VoiceResponse>(`/voices/${voiceUuid}`);
    return response.item;
  }

  /**
   * Create a new voice
   */
  async createVoice(options: CreateVoiceOptions): Promise<Voice> {
    const response = await this.client.post<VoiceResponse>('/voices', {
      name: options.name,
      dataset_url: options.dataset_url,
      callback_uri: options.callback_uri,
    });
    return response.item;
  }

  /**
   * Delete a voice
   */
  async deleteVoice(voiceUuid: string): Promise<{ success: boolean }> {
    return this.client.delete<{ success: boolean }>(`/voices/${voiceUuid}`);
  }

  // ============================================
  // Project Methods
  // ============================================

  /**
   * List all projects
   */
  async listProjects(page: number = 1): Promise<ProjectsListResponse> {
    return this.client.get<ProjectsListResponse>('/projects', { page });
  }

  /**
   * Get a project by UUID
   */
  async getProject(projectUuid: string): Promise<Project> {
    const response = await this.client.get<ProjectResponse>(`/projects/${projectUuid}`);
    return response.item;
  }

  // ============================================
  // Clip Methods (Speech Generation)
  // ============================================

  /**
   * List clips in a project
   */
  async listClips(projectUuid: string, page: number = 1): Promise<ClipsListResponse> {
    return this.client.get<ClipsListResponse>(`/projects/${projectUuid}/clips`, { page });
  }

  /**
   * Get a clip by UUID
   */
  async getClip(projectUuid: string, clipUuid: string): Promise<Clip> {
    const response = await this.client.get<ClipResponse>(`/projects/${projectUuid}/clips/${clipUuid}`);
    return response.item;
  }

  /**
   * Create a clip (generate speech) - async
   */
  async createClip(projectUuid: string, options: CreateClipOptions): Promise<Clip> {
    const response = await this.client.post<ClipResponse>(`/projects/${projectUuid}/clips`, {
      voice_uuid: options.voice_uuid,
      body: options.body,
      title: options.title,
      is_public: options.is_public,
      is_archived: options.is_archived,
      callback_uri: options.callback_uri,
      precision: options.precision,
      sample_rate: options.sample_rate,
      output_format: options.output_format,
    });
    return response.item;
  }

  /**
   * Create a clip synchronously (wait for audio)
   */
  async createClipSync(projectUuid: string, options: CreateClipOptions): Promise<SyncClipResponse> {
    return this.client.post<SyncClipResponse>(`/projects/${projectUuid}/clips/sync`, {
      voice_uuid: options.voice_uuid,
      body: options.body,
      title: options.title,
      is_public: options.is_public,
      precision: options.precision,
      sample_rate: options.sample_rate,
      output_format: options.output_format,
    });
  }

  /**
   * Delete a clip
   */
  async deleteClip(projectUuid: string, clipUuid: string): Promise<{ success: boolean }> {
    return this.client.delete<{ success: boolean }>(`/projects/${projectUuid}/clips/${clipUuid}`);
  }

  /**
   * Generate speech and return audio as Buffer
   */
  async speak(projectUuid: string, voiceUuid: string, text: string, options?: {
    output_format?: 'wav' | 'mp3';
    sample_rate?: number;
  }): Promise<{ audio: Buffer; audioUrl: string }> {
    const result = await this.createClipSync(projectUuid, {
      voice_uuid: voiceUuid,
      body: text,
      output_format: options?.output_format || 'mp3',
      sample_rate: options?.sample_rate,
    });

    if (result.item.audio_src) {
      const response = await fetch(result.item.audio_src);
      const buffer = await response.arrayBuffer();
      return {
        audio: Buffer.from(buffer),
        audioUrl: result.item.audio_src,
      };
    }

    throw new Error('No audio URL in response');
  }

  /**
   * Get a preview of the API key
   */
  getApiKeyPreview(): string {
    return this.client.getApiKeyPreview();
  }

  /**
   * Get the underlying client for direct API access
   */
  getClient(): ResembleClient {
    return this.client;
  }
}

export { ResembleClient } from './client';
