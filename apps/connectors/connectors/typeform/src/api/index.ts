import { TypeformClient, encodePathSegment } from './client';
import type {
  TypeformConfig,
  TypeformForm,
  TypeformFormsList,
  TypeformImage,
  TypeformPaginated,
  TypeformResponse,
  TypeformResponsesList,
  TypeformTheme,
  TypeformWebhook,
  TypeformWorkspace,
  TypeformMethod,
  QueryValue,
} from '../types';

export { TypeformClient, encodePathSegment } from './client';

export class Typeform {
  private readonly client: TypeformClient;

  constructor(config: TypeformConfig) {
    this.client = new TypeformClient(config);
  }

  static fromEnv(): Typeform {
    const apiToken = process.env.TYPEFORM_API_TOKEN;
    if (!apiToken) {
      throw new Error('TYPEFORM_API_TOKEN environment variable is required');
    }
    return new Typeform({
      apiToken,
      baseUrl: process.env.TYPEFORM_BASE_URL,
    });
  }

  getClient(): TypeformClient {
    return this.client;
  }

  // Forms
  async listForms(options?: {
    page?: number;
    pageSize?: number;
    search?: string;
    workspaceId?: string;
  }): Promise<TypeformFormsList> {
    return this.client.get<TypeformFormsList>('/forms', {
      page: options?.page,
      page_size: options?.pageSize,
      search: options?.search,
      workspace_id: options?.workspaceId,
    });
  }

  async getForm(formId: string): Promise<TypeformForm> {
    return this.client.get<TypeformForm>(`/forms/${encodePathSegment(formId)}`);
  }

  async createForm(input: {
    title: string;
    fields?: Array<Record<string, unknown>>;
    settings?: Record<string, unknown>;
  }): Promise<TypeformForm> {
    return this.client.post<TypeformForm>('/forms', {
      title: input.title,
      fields: input.fields ?? [],
      settings: input.settings,
    });
  }

  async updateForm(formId: string, form: Record<string, unknown>): Promise<TypeformForm> {
    return this.client.put<TypeformForm>(`/forms/${encodePathSegment(formId)}`, form);
  }

  async patchForm(formId: string, form: Record<string, unknown>): Promise<TypeformForm> {
    return this.client.patch<TypeformForm>(`/forms/${encodePathSegment(formId)}`, form);
  }

  async deleteForm(formId: string): Promise<void> {
    await this.client.delete(`/forms/${encodePathSegment(formId)}`);
  }

  // Responses
  async listResponses(formId: string, options?: {
    pageSize?: number;
    since?: string;
    until?: string;
    completed?: boolean;
    before?: string;
    after?: string;
  }): Promise<TypeformResponsesList> {
    return this.client.get<TypeformResponsesList>(
      `/forms/${encodePathSegment(formId)}/responses`,
      {
        page_size: options?.pageSize,
        since: options?.since,
        until: options?.until,
        completed: options?.completed,
        before: options?.before,
        after: options?.after,
      },
    );
  }

  async deleteResponses(formId: string, includedTokens: string[]): Promise<void> {
    await this.client.delete(
      `/forms/${encodePathSegment(formId)}/responses`,
      { included_tokens: includedTokens },
    );
  }

  // Webhooks
  async listWebhooks(formId: string): Promise<{ items: TypeformWebhook[] }> {
    return this.client.get<{ items: TypeformWebhook[] }>(
      `/forms/${encodePathSegment(formId)}/webhooks`,
    );
  }

  async getWebhook(formId: string, tag: string): Promise<TypeformWebhook> {
    return this.client.get<TypeformWebhook>(
      `/forms/${encodePathSegment(formId)}/webhooks/${encodePathSegment(tag)}`,
    );
  }

