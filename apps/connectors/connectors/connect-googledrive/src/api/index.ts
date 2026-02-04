import { DriveClient } from './client.ts';
import { FilesApi } from './files.ts';
import { FoldersApi } from './folders.ts';
import { TrashApi } from './trash.ts';
import { StorageApi } from './storage.ts';
import { DrivesApi } from './drives.ts';

export class Drive {
  private readonly client: DriveClient;

  // API modules
  public readonly files: FilesApi;
  public readonly folders: FoldersApi;
  public readonly trash: TrashApi;
  public readonly storage: StorageApi;
  public readonly drives: DrivesApi;

  constructor() {
    this.client = new DriveClient();
    this.files = new FilesApi(this.client);
    this.folders = new FoldersApi(this.client);
    this.trash = new TrashApi(this.client);
    this.storage = new StorageApi(this.client);
    this.drives = new DrivesApi(this.client);
  }

  /**
   * Create a Drive client - tokens are loaded automatically from config
   */
  static create(): Drive {
    return new Drive();
  }

  /**
   * Get the underlying client for direct API access
   */
  getClient(): DriveClient {
    return this.client;
  }
}

export { DriveClient } from './client.ts';
export { FilesApi } from './files.ts';
export { FoldersApi } from './folders.ts';
export { TrashApi } from './trash.ts';
export { StorageApi } from './storage.ts';
export { DrivesApi } from './drives.ts';
