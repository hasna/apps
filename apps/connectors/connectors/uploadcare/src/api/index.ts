import type { UploadcareConfig } from '../types';
import { UploadcareClient } from './client';
import { FilesApi } from './files';
import { GroupsApi } from './groups';
import { WebhooksApi } from './webhooks';
import { ProjectApi } from './project';
import {
  getPublicKey,
  getSecretKey,
  getBaseUrl,
} from '../utils/config';

export class Uploadcare {
  private readonly client: UploadcareClient;

  public readonly files: FilesApi;
  public readonly groups: GroupsApi;
  public readonly webhooks: WebhooksApi;
  public readonly project: ProjectApi;

  constructor(config: UploadcareConfig) {
    this.client = new UploadcareClient(config);
    this.files = new FilesApi(this.client);
    this.groups = new GroupsApi(this.client);
    this.webhooks = new WebhooksApi(this.client);
    this.project = new ProjectApi(this.client);
  }

  static create(): Uploadcare {
    const publicKey = getPublicKey();
    const secretKey = getSecretKey();
    const baseUrl = getBaseUrl();

    if (!publicKey || !secretKey) {
      throw new Error(
        'Uploadcare credentials not configured. ' +
        'Set UPLOADCARE_PUBLIC_KEY and UPLOADCARE_SECRET_KEY environment variables, ' +
        'or run "connect-uploadcare config set-credentials <publicKey> <secretKey>"'
      );
    }

    return new Uploadcare({ publicKey, secretKey, baseUrl });
  }

  static fromEnv(): Uploadcare {
    const publicKey = process.env.UPLOADCARE_PUBLIC_KEY;
    const secretKey = process.env.UPLOADCARE_SECRET_KEY;
    const baseUrl = process.env.UPLOADCARE_BASE_URL;

    if (!publicKey || !secretKey) {
      throw new Error(
        'UPLOADCARE_PUBLIC_KEY and UPLOADCARE_SECRET_KEY environment variables are required'
      );
    }

    return new Uploadcare({ publicKey, secretKey, baseUrl });
  }

  getCredentialPreview(): string {
    return this.client.getCredentialPreview();
  }

  getClient(): UploadcareClient {
    return this.client;
  }

  async rawRequest(
    path: string,
    options: {
      method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
      params?: Record<string, string | number | boolean | undefined>;
      body?: Record<string, unknown> | unknown[] | string;
    } = {}
  ): Promise<unknown> {
    return this.client.request(path, options);
  }
}

export { UploadcareClient } from './client';
export { FilesApi } from './files';
export { GroupsApi } from './groups';
export { WebhooksApi } from './webhooks';
export { ProjectApi } from './project';
