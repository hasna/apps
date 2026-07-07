// Toast POS Connector Types

export interface ToastConfig {
  clientId: string;
  clientSecret: string;
  restaurantExternalId: string;
  baseUrl?: string;
}

export type OutputFormat = 'json' | 'pretty';

export interface ToastAuthToken {
  accessToken: string;
  tokenType: string;
  expiresIn: number;
  expiresAt: number;
  scope?: string;
  refreshToken?: string;
}

export interface ToastAuthResponse {
  token?: {
    tokenType?: string;
    scope?: string;
    expiresIn?: number;
    accessToken?: string;
    refreshToken?: string;
  };
  status?: string;
}

export interface RestaurantInfo {
  guid?: string;
  general?: {
    name?: string;
    locationName?: string;
    locationCode?: string;
    description?: string;
    timeZone?: string;
    managementGroupGuid?: string;
    currencyCode?: string;
    archived?: boolean;
  };
  location?: {
    address1?: string;
    city?: string;
    stateCode?: string;
    zipCode?: string;
    country?: string;
    phone?: string;
  };
  [key: string]: unknown;
}

export interface RestaurantsListResponse {
  restaurants?: RestaurantInfo[];
  [key: string]: unknown;
}

export interface MenusResponse {
  menus?: unknown[];
  [key: string]: unknown;
}

export interface Order {
  guid?: string;
  entityType?: string;
  externalId?: string;
  openedDate?: string;
  closedDate?: string;
  checks?: unknown[];
  [key: string]: unknown;
}

export interface OrdersBulkResponse {
  orders?: Order[];
  [key: string]: unknown;
}

export interface ToastApiErrorDetail {
  message?: string;
  code?: string;
  fieldName?: string;
}

export class ToastApiError extends Error {
  public readonly statusCode: number;
  public readonly details?: ToastApiErrorDetail[];

  constructor(message: string, statusCode: number, details?: ToastApiErrorDetail[]) {
    super(message);
    this.name = 'ToastApiError';
    this.statusCode = statusCode;
    this.details = details;
  }

  isAuthError(): boolean {
    return this.statusCode === 401 || this.statusCode === 403;
  }

  isRateLimited(): boolean {
    return this.statusCode === 429;
  }
}
