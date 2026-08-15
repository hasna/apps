import type { UploadcareClient } from './client';
import type { UploadcareProject } from '../types';

export class ProjectApi {
  constructor(private readonly client: UploadcareClient) {}

  async get(): Promise<UploadcareProject> {
    return this.client.get<UploadcareProject>('/project');
  }
}
