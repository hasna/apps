// Zoho Recruit Connector — Applicant tracking and recruiting workflows
import { ZohoRecruitClient } from './client';
import type {
  ZohoRecruitConfig,
  ZohoRecruitRecord,
  ZohoRecruitRecordList,
  ZohoRecruitModule,
  ZohoRecruitField,
  ZohoRecruitLayout,
  ZohoRecruitCustomView,
  ZohoRecruitUser,
  ZohoRecruitNote,
  ZohoRecruitAttachment,
  ZohoRecruitTag,
  ZohoRecruitWebhook,
  ZohoRecruitOrganization,
} from '../types';

export { ZohoRecruitClient, RECRUIT_DC_BASES, resolveRecruitBaseUrl } from './client';

type RecruitModule = string;

export class ZohoRecruit {
  private readonly client: ZohoRecruitClient;

  constructor(config: ZohoRecruitConfig) {
    this.client = new ZohoRecruitClient(config);
  }

  static fromEnv(): ZohoRecruit {
    const token = process.env.ZOHORECRUIT_TOKEN;
    if (!token) throw new Error('ZOHORECRUIT_TOKEN is required');
    return new ZohoRecruit({
      token,
      dataCenter: process.env.ZOHORECRUIT_DATA_CENTER,
      baseUrl: process.env.ZOHORECRUIT_BASE_URL,
    });
  }

  async listRecords(
    module: RecruitModule,
    options?: {
      fields?: string | string[];
      sort_by?: string;
      sort_order?: 'asc' | 'desc';
      per_page?: number;
      page?: number;
      cvid?: string;
    },
  ): Promise<ZohoRecruitRecordList> {
    const fields = Array.isArray(options?.fields) ? options.fields.join(',') : options?.fields;
    return this.client.request(`/${module}`, {
      params: {
        fields,
        sort_by: options?.sort_by,
        sort_order: options?.sort_order,
        per_page: options?.per_page,
        page: options?.page,
        cvid: options?.cvid,
      },
    });
  }

  async getRecord(
    module: RecruitModule,
    recordId: string,
    options?: { fields?: string | string[] },
  ): Promise<{ data: ZohoRecruitRecord[] }> {
    const fields = Array.isArray(options?.fields) ? options.fields.join(',') : options?.fields;
    return this.client.request(`/${module}/${recordId}`, { params: { fields } });
  }

  async createRecords(
    module: RecruitModule,
    data: Array<Record<string, unknown>>,
    options?: { trigger?: string[] },
  ): Promise<{ data: Array<{ details: { id: string } }> }> {
    return this.client.request(`/${module}`, {
      method: 'POST',
      body: { data, trigger: options?.trigger },
    });
  }

  async updateRecords(
    module: RecruitModule,
    data: Array<Record<string, unknown>>,
    options?: { trigger?: string[] },
  ): Promise<{ data: Array<{ details: { id: string } }> }> {
    return this.client.request(`/${module}`, {
      method: 'PUT',
      body: { data, trigger: options?.trigger },
    });
  }

  async upsertRecords(
    module: RecruitModule,
    data: Array<Record<string, unknown>>,
    options?: { duplicate_check_fields?: string[]; trigger?: string[] },
  ): Promise<{ data: Array<{ details: { id: string } }> }> {
    return this.client.request(`/${module}/upsert`, {
      method: 'POST',
      body: {
        data,
        duplicate_check_fields: options?.duplicate_check_fields,
        trigger: options?.trigger,
      },
    });
  }

  async deleteRecords(module: RecruitModule, ids: string[]): Promise<void> {
    await this.client.request(`/${module}`, {
      method: 'DELETE',
      params: { ids: ids.join(',') },
    });
  }

  async deleteRecord(module: RecruitModule, recordId: string): Promise<void> {
    await this.client.request(`/${module}/${recordId}`, { method: 'DELETE' });
  }

  async searchRecords(
    module: RecruitModule,
    options?: {
      criteria?: string;
      email?: string;
      phone?: string;
      word?: string;
      per_page?: number;
      page?: number;
    },
  ): Promise<ZohoRecruitRecordList> {
    return this.client.request(`/${module}/search`, { params: options });
  }

  async associateCandidates(
    jobId: string,
    data: Array<{ ids: string[]; comments?: string }>,
  ): Promise<unknown> {
    return this.client.request('/Candidates/actions/associate', {
      method: 'PUT',
      body: {
        data: data.flatMap(item =>
          item.ids.map(candidateId => ({
            Candidate_ID: candidateId,
            Job_Opening_ID: jobId,
            Comments: item.comments,
          })),
        ),
      },
    });
  }

  async getAssociatedCandidates(
    jobId: string,
    options?: { per_page?: number; page?: number },
  ): Promise<ZohoRecruitRecordList> {
    return this.client.request(`/JobOpenings/${jobId}/associate`, { params: options });
  }

