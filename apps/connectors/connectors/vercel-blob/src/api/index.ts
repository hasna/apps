import { VercelBlobClient } from './client';
import type {
  BlobAccessType,
  CreateBlobOptions,
  CreateBlobResult,
  GetBlobResult,
  HeadBlobResult,
  ListBlobsOptions,
  ListBlobsResult,
  RawRequestOptions,
  SearchBlobsOptions,
  VercelBlobConfig,
} from '../types';

export { VercelBlobClient, DEFAULT_API_URL, BLOB_API_VERSION } from './client';

export class VercelBlob {
  private client: VercelBlobClient;

  constructor(config: VercelBlobConfig) {
    this.client = new VercelBlobClient(config);
  }

  getClient(): VercelBlobClient {
    return this.client;
  }

  getStoreId(): string {
    return this.client.getStoreId();
  }

  createBlob(pathname: string, body: BodyInit, options: CreateBlobOptions): Promise<CreateBlobResult> {
    return this.client.createBlob(pathname, body, options);
  }

  listBlobs(options?: ListBlobsOptions): Promise<ListBlobsResult> {
    return this.client.listBlobs(options);
  }

  searchBlobs(options?: SearchBlobsOptions): Promise<ListBlobsResult> {
    return this.client.searchBlobs(options);
  }

  listEvents(): Promise<never> {
    return this.client.listEvents();
  }

  head(urlOrPathname: string): Promise<HeadBlobResult> {
    return this.client.head(urlOrPathname);
  }

  getBlob(urlOrPathname: string, access: BlobAccessType): Promise<GetBlobResult | null> {
    return this.client.getBlob(urlOrPathname, access);
  }

  rawRequest(method: string, path: string, options?: RawRequestOptions): Promise<unknown> {
    return this.client.rawRequest(method, path, options);
  }
}
