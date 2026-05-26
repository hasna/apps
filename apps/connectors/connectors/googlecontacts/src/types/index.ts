// Google Contacts Connector Types

// ============================================
// Configuration
// ============================================

export interface GoogleContactsConfig {
  clientId: string;
  clientSecret: string;
  accessToken?: string;
  refreshToken?: string;
  redirectUri?: string;
  baseUrl?: string;
}

export interface ProfileConfig {
  clientId?: string;
  clientSecret?: string;
  accessToken?: string;
  refreshToken?: string;
  tokenExpiresAt?: number;
  redirectUri?: string;
}

// ============================================
// OAuth Types
// ============================================

export interface OAuthTokens {
  accessToken: string;
  refreshToken?: string;
  expiresIn?: number;
  expiresAt?: number;
  tokenType?: string;
  scope?: string;
}

export interface OAuthTokenResponse {
  access_token: string;
  refresh_token?: string;
  expires_in?: number;
  token_type?: string;
  scope?: string;
}

// ============================================
// Contact Types
// ============================================

export interface PersonName {
  displayName?: string;
  givenName?: string;
  familyName?: string;
  middleName?: string;
  phoneticFullName?: string;
}

export interface EmailAddress {
  value: string;
  type?: string;
  formattedType?: string;
}

export interface PhoneNumber {
  value: string;
  type?: string;
  formattedType?: string;
}

export interface Organization {
  name?: string;
  title?: string;
  department?: string;
  type?: string;
}

export interface Address {
  formattedValue?: string;
  type?: string;
  streetAddress?: string;
  city?: string;
  region?: string;
  postalCode?: string;
  country?: string;
}

export interface Photo {
  url?: string;
  default?: boolean;
}

export interface Membership {
  contactGroupMembership?: {
    contactGroupResourceName?: string;
  };
}

export interface Contact {
  resourceName: string;
  etag?: string;
  names?: PersonName[];
  emailAddresses?: EmailAddress[];
  phoneNumbers?: PhoneNumber[];
  organizations?: Organization[];
  addresses?: Address[];
  photos?: Photo[];
  memberships?: Membership[];
}

export interface NormalizedContact {
  resourceName?: string;
  etag?: string;
  names: {
    displayName?: string;
    givenName?: string;
    familyName?: string;
    phoneticFullName?: string;
  };
  emails: string[];
  phones: string[];
  organization: {
    name?: string;
    title?: string;
    department?: string;
  };
  addresses: string[];
  memberships: string[];
  photoUrl?: string;
}

// ============================================
// API Response Types
// ============================================

export interface ContactsListResponse {
  connections?: Contact[];
  nextPageToken?: string;
  totalPeople?: number;
  totalItems?: number;
}

export interface ContactResponse {
  person: Contact;
}

export interface ContactGroupsListResponse {
  contactGroups?: ContactGroup[];
  nextPageToken?: string;
  totalItems?: number;
}

export interface ContactGroup {
  resourceName: string;
  etag?: string;
  name?: string;
  formattedName?: string;
  groupType?: string;
  memberCount?: number;
}

// ============================================
// Request Types
// ============================================

export interface ListContactsOptions {
  pageSize?: number;
  pageToken?: string;
  personFields?: string[];
  sortOrder?: 'LAST_MODIFIED_ASCENDING' | 'LAST_MODIFIED_DESCENDING' | 'FIRST_NAME_ASCENDING' | 'LAST_NAME_ASCENDING';
}

export interface CreateContactParams {
  givenName?: string;
  familyName?: string;
  displayName?: string;
  emails?: string[];
  phones?: string[];
  organization?: {
    name?: string;
    title?: string;
  };
}

export interface UpdateContactParams {
  givenName?: string;
  familyName?: string;
  displayName?: string;
  emails?: string[];
  phones?: string[];
  organization?: {
    name?: string;
    title?: string;
  };
}

export interface SearchContactsOptions {
  query: string;
  pageSize?: number;
  readMask?: string[];
}

export interface SearchContactsResponse {
  results?: Array<{
    person: Contact;
  }>;
}

// ============================================
// Common Types
// ============================================

export type OutputFormat = 'json' | 'pretty';

export interface PaginatedResponse<T> {
  data: T[];
  nextToken?: string;
  hasMore: boolean;
}

// ============================================
// API Error Types
// ============================================

export interface ApiErrorDetail {
  code: string;
  message: string;
  field?: string;
}

export class GoogleContactsApiError extends Error {
  public readonly statusCode: number;
  public readonly errors?: ApiErrorDetail[];

  constructor(message: string, statusCode: number, errors?: ApiErrorDetail[]) {
    super(message);
    this.name = 'GoogleContactsApiError';
    this.statusCode = statusCode;
    this.errors = errors;
  }
}

export class AuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AuthError';
  }
}

export class RateLimitError extends Error {
  constructor(message: string = 'Rate limited by Google People API') {
    super(message);
    this.name = 'RateLimitError';
  }
}
