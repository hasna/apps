// Salesforce Connector Types
// CRM accounts, contacts, leads, and opportunities

// ============================================
// Configuration
// ============================================

export interface SalesforceConfig {
  accessToken: string;  // OAuth access token
  instanceUrl: string;  // e.g., https://yourinstance.salesforce.com
  apiVersion?: string;  // Default: v59.0
}

// ============================================
// Common Types
// ============================================

export type OutputFormat = 'json' | 'pretty';

export interface SalesforceQueryResponse<T> {
  totalSize: number;
  done: boolean;
  nextRecordsUrl?: string;
  records: T[];
}

export interface SalesforceRecord {
  Id: string;
  attributes: {
    type: string;
    url: string;
  };
}

export interface CreateResponse {
  id: string;
  success: boolean;
  errors: string[];
}

// ============================================
// Account Types
// ============================================

export interface Account extends SalesforceRecord {
  Name: string;
  Type?: string;
  Industry?: string;
  Description?: string;
  Website?: string;
  Phone?: string;
  BillingStreet?: string;
  BillingCity?: string;
  BillingState?: string;
  BillingPostalCode?: string;
  BillingCountry?: string;
  ShippingStreet?: string;
  ShippingCity?: string;
  ShippingState?: string;
  ShippingPostalCode?: string;
  ShippingCountry?: string;
  NumberOfEmployees?: number;
  AnnualRevenue?: number;
  OwnerId?: string;
  CreatedDate?: string;
  LastModifiedDate?: string;
}

export interface CreateAccountInput {
  Name: string;
  Type?: string;
  Industry?: string;
  Description?: string;
  Website?: string;
  Phone?: string;
  BillingStreet?: string;
  BillingCity?: string;
  BillingState?: string;
  BillingPostalCode?: string;
  BillingCountry?: string;
  NumberOfEmployees?: number;
  AnnualRevenue?: number;
  OwnerId?: string;
}

// ============================================
// Contact Types
// ============================================

export interface Contact extends SalesforceRecord {
  FirstName?: string;
  LastName: string;
  Name?: string;
  Email?: string;
  Phone?: string;
  MobilePhone?: string;
  Title?: string;
  Department?: string;
  AccountId?: string;
  MailingStreet?: string;
  MailingCity?: string;
  MailingState?: string;
  MailingPostalCode?: string;
  MailingCountry?: string;
  OwnerId?: string;
  CreatedDate?: string;
  LastModifiedDate?: string;
}

export interface CreateContactInput {
  FirstName?: string;
  LastName: string;
  Email?: string;
  Phone?: string;
  MobilePhone?: string;
  Title?: string;
  Department?: string;
  AccountId?: string;
  MailingStreet?: string;
  MailingCity?: string;
  MailingState?: string;
  MailingPostalCode?: string;
  MailingCountry?: string;
  OwnerId?: string;
}

// ============================================
// Lead Types
// ============================================

export interface Lead extends SalesforceRecord {
  FirstName?: string;
  LastName: string;
  Name?: string;
  Company: string;
  Title?: string;
  Email?: string;
  Phone?: string;
  MobilePhone?: string;
  Website?: string;
  Status: string;
  Industry?: string;
  Rating?: string;
  LeadSource?: string;
  Description?: string;
  Street?: string;
  City?: string;
  State?: string;
  PostalCode?: string;
  Country?: string;
  NumberOfEmployees?: number;
  AnnualRevenue?: number;
  IsConverted?: boolean;
  ConvertedAccountId?: string;
  ConvertedContactId?: string;
  ConvertedOpportunityId?: string;
  OwnerId?: string;
  CreatedDate?: string;
  LastModifiedDate?: string;
}

export interface CreateLeadInput {
  FirstName?: string;
  LastName: string;
  Company: string;
  Title?: string;
  Email?: string;
  Phone?: string;
  MobilePhone?: string;
  Website?: string;
  Status?: string;
  Industry?: string;
  Rating?: string;
  LeadSource?: string;
  Description?: string;
  Street?: string;
  City?: string;
  State?: string;
  PostalCode?: string;
  Country?: string;
  NumberOfEmployees?: number;
  AnnualRevenue?: number;
  OwnerId?: string;
}

// ============================================
// Opportunity Types
// ============================================

export interface Opportunity extends SalesforceRecord {
  Name: string;
  AccountId?: string;
  StageName: string;
  Amount?: number;
  Probability?: number;
  CloseDate: string;
  Type?: string;
  LeadSource?: string;
  Description?: string;
  NextStep?: string;
  IsClosed?: boolean;
  IsWon?: boolean;
  OwnerId?: string;
  CreatedDate?: string;
  LastModifiedDate?: string;
}

export interface CreateOpportunityInput {
  Name: string;
  AccountId?: string;
  StageName: string;
  Amount?: number;
  Probability?: number;
  CloseDate: string;
  Type?: string;
  LeadSource?: string;
  Description?: string;
  NextStep?: string;
  OwnerId?: string;
}

// ============================================
// Task Types
// ============================================

export interface Task extends SalesforceRecord {
  Subject: string;
  Status: string;
  Priority?: string;
  Description?: string;
  ActivityDate?: string;
  WhoId?: string;
  WhatId?: string;
  OwnerId?: string;
  IsHighPriority?: boolean;
  IsClosed?: boolean;
  CreatedDate?: string;
  LastModifiedDate?: string;
}

export interface CreateTaskInput {
  Subject: string;
  Status?: string;
  Priority?: string;
  Description?: string;
  ActivityDate?: string;
  WhoId?: string;
  WhatId?: string;
  OwnerId?: string;
}

// ============================================
// User Types
// ============================================

export interface User extends SalesforceRecord {
  Username: string;
  Name: string;
  FirstName?: string;
  LastName: string;
  Email: string;
  Phone?: string;
  Title?: string;
  Department?: string;
  IsActive: boolean;
  ProfileId?: string;
  UserRoleId?: string;
  CreatedDate?: string;
  LastModifiedDate?: string;
}

// ============================================
// API Error Types
// ============================================

export interface SalesforceErrorDetail {
  message: string;
  errorCode: string;
  fields?: string[];
}

export class SalesforceApiError extends Error {
  public readonly statusCode: number;
  public readonly errors?: SalesforceErrorDetail[];

  constructor(message: string, statusCode: number, errors?: SalesforceErrorDetail[]) {
    super(message);
    this.name = 'SalesforceApiError';
    this.statusCode = statusCode;
    this.errors = errors;
  }
}
