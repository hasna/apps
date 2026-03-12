// LinkedIn Connector Types

// ============================================
// Configuration
// ============================================

export interface LinkedInConfig {
  accessToken: string;
  baseUrl?: string;
}

// ============================================
// Common Types
// ============================================

export type OutputFormat = 'json' | 'pretty';

export interface PaginatedResponse<T> {
  elements: T[];
  paging?: {
    count: number;
    start: number;
    links?: Array<{
      rel: string;
      href: string;
      type: string;
    }>;
    total?: number;
  };
}

// ============================================
// Profile Types
// ============================================

export interface Profile {
  id: string;
  localizedFirstName?: string;
  localizedLastName?: string;
  localizedHeadline?: string;
  vanityName?: string;
  firstName?: LocalizedString;
  lastName?: LocalizedString;
  headline?: LocalizedString;
  profilePicture?: ProfilePicture;
}

export interface LocalizedString {
  localized: Record<string, string>;
  preferredLocale: {
    country: string;
    language: string;
  };
}

export interface ProfilePicture {
  displayImage: string;
  'displayImage~'?: {
    elements: Array<{
      identifiers: Array<{
        identifier: string;
        identifierType: string;
        identifierExpiresInSeconds?: number;
        mediaType?: string;
      }>;
    }>;
  };
}

export interface EmailAddress {
  elements: Array<{
    'handle~': {
      emailAddress: string;
    };
    handle: string;
  }>;
}

// ============================================
// Organization Types
// ============================================

export interface Organization {
  id: number;
  localizedName?: string;
  localizedDescription?: string;
  vanityName?: string;
  localizedWebsite?: string;
  logoV2?: {
    original: string;
    'original~'?: {
      elements: Array<{
        identifiers: Array<{
          identifier: string;
        }>;
      }>;
    };
  };
  organizationType?: string;
  industries?: string[];
  specialties?: string[];
  staffCountRange?: string;
  locations?: OrganizationLocation[];
  foundedOn?: {
    year: number;
    month?: number;
    day?: number;
  };
}

export interface OrganizationLocation {
  country: string;
  geographicArea?: string;
  city?: string;
  postalCode?: string;
  line1?: string;
  line2?: string;
}

export interface OrganizationAcls {
  elements: Array<{
    organizationalTarget: string;
    role: string;
    roleAssignee: string;
    state: string;
  }>;
}

// ============================================
// Post/Share Types
// ============================================

export type ShareMediaCategory = 'NONE' | 'ARTICLE' | 'IMAGE' | 'VIDEO' | 'CAROUSEL' | 'DOCUMENT';
export type Visibility = 'PUBLIC' | 'CONNECTIONS' | 'LOGGED_IN' | 'CONTAINER';

export interface Post {
  id: string;
  author: string;
  lifecycleState: 'DRAFT' | 'PUBLISHED' | 'DELETED';
  visibility: {
    'com.linkedin.ugc.MemberNetworkVisibility'?: Visibility;
  };
  specificContent: {
    'com.linkedin.ugc.ShareContent': ShareContent;
  };
  created: {
    time: number;
    actor: string;
  };
  lastModified?: {
    time: number;
    actor: string;
  };
}

export interface ShareContent {
  shareCommentary: {
    text: string;
    attributes?: Array<{
      start: number;
      length: number;
      value: {
        'com.linkedin.common.MemberAttributedEntity'?: {
          member: string;
        };
        'com.linkedin.common.CompanyAttributedEntity'?: {
          company: string;
        };
        'com.linkedin.common.HashtagAttributedEntity'?: {
          hashtag: string;
        };
      };
    }>;
  };
  shareMediaCategory: ShareMediaCategory;
  media?: ShareMedia[];
}

export interface ShareMedia {
  status: 'READY' | 'PROCESSING' | 'PROCESSING_FAILED';
  description?: {
    text: string;
  };
  media?: string;
  originalUrl?: string;
  title?: {
    text: string;
  };
  thumbnails?: Array<{
    url: string;
  }>;
}

export interface CreatePostParams {
  author: string;
  lifecycleState?: 'DRAFT' | 'PUBLISHED';
  visibility: Visibility;
  commentary: string;
  shareMediaCategory?: ShareMediaCategory;
  media?: Array<{
    status: 'READY';
    media?: string;
    originalUrl?: string;
    title?: string;
    description?: string;
  }>;
}

// ============================================
// UGC Post Types (New API)
// ============================================

export interface UgcPost {
  author: string;
  lifecycleState: 'DRAFT' | 'PUBLISHED' | 'DELETED';
  specificContent: {
    'com.linkedin.ugc.ShareContent': ShareContent;
  };
  visibility: {
    'com.linkedin.ugc.MemberNetworkVisibility': Visibility;
  };
  created?: {
    time: number;
    actor: string;
  };
}

