export interface ReplyConfig {
  apiKey: string;
  baseUrl?: string;
}

export interface Person {
  id: number;
  firstName: string;
  lastName: string;
  email: string;
  company: string | null;
  title: string | null;
  phone: string | null;
  linkedInUrl: string | null;
  website: string | null;
  industry: string | null;
  country: string | null;
  city: string | null;
  status: string | null;
  created: string;
  updated: string;
  customFields: Record<string, string>;
  campaigns: Array<{ id: number; name: string; status: string }>;
}

export interface Campaign {
  id: number;
  name: string;
  status: 'Active' | 'Paused' | 'Archived' | 'Finished';
  created: string;
  type: 'Email' | 'Phone' | 'LinkedIn' | 'SMS' | 'Mixed';
  peopleCount: number;
  openedCount: number;
  repliedCount: number;
}

export interface EmailAccount {
  id: number;
  email: string;
  name: string;
  isActive: boolean;
  dailyLimit: number;
  currentDailyUsage: number;
}

export interface Task {
  id: number;
  type: string;
  status: string;
  scheduled: string;
  person: { id: number; firstName: string; lastName: string; email: string };
  campaign: { id: number; name: string };
}

export class ReplyApiError extends Error {
  public readonly statusCode: number;
  constructor(message: string, statusCode: number) {
    super(message);
    this.name = 'ReplyApiError';
    this.statusCode = statusCode;
  }
}