  async changeCandidateStatus(
    jobId: string,
    data: Array<{ ids: string[]; status: string; comments?: string }>,
  ): Promise<unknown> {
    return this.client.request('/Candidates/status', {
      method: 'PUT',
      body: {
        data: data.flatMap(item =>
          item.ids.map(candidateId => ({
            id: candidateId,
            Job_Opening_ID: jobId,
            Candidate_Status: item.status,
            Comments: item.comments,
          })),
        ),
      },
    });
  }

  async getCandidateStatusHistory(
    candidateId: string,
    options?: { job_id?: string },
  ): Promise<unknown> {
    return this.client.request(`/Candidates/${candidateId}/StatusHistory`, {
      params: { job_id: options?.job_id },
    });
  }

  async listNotes(
    module: RecruitModule,
    recordId: string,
    options?: { per_page?: number; page?: number },
  ): Promise<{ data: ZohoRecruitNote[] }> {
    return this.client.request(`/${module}/${recordId}/Notes`, { params: options });
  }

  async createNote(
    module: RecruitModule,
    recordId: string,
    content: string,
    options?: { title?: string },
  ): Promise<{ data: Array<{ details: { id: string } }> }> {
    return this.client.request(`/${module}/${recordId}/Notes`, {
      method: 'POST',
      body: { data: [{ Note_Title: options?.title, Note_Content: content }] },
    });
  }

  async listAttachments(
    module: RecruitModule,
    recordId: string,
  ): Promise<{ data: ZohoRecruitAttachment[] }> {
    return this.client.request(`/${module}/${recordId}/Attachments`);
  }

  async deleteAttachment(
    module: RecruitModule,
    recordId: string,
    attachmentId: string,
  ): Promise<void> {
    await this.client.request(`/${module}/${recordId}/Attachments/${attachmentId}`, {
      method: 'DELETE',
    });
  }

  async listModules(): Promise<{ modules: ZohoRecruitModule[] }> {
    return this.client.request('/settings/modules');
  }

  async getModule(module: RecruitModule): Promise<{ modules: ZohoRecruitModule[] }> {
    return this.client.request(`/settings/modules/${module}`);
  }

  async listFields(module: RecruitModule): Promise<{ fields: ZohoRecruitField[] }> {
    return this.client.request('/settings/fields', { params: { module } });
  }

  async listLayouts(module: RecruitModule): Promise<{ layouts: ZohoRecruitLayout[] }> {
    return this.client.request('/settings/layouts', { params: { module } });
  }

  async listCustomViews(module: RecruitModule): Promise<{ custom_views: ZohoRecruitCustomView[] }> {
    return this.client.request('/settings/custom_views', { params: { module } });
  }

  async listUsers(options?: {
    type?:
      | 'AllUsers'
      | 'ActiveUsers'
      | 'DeactiveUsers'
      | 'ConfirmedUsers'
      | 'NotConfirmedUsers'
      | 'DeletedUsers'
      | 'AdminUsers'
      | 'ActiveConfirmedUsers';
  }): Promise<{ users: ZohoRecruitUser[] }> {
    return this.client.request('/users', { params: { type: options?.type } });
  }

  async getUser(userId: string): Promise<{ users: ZohoRecruitUser[] }> {
    return this.client.request(`/users/${userId}`);
  }

  async listTags(module: RecruitModule): Promise<{ tags: ZohoRecruitTag[] }> {
    return this.client.request('/settings/tags', { params: { module } });
  }

  async addTagsToRecord(
    module: RecruitModule,
    recordId: string,
    tagNames: string[],
    options?: { over_write?: boolean },
  ): Promise<unknown> {
    return this.client.request(`/${module}/${recordId}/actions/add_tags`, {
      method: 'POST',
      params: {
        tag_names: tagNames.join(','),
        over_write: options?.over_write,
      },
    });
  }

  async removeTagsFromRecord(
    module: RecruitModule,
    recordId: string,
    tagNames: string[],
  ): Promise<unknown> {
    return this.client.request(`/${module}/${recordId}/actions/remove_tags`, {
      method: 'POST',
      params: { tag_names: tagNames.join(',') },
    });
  }

  async createWebhook(options: {
    notify_url: string;
    channel_id: string;
    events: string[];
    token?: string;
    channel_expiry?: string;
  }): Promise<unknown> {
    return this.client.request('/actions/watch', {
      method: 'POST',
      body: {
        watch: [
          {
            channel_id: options.channel_id,
            events: options.events,
            notify_url: options.notify_url,
            token: options.token,
            channel_expiry: options.channel_expiry,
          },
        ],
      },
    });
  }

  async listWebhooks(): Promise<{ watch: ZohoRecruitWebhook[] }> {
    return this.client.request('/actions/watch');
  }

  async deleteWebhooks(channelIds: string[]): Promise<void> {
    await this.client.request('/actions/watch', {
      method: 'DELETE',
      params: { channel_ids: channelIds.join(',') },
    });
  }

  async getOrganization(): Promise<{ org: ZohoRecruitOrganization[] }> {
    return this.client.request('/org');
  }

  getClient(): ZohoRecruitClient {
    return this.client;
  }
}
