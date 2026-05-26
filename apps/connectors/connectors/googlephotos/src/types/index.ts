// Google Photos API Connector Types

// ============================================
// Configuration
// ============================================

export interface GooglePhotosConfig {
  clientId: string;
  clientSecret: string;
  accessToken?: string;
  refreshToken?: string;
}

export interface OAuth2Tokens {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
  tokenType: string;
  scope: string;
}

export interface CliConfig {
  clientId?: string;
  clientSecret?: string;
  tokens?: OAuth2Tokens;
  userEmail?: string;
}

// ============================================
// Common Types
// ============================================

export type OutputFormat = 'json' | 'table' | 'pretty';

// ============================================
// Media Item Types
// ============================================

export interface MediaItem {
  id: string;
  description?: string;
  productUrl: string;
  baseUrl: string;
  mimeType: string;
  mediaMetadata: MediaMetadata;
  contributorInfo?: ContributorInfo;
  filename: string;
}

export interface MediaMetadata {
  creationTime: string;
  width: string;
  height: string;
  photo?: PhotoMetadata;
  video?: VideoMetadata;
}

export interface PhotoMetadata {
  cameraMake?: string;
  cameraModel?: string;
  focalLength?: number;
  apertureFNumber?: number;
  isoEquivalent?: number;
  exposureTime?: string;
}

export interface VideoMetadata {
  cameraMake?: string;
  cameraModel?: string;
  fps: number;
  status: 'UNSPECIFIED' | 'PROCESSING' | 'READY' | 'FAILED';
}

export interface ContributorInfo {
  profilePictureBaseUrl: string;
  displayName: string;
}

export interface MediaItemsListResponse {
  mediaItems?: MediaItem[];
  nextPageToken?: string;
}

export interface SearchMediaItemsRequest {
  albumId?: string;
  pageSize?: number;
  pageToken?: string;
  filters?: Filters;
  orderBy?: string;
}

export interface Filters {
  dateFilter?: DateFilter;
  contentFilter?: ContentFilter;
  mediaTypeFilter?: MediaTypeFilter;
  featureFilter?: FeatureFilter;
  includeArchivedMedia?: boolean;
  excludeNonAppCreatedData?: boolean;
}

export interface DateFilter {
  dates?: Date[];
  ranges?: DateRange[];
}

export interface Date {
  year: number;
  month: number;
  day: number;
}

export interface DateRange {
  startDate: Date;
  endDate: Date;
}

export interface ContentFilter {
  includedContentCategories?: ContentCategory[];
  excludedContentCategories?: ContentCategory[];
}

export type ContentCategory =
  | 'NONE'
  | 'LANDSCAPES'
  | 'RECEIPTS'
  | 'CITYSCAPES'
  | 'LANDMARKS'
  | 'SELFIES'
  | 'PEOPLE'
  | 'PETS'
  | 'WEDDINGS'
  | 'BIRTHDAYS'
  | 'DOCUMENTS'
  | 'TRAVEL'
  | 'ANIMALS'
  | 'FOOD'
  | 'SPORT'
  | 'NIGHT'
  | 'PERFORMANCES'
  | 'WHITEBOARDS'
  | 'SCREENSHOTS'
  | 'UTILITY'
  | 'ARTS'
  | 'CRAFTS'
  | 'FASHION'
  | 'HOUSES'
  | 'GARDENS'
  | 'FLOWERS'
  | 'HOLIDAYS';

export interface MediaTypeFilter {
  mediaTypes: MediaType[];
}

export type MediaType = 'ALL_MEDIA' | 'VIDEO' | 'PHOTO';

export interface FeatureFilter {
  includedFeatures: Feature[];
}

export type Feature = 'NONE' | 'FAVORITES';

// ============================================
// Album Types
// ============================================

export interface Album {
  id: string;
  title: string;
  productUrl: string;
  isWriteable?: boolean;
  shareInfo?: ShareInfo;
  mediaItemsCount?: string;
  coverPhotoBaseUrl?: string;
  coverPhotoMediaItemId?: string;
}

export interface ShareInfo {
  sharedAlbumOptions: SharedAlbumOptions;
  shareableUrl: string;
  shareToken: string;
  isJoined: boolean;
  isOwned: boolean;
  isJoinable: boolean;
}

export interface SharedAlbumOptions {
  isCollaborative: boolean;
  isCommentable: boolean;
}

export interface AlbumsListResponse {
  albums?: Album[];
  nextPageToken?: string;
}

export interface CreateAlbumRequest {
  album: {
    title: string;
  };
}

export interface ShareAlbumRequest {
  sharedAlbumOptions?: SharedAlbumOptions;
}

export interface ShareAlbumResponse {
  shareInfo: ShareInfo;
}

export interface AddEnrichmentRequest {
  albumId: string;
  newEnrichmentItem: {
    textEnrichment?: {
      text: string;
    };
    locationEnrichment?: {
      location: {
        locationName: string;
        latlng?: {
          latitude: number;
          longitude: number;
        };
      };
    };
    mapEnrichment?: {
      origin: {
        locationName: string;
        latlng?: {
          latitude: number;
          longitude: number;
        };
      };
      destination: {
        locationName: string;
        latlng?: {
          latitude: number;
          longitude: number;
        };
      };
    };
  };
  albumPosition: {
    position: 'FIRST_IN_ALBUM' | 'LAST_IN_ALBUM' | 'AFTER_MEDIA_ITEM' | 'AFTER_ENRICHMENT_ITEM';
    relativeMediaItemId?: string;
    relativeEnrichmentItemId?: string;
  };
}

// ============================================
// Upload Types
// ============================================

export interface NewMediaItem {
  description?: string;
  simpleMediaItem: {
    fileName?: string;
    uploadToken: string;
  };
}

export interface BatchCreateMediaItemsRequest {
  albumId?: string;
  newMediaItems: NewMediaItem[];
  albumPosition?: {
    position: 'FIRST_IN_ALBUM' | 'LAST_IN_ALBUM' | 'AFTER_MEDIA_ITEM' | 'AFTER_ENRICHMENT_ITEM';
    relativeMediaItemId?: string;
    relativeEnrichmentItemId?: string;
  };
}

export interface BatchCreateMediaItemsResponse {
  newMediaItemResults: NewMediaItemResult[];
}

export interface NewMediaItemResult {
  uploadToken: string;
  status: Status;
  mediaItem?: MediaItem;
}

export interface Status {
  code?: number;
  message?: string;
}

export interface BatchAddMediaItemsToAlbumRequest {
  mediaItemIds: string[];
}

export interface BatchRemoveMediaItemsFromAlbumRequest {
  mediaItemIds: string[];
}

// ============================================
// API Error Types
// ============================================

export interface GooglePhotosError {
  code: number;
  message: string;
  status: string;
  details?: Array<{
    '@type': string;
    [key: string]: unknown;
  }>;
}

export class PhotosApiError extends Error {
  public readonly statusCode: number;
  public readonly status: string;
  public readonly details?: GooglePhotosError['details'];

  constructor(message: string, statusCode: number, status: string, details?: GooglePhotosError['details']) {
    super(message);
    this.name = 'PhotosApiError';
    this.statusCode = statusCode;
    this.status = status;
    this.details = details;
  }
}

// ============================================
// List/Search Options
// ============================================

export interface ListMediaItemsOptions {
  pageSize?: number;
  pageToken?: string;
}

export interface ListAlbumsOptions {
  pageSize?: number;
  pageToken?: string;
  excludeNonAppCreatedData?: boolean;
}
