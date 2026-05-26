import type { WebflowClient } from './client';
import type { Form, FormSubmission } from '../types';

export interface ListFormsOptions {
  offset?: number;
  limit?: number;
}

export interface ListSubmissionsOptions {
  offset?: number;
  limit?: number;
}

/**
 * Webflow Forms API
 */
export class FormsApi {
  constructor(private readonly client: WebflowClient) {}

  /**
   * List all forms for a site
   */
  async list(siteId: string, options: ListFormsOptions = {}): Promise<{ forms: Form[]; pagination: { offset: number; limit: number; total: number } }> {
    const params: Record<string, string | number | boolean | undefined> = {
      offset: options.offset || 0,
      limit: options.limit || 100,
    };

    return this.client.request<{ forms: Form[]; pagination: { offset: number; limit: number; total: number } }>(
      `/sites/${siteId}/forms`,
      { params }
    );
  }

  /**
   * Get a single form by ID
   */
  async get(formId: string): Promise<Form> {
    return this.client.request<Form>(`/forms/${formId}`);
  }

  /**
   * List form submissions
   */
  async listSubmissions(formId: string, options: ListSubmissionsOptions = {}): Promise<{ formSubmissions: FormSubmission[]; pagination: { offset: number; limit: number; total: number } }> {
    const params: Record<string, string | number | boolean | undefined> = {
      offset: options.offset || 0,
      limit: options.limit || 100,
    };

    return this.client.request<{ formSubmissions: FormSubmission[]; pagination: { offset: number; limit: number; total: number } }>(
      `/forms/${formId}/submissions`,
      { params }
    );
  }

  /**
   * Get a single form submission
   */
  async getSubmission(formId: string, submissionId: string): Promise<FormSubmission> {
    return this.client.request<FormSubmission>(
      `/forms/${formId}/submissions/${submissionId}`
    );
  }

  /**
   * Delete a form submission
   */
  async deleteSubmission(formId: string, submissionId: string): Promise<void> {
    await this.client.request<void>(
      `/forms/${formId}/submissions/${submissionId}`,
      { method: 'DELETE' }
    );
  }
}
