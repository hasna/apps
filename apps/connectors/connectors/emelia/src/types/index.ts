export interface EmeliaConfig {
  apiKey: string;
  baseUrl?: string;
}

export interface EmCampaign {
  _id: string;
  name: string;
  status: 'DRAFT' | 'ACTIVE' | 'PAUSED' | 'FINISHED';
  stats: { total: number; sent: number; opened: number; clicked: number; replied: number; bounced: number };
  createdAt: string;
  updatedAt: string;
}

export interface EmContact {
  _id: string;
  email: string;
  firstName: string | null;
  lastName: string | null;
  companyName: string | null;
  status: string;
  campaignId: string | null;
}

export interface EmEmailAccount {
  _id: string;
  email: string;
  name: string;
  isActive: boolean;
  dailyLimit: number;
  warmupEnabled: boolean;
}

export class EmeliaApiError extends Error {
  public readonly statusCode: number;
  constructor(message: string, statusCode: number) {
    super(message);
    this.name = 'EmeliaApiError';
    this.statusCode = statusCode;
  }
}