  async createOrUpdateWebhook(input: {
    formId: string;
    tag: string;
    url: string;
    enabled?: boolean;
    secret?: string;
    verifySsl?: boolean;
  }): Promise<TypeformWebhook> {
    return this.client.put<TypeformWebhook>(
      `/forms/${encodePathSegment(input.formId)}/webhooks/${encodePathSegment(input.tag)}`,
      {
        url: input.url,
        enabled: input.enabled ?? true,
        secret: input.secret,
        verify_ssl: input.verifySsl,
      },
    );
  }

  async deleteWebhook(formId: string, tag: string): Promise<void> {
    await this.client.delete(
      `/forms/${encodePathSegment(formId)}/webhooks/${encodePathSegment(tag)}`,
    );
  }

  // Workspaces
  async listWorkspaces(options?: {
    page?: number;
    pageSize?: number;
    search?: string;
  }): Promise<TypeformPaginated<TypeformWorkspace>> {
    return this.client.get<TypeformPaginated<TypeformWorkspace>>('/workspaces', {
      page: options?.page,
      page_size: options?.pageSize,
      search: options?.search,
    });
  }

  async getWorkspace(workspaceId: string): Promise<TypeformWorkspace> {
    return this.client.get<TypeformWorkspace>(`/workspaces/${encodePathSegment(workspaceId)}`);
  }

  async updateWorkspace(workspaceId: string, name: string): Promise<TypeformWorkspace> {
    return this.client.patch<TypeformWorkspace>(
      `/workspaces/${encodePathSegment(workspaceId)}`,
      { name },
    );
  }

  async listWorkspaceForms(workspaceId: string, options?: {
    page?: number;
    pageSize?: number;
    search?: string;
  }): Promise<TypeformFormsList> {
    return this.client.get<TypeformFormsList>(
      `/workspaces/${encodePathSegment(workspaceId)}/forms`,
      {
        page: options?.page,
        page_size: options?.pageSize,
        search: options?.search,
      },
    );
  }

  // Themes
  async listThemes(options?: { page?: number; pageSize?: number }): Promise<TypeformPaginated<TypeformTheme>> {
    return this.client.get<TypeformPaginated<TypeformTheme>>('/themes', {
      page: options?.page,
      page_size: options?.pageSize,
    });
  }

  async getTheme(themeId: string): Promise<TypeformTheme> {
    return this.client.get<TypeformTheme>(`/themes/${encodePathSegment(themeId)}`);
  }

  async createTheme(theme: Record<string, unknown>): Promise<TypeformTheme> {
    return this.client.post<TypeformTheme>('/themes', theme);
  }

  async updateTheme(themeId: string, theme: Record<string, unknown>): Promise<TypeformTheme> {
    return this.client.put<TypeformTheme>(`/themes/${encodePathSegment(themeId)}`, theme);
  }

  async deleteTheme(themeId: string): Promise<void> {
    await this.client.delete(`/themes/${encodePathSegment(themeId)}`);
  }

  // Images
  async listImages(options?: { page?: number; pageSize?: number }): Promise<TypeformPaginated<TypeformImage>> {
    return this.client.get<TypeformPaginated<TypeformImage>>('/images', {
      page: options?.page,
      page_size: options?.pageSize,
    });
  }

  async getImage(imageId: string): Promise<TypeformImage> {
    return this.client.get<TypeformImage>(`/images/${encodePathSegment(imageId)}`);
  }

  async createImage(image: Record<string, unknown>): Promise<TypeformImage> {
    return this.client.post<TypeformImage>('/images', image);
  }

  async deleteImage(imageId: string): Promise<void> {
    await this.client.delete(`/images/${encodePathSegment(imageId)}`);
  }

  async rawRequest<T = unknown>(options: {
    path: string;
    method?: TypeformMethod;
    query?: Record<string, QueryValue>;
    body?: Record<string, unknown>;
  }): Promise<T> {
    const path = options.path.startsWith('/') ? options.path : `/${options.path}`;
    return this.client.request<T>(path, {
      method: options.method,
      params: options.query,
      body: options.body,
    });
  }
}

export type { TypeformResponse };
