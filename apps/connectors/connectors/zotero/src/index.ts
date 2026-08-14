export { Zotero, ZoteroClient, ItemsApi, CollectionsApi, AttachmentsApi } from './api';
export {
  DEFAULT_BASE_URL,
  ZOTERO_API_VERSION,
  normalizeLibraryType,
  buildLibraryPrefix,
  buildZoteroUrl,
} from './api';

export type {
  ZoteroConfig,
  CliConfig,
  LibraryType,
  ZoteroItem,
  ZoteroCollection,
  ListItemsOptions,
  CreateItemInput,
  UpdateItemInput,
  CreateCollectionInput,
  CreateAttachmentInput,
  UploadFileInput,
  UploadAuthResponse,
  CreateItemsResponse,
  RequestOptions,
  OutputFormat,
} from './types';

export { ZoteroApiError } from './types';
