// DocuSign API Types

// ============================================
// Configuration
// ============================================

export interface DocuSignConfig {
  accessToken: string;
  accountId: string;
  baseUrl?: string;
}

// ============================================
// Common Types
// ============================================

export type OutputFormat = 'json' | 'pretty';

// ============================================
// Envelope Types
// ============================================

export type EnvelopeStatus = 'created' | 'sent' | 'delivered' | 'signed' | 'completed' | 'declined' | 'voided';

export interface Envelope {
  envelopeId: string;
  status: EnvelopeStatus;
  emailSubject?: string;
  emailBlurb?: string;
  sentDateTime?: string;
  completedDateTime?: string;
  createdDateTime?: string;
  statusChangedDateTime?: string;
  documentsCombinedUri?: string;
  documentsUri?: string;
  recipientsUri?: string;
}

export interface EnvelopesListResponse {
  envelopes: Envelope[];
  resultSetSize: string;
  totalSetSize: string;
  startPosition: string;
  endPosition: string;
  nextUri?: string;
  previousUri?: string;
}

export interface EnvelopeResponse {
  envelopeId: string;
  uri: string;
  statusDateTime: string;
  status: EnvelopeStatus;
}

// ============================================
// Recipient Types
// ============================================

export interface Signer {
  email: string;
  name: string;
  recipientId: string;
  routingOrder?: string;
  clientUserId?: string;
  tabs?: SignerTabs;
}

export interface SignerTabs {
  signHereTabs?: SignHereTab[];
  dateSignedTabs?: DateSignedTab[];
  textTabs?: TextTab[];
}

export interface SignHereTab {
  anchorString?: string;
  anchorXOffset?: string;
  anchorYOffset?: string;
  documentId?: string;
  pageNumber?: string;
  xPosition?: string;
  yPosition?: string;
}

export interface DateSignedTab {
  anchorString?: string;
  documentId?: string;
  pageNumber?: string;
  xPosition?: string;
  yPosition?: string;
}

export interface TextTab {
  anchorString?: string;
  documentId?: string;
  pageNumber?: string;
  xPosition?: string;
  yPosition?: string;
  tabLabel?: string;
  value?: string;
}

export interface Recipients {
  signers?: Signer[];
  carbonCopies?: CarbonCopy[];
}

export interface CarbonCopy {
  email: string;
  name: string;
  recipientId: string;
  routingOrder?: string;
}

// ============================================
// Document Types
// ============================================

export interface Document {
  documentId: string;
  name: string;
  fileExtension?: string;
  documentBase64?: string;
  uri?: string;
}

// ============================================
// Create Envelope Types
// ============================================

export interface CreateEnvelopeOptions {
  emailSubject: string;
  emailBlurb?: string;
  documents: Document[];
  recipients: Recipients;
  status?: 'created' | 'sent';
}

// ============================================
// Template Types
// ============================================

export interface Template {
  templateId: string;
  name: string;
  description?: string;
  created?: string;
  lastModified?: string;
  uri?: string;
}

export interface TemplatesListResponse {
  envelopeTemplates: Template[];
  resultSetSize: string;
  totalSetSize: string;
  startPosition: string;
  endPosition: string;
}

// ============================================
// User Info Types
// ============================================

export interface UserInfo {
  sub: string;
  name: string;
  email: string;
  accounts: UserAccount[];
}

export interface UserAccount {
  account_id: string;
  account_name: string;
  is_default: boolean;
  base_uri: string;
}

// ============================================
// API Error Types
// ============================================

export interface ApiErrorDetail {
  code: string;
  message: string;
  field?: string;
}

export class DocuSignApiError extends Error {
  public readonly statusCode: number;
  public readonly errors?: ApiErrorDetail[];

  constructor(message: string, statusCode: number, errors?: ApiErrorDetail[]) {
    super(message);
    this.name = 'DocuSignApiError';
    this.statusCode = statusCode;
    this.errors = errors;
  }
}

// ============================================
// Profile Config
// ============================================

export interface ProfileConfig {
  accessToken?: string;
  accountId?: string;
  baseUrl?: string;
}
