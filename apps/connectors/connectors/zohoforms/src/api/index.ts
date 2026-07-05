// Zoho Forms Connector — Online form builder and survey platform
import { ZohoFormsClient } from './client';
import type {
  ZohoForm,
  ZohoFormEntry,
  ZohoFormField,
  ZohoFormPayment,
  ZohoFormReport,
  ZohoFormsConfig,
  ZohoFormTask,
  ZohoFormTheme,
  ZohoFormWebhook,
  ZohoSharedUser,
  ZohoWorkspace,
} from '../types';

export { ZohoFormsClient, DC_BASES, resolveBaseUrl } from './client';

function enc(value: string): string {
  return encodeURIComponent(value);
}

export class ZohoForms {
  private readonly client: ZohoFormsClient;

  constructor(config: ZohoFormsConfig) {
    this.client = new ZohoFormsClient(config);
  }

  static fromEnv(): ZohoForms {
    const token = process.env.ZOHOFORMS_TOKEN;
    if (!token) {
      throw new Error('ZOHOFORMS_TOKEN is required');
    }
    return new ZohoForms({
      token,
      dataCenter: process.env.ZOHOFORMS_DATA_CENTER,
      baseUrl: process.env.ZOHOFORMS_BASE_URL,
    });
  }

  async listForms(options?: {
    workspaceId?: string;
    from?: number;
    limit?: number;
    sortField?: string;
    sortOrder?: 'asc' | 'desc';
  }): Promise<{ forms: ZohoForm[] }> {
    return this.client.request('/forms', {
      params: {
        workspace_id: options?.workspaceId,
        from: options?.from,
        limit: options?.limit,
        sort_field: options?.sortField,
        sort_order: options?.sortOrder,
      },
    });
  }

  async getForm(formLinkName: string): Promise<{ form: ZohoForm }> {
    return this.client.request(`/forms/${enc(formLinkName)}`);
  }

  async listFormFields(formLinkName: string): Promise<{ fields: ZohoFormField[] }> {
    return this.client.request(`/forms/${enc(formLinkName)}/fields`);
  }

  async listFormReports(formLinkName: string): Promise<{ reports: ZohoFormReport[] }> {
    return this.client.request(`/forms/${enc(formLinkName)}/reports`);
  }

  async listEntries(
    formLinkName: string,
    options?: {
      reportLinkName?: string;
      from?: number;
      limit?: number;
      sortField?: string;
      sortOrder?: 'asc' | 'desc';
      criteria?: string;
    },
  ): Promise<{ entries: ZohoFormEntry[] }> {
    const path = options?.reportLinkName
      ? `/forms/${enc(formLinkName)}/reports/${enc(options.reportLinkName)}/entries`
      : `/forms/${enc(formLinkName)}/entries`;
    return this.client.request(path, {
      params: {
        from: options?.from,
        limit: options?.limit,
        sort_field: options?.sortField,
        sort_order: options?.sortOrder,
        criteria: options?.criteria,
      },
    });
  }

  async getEntry(formLinkName: string, entryId: string): Promise<{ entry: ZohoFormEntry }> {
    return this.client.request(`/forms/${enc(formLinkName)}/entries/${enc(entryId)}`);
  }

  async createEntry(formLinkName: string, data: Record<string, unknown>): Promise<unknown> {
    return this.client.request(`/forms/${enc(formLinkName)}/entries`, {
      method: 'POST',
      body: { data },
    });
  }

  async updateEntry(
    formLinkName: string,
    entryId: string,
    data: Record<string, unknown>,
  ): Promise<unknown> {
    return this.client.request(`/forms/${enc(formLinkName)}/entries/${enc(entryId)}`, {
      method: 'PUT',
      body: { data },
    });
  }

  async deleteEntry(formLinkName: string, entryId: string): Promise<void> {
    await this.client.request(`/forms/${enc(formLinkName)}/entries/${enc(entryId)}`, {
      method: 'DELETE',
    });
  }

