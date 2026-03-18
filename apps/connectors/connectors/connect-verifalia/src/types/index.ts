export interface VerifaliaConfig { username: string; password: string; baseUrl?: string; }

export type EmailValidationStatus = 'Success' | 'Unverifiable' | 'Risky' | 'Unknown';
export type EmailClassification = 'Deliverable' | 'Risky' | 'Undeliverable' | 'Unknown';

export interface EmailValidationEntry {
  inputData: string;
  emailAddress: string | null;
  asciiEmailAddressDomainPart: string | null;
  status: string;
  classification: EmailClassification;
  isDisposableEmailAddress: boolean;
  isFreeEmailAddress: boolean;
  isRoleAccount: boolean;
  hasInternationalDomainName: boolean;
}

export interface ValidationJob {
  id: string;
  status: 'InProgress' | 'Completed' | 'Expired' | 'Deleted';
  createdOn: string;
  completedOn: string | null;
  entries?: { data: EmailValidationEntry[]; meta: { cursor?: string } };
}

export class VerifaliaApiError extends Error {
  public readonly statusCode: number;
  constructor(message: string, statusCode: number) { super(message); this.name = 'VerifaliaApiError'; this.statusCode = statusCode; }
}
