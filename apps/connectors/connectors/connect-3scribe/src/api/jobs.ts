import type { ConnectorClient } from './client';
import type { TranscriptionJob, JobListResponse, JobListParams, TranscribeParams } from '../types';

/**
 * 3Scribe Jobs API module
 * Manages transcription jobs
 */
export class JobsApi {
  constructor(private readonly client: ConnectorClient) {}

  /**
   * List transcription jobs
   */
  async list(params?: JobListParams): Promise<JobListResponse> {
    return this.client.get<JobListResponse>('/jobs', {
      page: params?.page,
      perpage: params?.perpage,
      order: params?.order,
      direction: params?.direction,
    });
  }

  /**
   * Get a specific transcription job by ID
   */
  async get(jobId: string): Promise<TranscriptionJob> {
    return this.client.get<TranscriptionJob>(`/jobs/${jobId}`);
  }

  /**
   * Delete a transcription job
   */
  async delete(jobId: string): Promise<void> {
    await this.client.delete(`/jobs/${jobId}`);
  }

  /**
   * Submit a new transcription job
   * Provide a publicly accessible URL to the audio/video file
   */
  async transcribe(params: TranscribeParams): Promise<TranscriptionJob> {
    return this.client.post<TranscriptionJob>('/transcribe', params);
  }
}