export interface CreateUgcPostParams {
  author: string;
  lifecycleState?: 'DRAFT' | 'PUBLISHED';
  visibility: Visibility;
  commentary: string;
  shareMediaCategory?: ShareMediaCategory;
  media?: Array<{
    status: 'READY';
    media?: string;
    originalUrl?: string;
    title?: string;
    description?: string;
  }>;
}

// ============================================
// Media/Asset Types
// ============================================

export interface RegisterUploadRequest {
  recipes: string[];
  owner: string;
  serviceRelationships: Array<{
    relationshipType: string;
    identifier: string;
  }>;
}

export interface RegisterUploadResponse {
  value: {
    uploadMechanism: {
      'com.linkedin.digitalmedia.uploading.MediaUploadHttpRequest': {
        headers: Record<string, string>;
        uploadUrl: string;
      };
    };
    mediaArtifact: string;
    asset: string;
  };
}

export interface ImageUploadParams {
  owner: string;
  filePath?: string;
  fileBuffer?: Buffer;
  fileName?: string;
}

// ============================================
// Analytics Types
// ============================================

export interface ShareStatistics {
  totalShareStatistics: {
    shareCount: number;
    clickCount: number;
    likeCount: number;
    commentCount: number;
    impressionCount: number;
    engagement: number;
    uniqueImpressionsCount?: number;
  };
  share: string;
}

export interface OrganizationFollowerStatistics {
  elements: Array<{
    followerCounts: {
      organicFollowerCount: number;
      paidFollowerCount: number;
    };
    organizationalEntity: string;
    timeRange?: {
      start: number;
      end: number;
    };
  }>;
  paging?: {
    count: number;
    start: number;
    total?: number;
  };
}

export interface OrganizationPageStatistics {
  elements: Array<{
    totalPageStatistics: {
      views: {
        mobileProductsPageViews?: {
          pageViews: number;
          uniquePageViews: number;
        };
        desktopProductsPageViews?: {
          pageViews: number;
          uniquePageViews: number;
        };
        careersPageViews?: {
          pageViews: number;
          uniquePageViews: number;
        };
        overviewPageViews?: {
          pageViews: number;
          uniquePageViews: number;
        };
        allDesktopPageViews?: {
          pageViews: number;
          uniquePageViews: number;
        };
        allMobilePageViews?: {
          pageViews: number;
          uniquePageViews: number;
        };
      };
      clicks?: {
        careersPageClicks?: {
          careersPageJobsClicks: number;
        };
        mobileCareersPageClicks?: {
          careersPageJobsClicks: number;
        };
        desktopCareersPageClicks?: {
          careersPageJobsClicks: number;
        };
      };
    };
    organization: string;
    timeRange?: {
      start: number;
      end: number;
    };
  }>;
  paging?: {
    count: number;
    start: number;
    total?: number;
  };
}

// ============================================
// Connection Types
// ============================================

export interface ConnectionStats {
  firstDegreeSize: number;
}

// ============================================
// Comment Types
// ============================================

export interface Comment {
  id: string;
  actor: string;
  message: {
    text: string;
  };
  created: {
    time: number;
    actor: string;
  };
  parentComment?: string;
  object: string;
}

export interface CommentListResponse {
  elements: Comment[];
  paging?: {
    count: number;
    start: number;
    links?: Array<{
      rel: string;
      href: string;
    }>;
    total?: number;
  };
}

export interface CreateCommentParams {
  actor: string;
  message: string;
  object: string;
  parentComment?: string;
}

// ============================================
// Reaction Types
// ============================================

export type ReactionType = 'LIKE' | 'CELEBRATION' | 'LOVE' | 'INSIGHTFUL' | 'CURIOUS' | 'SUPPORT' | 'FUNNY';

export interface Reaction {
  actor: string;
  created: {
    time: number;
    actor: string;
  };
  reactionType: ReactionType;
  object: string;
}

export interface ReactionListResponse {
  elements: Reaction[];
  paging?: {
    count: number;
    start: number;
    total?: number;
  };
}

export interface CreateReactionParams {
  actor: string;
  reactionType: ReactionType;
  object: string;
}

// ============================================
// API Error Types
// ============================================

export interface LinkedInErrorDetail {
  code: string;
  message: string;
  status?: number;
}

export interface LinkedInErrorResponse {
  status: number;
  serviceErrorCode?: number;
  code?: string;
  message: string;
}

export class LinkedInApiError extends Error {
  public readonly statusCode: number;
  public readonly serviceErrorCode?: number;
  public readonly linkedInCode?: string;

  constructor(message: string, statusCode: number, serviceErrorCode?: number, code?: string) {
    super(message);
    this.name = 'LinkedInApiError';
    this.statusCode = statusCode;
    this.serviceErrorCode = serviceErrorCode;
    this.linkedInCode = code;
  }
}
