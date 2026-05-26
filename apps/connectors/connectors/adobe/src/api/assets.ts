import type { ConnectorClient } from './client';
import type { AssetUploadResponse } from '../types';

export class AssetsApi {
  constructor(private readonly client: ConnectorClient) {}

  /**
   * Get an upload URI for a new asset
   */
  async getUploadUri(mediaType: string = 'application/pdf'): Promise<AssetUploadResponse> {
    return this.client.post<AssetUploadResponse>('/assets', {
      mediaType,
    });
  }

  /**
   * Upload a file: get presigned URI then PUT the file data
   */
  async upload(fileData: Buffer | Uint8Array, mediaType: string = 'application/pdf'): Promise<string> {
    const { uploadUri, assetID } = await this.getUploadUri(mediaType);
    await this.client.uploadToUri(uploadUri, fileData, mediaType);
    return assetID;
  }

  /**
   * Delete an asset
   */
  async delete(assetID: string): Promise<void> {
    await this.client.delete(`/assets/${assetID}`);
  }
}
