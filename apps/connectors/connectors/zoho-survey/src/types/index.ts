export interface ZohoSurveyConfig {
  token: string;
  portalId?: string;
  departmentId?: string;
  baseUrl?: string;
}

export interface OAuth2Config {
  clientId: string;
  clientSecret: string;
  redirectUri?: string;
}

export interface OAuth2Tokens {
  accessToken: string;
  refreshToken?: string;
  expiresAt: number;
  tokenType?: string;
  scope?: string;
}

export interface ZohoSurveyPortal {
  portalId: string;
  portalName: string;
  departments?: ZohoSurveyDepartment[];
}

export interface ZohoSurveyDepartment {
  groupUniqueId: string;
  name: string;
}

export interface ZohoSurveySummary {
  id: string;
  name: string;
  status?: string;
  createdTime?: string;
  modifiedTime?: string;
}

export interface ZohoSurveyResponse {
  id?: string;
  responseId?: string;
  [key: string]: unknown;
}

export interface ZohoSurveyCollector {
  id: string;
  name: string;
  status?: string;
}

export interface ZohoSurveyDistribution {
  id: string;
  name: string;
  type?: string;
}

export interface SendInvitationPayload {
  contactsList: Record<string, string>[];
}

export class ZohoSurveyApiError extends Error {
  public readonly statusCode: number;
  public readonly code?: string | number;

  constructor(message: string, statusCode: number, code?: string | number) {
    super(message);
    this.name = 'ZohoSurveyApiError';
    this.statusCode = statusCode;
    this.code = code;
  }
}
