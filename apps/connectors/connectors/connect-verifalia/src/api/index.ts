// Verifalia Connector — Email address validation and verification
import { VerifaliaClient } from './client';
import type { VerifaliaConfig, ValidationJob, EmailValidationEntry } from '../types';
export { VerifaliaClient } from './client';

export class Verifalia {
  private readonly client: VerifaliaClient;
  constructor(config: VerifaliaConfig) { this.client = new VerifaliaClient(config); }

  static fromEnv(): Verifalia {
    const username = process.env.VERIFALIA_USERNAME;
    const password = process.env.VERIFALIA_PASSWORD;
    if (!username || !password) throw new Error('VERIFALIA_USERNAME and VERIFALIA_PASSWORD are required');
    return new Verifalia({ username, password });
  }

  /** Submit emails for validation. Returns job ID — poll with getJob until status=Completed. */
  async submitValidation(emails: string[], options?: { quality?: 'Standard' | 'High' | 'Extreme'; deduplication?: 'Off' | 'Safe' | 'Relaxed' }): Promise<ValidationJob> {
    return this.client.request<ValidationJob>('/email-validations', {
      method: 'POST',
      body: {
        entries: emails.map(e => ({ inputData: e })),
        quality: options?.quality || 'Standard',
        deduplication: options?.deduplication || 'Safe',
      },
    });
  }

  /** Get job status and results */
  async getJob(jobId: string): Promise<ValidationJob> {
    return this.client.request<ValidationJob>(`/email-validations/${jobId}`);
  }

  /** Wait for job completion, then return results */
  async waitForResults(jobId: string, maxWaitMs = 60000): Promise<EmailValidationEntry[]> {
    const start = Date.now();
    while (Date.now() - start < maxWaitMs) {
      const job = await this.getJob(jobId);
      if (job.status === 'Completed') return job.entries?.data ?? [];
      if (job.status === 'Expired' || job.status === 'Deleted') throw new Error(`Job ${jobId} ended with status: ${job.status}`);
      await new Promise(r => setTimeout(r, 3000));
    }
    throw new Error(`Job ${jobId} did not complete within ${maxWaitMs}ms`);
  }

  /** Convenience: validate emails synchronously */
  async validate(emails: string | string[], options?: Parameters<Verifalia['submitValidation']>[1]): Promise<EmailValidationEntry[]> {
    const list = Array.isArray(emails) ? emails : [emails];
    const job = await this.submitValidation(list, options);
    return this.waitForResults(job.id);
  }

  /** Delete a validation job */
  async deleteJob(jobId: string): Promise<void> { await this.client.request(`/email-validations/${jobId}`, { method: 'DELETE' }); }

  /** List past validation jobs */
  async listJobs(): Promise<ValidationJob[]> {
    const r = await this.client.request<{ data: ValidationJob[] }>('/email-validations');
    return r.data ?? [];
  }

  getClient(): VerifaliaClient { return this.client; }
}
