import type {
  RunPodConfig,
  RunJobRequest,
  Job,
  RunSyncResponse,
  RunAsyncResponse,
  HealthResponse
} from '../types';
import { RunPodClient } from './client';

export class RunPod {
  private readonly client: RunPodClient;

  constructor(config: RunPodConfig) {
    this.client = new RunPodClient(config);
  }

  static fromEnv(): RunPod {
    const apiKey = process.env.RUNPOD_API_KEY;
    if (!apiKey) {
      throw new Error('RUNPOD_API_KEY environment variable is required');
    }
    return new RunPod({ apiKey });
  }

  getApiKeyPreview(): string {
    return this.client.getApiKeyPreview();
  }

  async runSync(endpointId: string, request: RunJobRequest): Promise<RunSyncResponse> {
    return this.client.post<RunSyncResponse>(`/${endpointId}/runsync`, request);
  }

  async run(endpointId: string, request: RunJobRequest): Promise<RunAsyncResponse> {
    return this.client.post<RunAsyncResponse>(`/${endpointId}/run`, request);
  }

  async getJob(endpointId: string, jobId: string): Promise<Job> {
    return this.client.get<Job>(`/${endpointId}/status/${jobId}`);
  }

  async cancelJob(endpointId: string, jobId: string): Promise<Job> {
    return this.client.post<Job>(`/${endpointId}/cancel/${jobId}`);
  }

  async purgeQueue(endpointId: string): Promise<{ removed: number; status: string }> {
    return this.client.post<{ removed: number; status: string }>(`/${endpointId}/purge-queue`);
  }

  async health(endpointId: string): Promise<HealthResponse> {
    return this.client.get<HealthResponse>(`/${endpointId}/health`);
  }

  async waitForJob(endpointId: string, jobId: string, maxWaitMs = 300000, pollIntervalMs = 1000): Promise<Job> {
    const startTime = Date.now();
    while (Date.now() - startTime < maxWaitMs) {
      const job = await this.getJob(endpointId, jobId);
      if (['COMPLETED', 'FAILED', 'CANCELLED', 'TIMED_OUT'].includes(job.status)) {
        return job;
      }
      await new Promise(resolve => setTimeout(resolve, pollIntervalMs));
    }
    throw new Error(`Job ${jobId} did not complete within ${maxWaitMs}ms`);
  }

  getClient(): RunPodClient {
    return this.client;
  }
}

export { RunPodClient } from './client';
