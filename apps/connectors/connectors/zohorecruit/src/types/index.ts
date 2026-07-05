export type ZohoRecruitDataCenter = 'com' | 'eu' | 'in' | 'com.au' | 'jp' | 'ca' | 'sa';

export interface ZohoRecruitConfig {
  token: string;
  dataCenter?: ZohoRecruitDataCenter | string;
  baseUrl?: string;
}

export interface ZohoRecruitRecord {
  id: string;
  [key: string]: unknown;
}

export interface ZohoRecruitRecordList {
  data: ZohoRecruitRecord[];
  info: {
    per_page: number;
    count: number;
    page: number;
    more_records: boolean;
  };
}

export interface ZohoRecruitModule {
  api_name: string;
  module_name: string;
  singular_label: string;
  plural_label: string;
  id: string;
}

export interface ZohoRecruitField {
  id: string;
  api_name: string;
  field_label: string;
  data_type: string;
  length: number;
  required: boolean;
  read_only: boolean;
}

export interface ZohoRecruitLayout {
  id: string;
  name: string;
  status: string;
}

export interface ZohoRecruitCustomView {
  id: string;
  name: string;
  display_value: string;
}

export interface ZohoRecruitUser {
  id: string;
  name: string;
  email: string;
  role?: { id: string; name: string };
  profile?: { id: string; name: string };
  status: string;
}

export interface ZohoRecruitNote {
  id: string;
  Note_Title?: string;
  Note_Content: string;
  Created_Time?: string;
}

export interface ZohoRecruitAttachment {
  id: string;
  File_Name: string;
  Size: number;
  Created_Time?: string;
}

export interface ZohoRecruitTag {
  id: string;
  name: string;
  color_code?: string;
}

export interface ZohoRecruitWebhook {
  channel_id: string;
  events: string[];
  notify_url: string;
}

export interface ZohoRecruitOrganization {
  id: string;
  company_name: string;
  [key: string]: unknown;
}

export interface OAuth2Config {
  clientId: string;
  clientSecret: string;
}

export interface OAuth2Tokens {
  accessToken: string;
  refreshToken?: string;
  expiresAt?: number;
  tokenType?: string;
  scope?: string;
}

export class ZohoRecruitApiError extends Error {
  public readonly statusCode: number;
  public readonly code?: string;

  constructor(message: string, statusCode: number, code?: string) {
    super(message);
    this.name = 'ZohoRecruitApiError';
    this.statusCode = statusCode;
    this.code = code;
  }
}
