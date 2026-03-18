// Zoho WorkDrive Connector — Team file storage and collaboration
import { ZohoWorkDriveClient } from './client';
import type { ZohoWorkDriveConfig, ZWDFile, ZWDFolder, ZWDTeam, ZWDUser } from '../types';
export { ZohoWorkDriveClient } from './client';

export class ZohoWorkDrive {
  private readonly client: ZohoWorkDriveClient;
  constructor(config: ZohoWorkDriveConfig) { this.client = new ZohoWorkDriveClient(config); }
  static fromEnv(): ZohoWorkDrive {
    const token = process.env.ZOHOWORKDRIVE_TOKEN;
    const teamId = process.env.ZOHOWORKDRIVE_TEAM_ID;
    if (!token || !teamId) throw new Error('ZOHOWORKDRIVE_TOKEN and ZOHOWORKDRIVE_TEAM_ID are required');
    return new ZohoWorkDrive({ token, teamId, baseUrl: process.env.ZOHOWORKDRIVE_BASE_URL });
  }

  async getTeam(): Promise<{ data: ZWDTeam }> { return this.client.request(`/teams/${this.client.getTeamId()}`); }
  async listTeamMembers(): Promise<{ data: ZWDUser[] }> { return this.client.request(`/teams/${this.client.getTeamId()}/members`); }

  async listFiles(folderId: string, options?: { page?: number; per_page?: number }): Promise<{ data: ZWDFile[] }> {
    return this.client.request(`/files/${folderId}/files`, { params: { 'page[offset]': options?.page, 'page[limit]': options?.per_page } });
  }
  async getFile(fileId: string): Promise<{ data: ZWDFile }> { return this.client.request(`/files/${fileId}`); }
  async deleteFile(fileId: string): Promise<void> { await this.client.request(`/files/${fileId}`, { method: 'DELETE' }); }
  async renameFile(fileId: string, name: string): Promise<{ data: ZWDFile }> {
    return this.client.request(`/files/${fileId}`, { method: 'PATCH', body: { data: { attributes: { name }, type: 'files' } } });
  }

  async listFolders(parentId: string): Promise<{ data: ZWDFolder[] }> {
    return this.client.request(`/files/${parentId}/files`, { params: { filter: 'folder' } });
  }
  async createFolder(parentId: string, name: string): Promise<{ data: ZWDFolder }> {
    return this.client.request('/files', { method: 'POST', body: { data: { attributes: { name, parent_id: parentId }, type: 'files' } } });
  }

  async searchFiles(query: string): Promise<{ data: ZWDFile[] }> {
    return this.client.request(`/teams/${this.client.getTeamId()}/files/search`, { params: { search_string: query } });
  }

  getClient(): ZohoWorkDriveClient { return this.client; }
}
