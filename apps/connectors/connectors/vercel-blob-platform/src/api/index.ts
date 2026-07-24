import { VercelBlobPlatformClient } from './client';
import type {
  BlobAccessType,
  DeleteBlobOptions,
  GetBlobResult,
  HeadBlobResult,
  ListBlobsOptions,
  ListBlobsResult,
  PutBlobOptions,
  PutBlobResult,
  VercelBlobPlatformConfig,
} from '../types';

export { VercelBlobPlatformClient, DEFAULT_API_URL, BLOB_API_VERSION } from './client';

export class VercelBlobPlatform {
  private client: VercelBlobPlatformClient;

  constructor(config: VercelBlobPlatformConfig) {
    this.client = new VercelBlobPlatformClient(config);
  }

  getClient(): VercelBlobPlatformClient {
    return this.client;
  }

  getStoreId(): string {
    return this.client.getStoreId();
  }

  put(pathname: string, body: BodyInit, options: PutBlobOptions): Promise<PutBlobResult> {
    return this.client.put(pathname, body, options);
  }

  list(options?: ListBlobsOptions): Promise<ListBlobsResult> {
    return this.client.list(options);
  }

  del(urlOrPathnames: string | string[], options?: DeleteBlobOptions): Promise<void> {
    return this.client.del(urlOrPathnames, options);
  }

  head(urlOrPathname: string): Promise<HeadBlobResult> {
    return this.client.head(urlOrPathname);
  }

  get(urlOrPathname: string, access: BlobAccessType): Promise<GetBlobResult | null> {
    return this.client.get(urlOrPathname, access);
  }
}