  async deleteEntries(formLinkName: string, entryIds: string[]): Promise<void> {
    if (entryIds.length === 0) {
      throw new Error('At least one entry ID is required for bulk delete');
    }
    await this.client.request(`/forms/${enc(formLinkName)}/entries`, {
      method: 'DELETE',
      params: { entry_ids: entryIds.join(',') },
    });
  }

  async listWorkspaces(): Promise<{ workspaces: ZohoWorkspace[] }> {
    return this.client.request('/workspaces');
  }

  async getWorkspace(id: string): Promise<{ workspace: ZohoWorkspace }> {
    return this.client.request(`/workspaces/${enc(id)}`);
  }

  async listFormThemes(): Promise<{ themes: ZohoFormTheme[] }> {
    return this.client.request('/themes');
  }

  async listWebhooks(formLinkName: string): Promise<{ webhooks: ZohoFormWebhook[] }> {
    return this.client.request(`/forms/${enc(formLinkName)}/webhooks`);
  }

  async createWebhook(
    formLinkName: string,
    options: {
      url: string;
      eventTrigger?: 'onsubmit' | 'onapprove' | 'onreject';
      payloadType?: 'json' | 'form' | 'xml';
      customHeaders?: Record<string, string>;
    },
  ): Promise<unknown> {
    return this.client.request(`/forms/${enc(formLinkName)}/webhooks`, {
      method: 'POST',
      body: {
        url: options.url,
        event_trigger: options.eventTrigger,
        payload_type: options.payloadType,
        custom_headers: options.customHeaders,
      },
    });
  }

  async deleteWebhook(formLinkName: string, webhookId: string): Promise<void> {
    await this.client.request(`/forms/${enc(formLinkName)}/webhooks/${enc(webhookId)}`, {
      method: 'DELETE',
    });
  }

  async listApprovers(formLinkName: string): Promise<unknown> {
    return this.client.request(`/forms/${enc(formLinkName)}/approvers`);
  }

  async listTasks(options?: {
    from?: number;
    limit?: number;
    status?: 'pending' | 'approved' | 'rejected' | 'all';
  }): Promise<{ tasks: ZohoFormTask[] }> {
    return this.client.request('/tasks', {
      params: {
        from: options?.from,
        limit: options?.limit,
        status: options?.status,
      },
    });
  }

  async approveEntry(taskId: string, comment?: string): Promise<unknown> {
    return this.client.request(`/tasks/${enc(taskId)}/approve`, {
      method: 'POST',
      body: { comment },
    });
  }

  async rejectEntry(taskId: string, comment?: string): Promise<unknown> {
    return this.client.request(`/tasks/${enc(taskId)}/reject`, {
      method: 'POST',
      body: { comment },
    });
  }

  async listFormPayments(
    formLinkName: string,
    options?: { from?: number; limit?: number },
  ): Promise<{ payments: ZohoFormPayment[] }> {
    return this.client.request(`/forms/${enc(formLinkName)}/payments`, {
      params: { from: options?.from, limit: options?.limit },
    });
  }

  async getFormSettings(formLinkName: string): Promise<unknown> {
    return this.client.request(`/forms/${enc(formLinkName)}/settings`);
  }

  async updateFormSettings(
    formLinkName: string,
    settings: Record<string, unknown>,
  ): Promise<unknown> {
    return this.client.request(`/forms/${enc(formLinkName)}/settings`, {
      method: 'PUT',
      body: { settings },
    });
  }

  async listSharedUsers(formLinkName: string): Promise<{ users: ZohoSharedUser[] }> {
    return this.client.request(`/forms/${enc(formLinkName)}/shared-users`);
  }

  async shareForm(
    formLinkName: string,
    users: Array<{ email: string; role: 'admin' | 'developer' | 'submitter' | 'reviewer' }>,
  ): Promise<unknown> {
    return this.client.request(`/forms/${enc(formLinkName)}/shared-users`, {
      method: 'POST',
      body: { users },
    });
  }

  getClient(): ZohoFormsClient {
    return this.client;
  }
}
