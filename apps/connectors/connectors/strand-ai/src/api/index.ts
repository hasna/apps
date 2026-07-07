import type {
  StrandConfig,
  Upload,
  UploadList,
  UploadCreated,
  UploadComplete,
  InitiateUploadRequest,
  Estimate,
  EstimateRequest,
  Submission,
  SubmitPredictionRequest,
  Job,
  JobCancelResponse,
  Results,
  ExpirationUpdate,
  Sample,
  BulkExpirationRequest,
  BulkExpirationResponse,
  SampleRestoreResponse,
} from '../types';
import { StrandClient } from './client';

export class StrandAI {
  private readonly client: StrandClient;

  constructor(config: StrandConfig) {
    this.client = new StrandClient(config);
  }

  static fromEnv(): StrandAI {
    const apiKey = process.env.STRAND_API_KEY;
    if (!apiKey) {
      throw new Error('STRAND_API_KEY environment variable is required');
    }
    return new StrandAI({
      apiKey,
      baseUrl: process.env.STRAND_BASE_URL,
    });
  }

  getApiKeyPreview(): string {
    return this.client.getApiKeyPreview();
  }

  async listUploads(options?: { limit?: number; cursor?: string }): Promise<UploadList> {
    return this.client.get<UploadList>('/uploads', options);
  }

  async initiateUpload(request: InitiateUploadRequest): Promise<UploadCreated> {
    return this.client.post<UploadCreated>('/uploads', { ...request });
  }

  async getUpload(id: string): Promise<Upload> {
    return this.client.get<Upload>(`/uploads/${id}`);
  }

  async completeUpload(id: string): Promise<UploadComplete> {
    return this.client.post<UploadComplete>(`/uploads/${id}/complete`);
  }

  async estimatePrediction(request: EstimateRequest): Promise<Estimate> {
    return this.client.post<Estimate>('/predict/estimate', { ...request });
  }

  async submitPrediction(request: SubmitPredictionRequest): Promise<Submission> {
    return this.client.post<Submission>('/predict', { ...request });
  }

  async getJob(id: string): Promise<Job> {
    return this.client.get<Job>(`/jobs/${id}`);
  }

  async cancelJob(id: string): Promise<JobCancelResponse> {
    return this.client.post<JobCancelResponse>(`/jobs/${id}/cancel`);
  }

  async getJobResults(id: string): Promise<Results> {
    return this.client.get<Results>(`/jobs/${id}/results`);
  }

  /**
   * Returns the SSE stream URL for job status. Clients must open this URL with
   * an Authorization: Bearer header; standard fetch does not parse SSE events.
   */
  getJobStreamUrl(id: string): string {
    return `${this.client.getBaseUrl()}/jobs/${id}/stream`;
  }

  async getJobResultFile(id: string, path: string): Promise<ArrayBuffer> {
    const encodedPath = path.split('/').map(encodeURIComponent).join('/');
    return this.client.getBinary(`/jobs/${id}/results/files/${encodedPath}`);
  }

  async patchSampleExpiration(id: string, update: ExpirationUpdate): Promise<Sample> {
    return this.client.patch<Sample>(`/samples/${id}/expiration`, { ...update });
  }

  async bulkPatchSampleExpiration(request: BulkExpirationRequest): Promise<BulkExpirationResponse> {
    return this.client.patch<BulkExpirationResponse>('/samples/expiration', { ...request });
  }

  async restoreSample(id: string): Promise<SampleRestoreResponse> {
    return this.client.post<SampleRestoreResponse>(`/samples/${id}/restore`);
  }

  async rawRequest<T = unknown>(
    method: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH',
    path: string,
    body?: Record<string, unknown> | string
  ): Promise<T> {
    return this.client.request<T>(path, { method, body });
  }

  getClient(): StrandClient {
    return this.client;
  }
}

export { StrandClient, DEFAULT_BASE_URL } from './client';
