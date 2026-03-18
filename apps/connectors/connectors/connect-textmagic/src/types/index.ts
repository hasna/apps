export interface TextmagicConfig { username: string; apiKey: string; }

export interface TMMessage { id: number; sender: string; receiver: string; text: string; status: string; charset: string; country: string; price: number; parts_count: number; message_time: string; }
export interface TMMessageList { page: number; limit: number; pageCount: number; resources: TMMessage[]; }
export interface TMContact { id: number; firstName: string; lastName: string; phone: string; email: string; companyName: string; country: { id: string; name: string }; customFieldValues: Record<string, string>[]; }
export interface TMContactList { page: number; limit: number; pageCount: number; resources: TMContact[]; }
export interface TMList { id: number; name: string; description: string; membersCount: number; shared: boolean; }
export interface TMTemplate { id: number; name: string; body: string; lastModified: string; }

export class TextmagicApiError extends Error {
  public readonly statusCode: number;
  constructor(message: string, statusCode: number) { super(message); this.name = 'TextmagicApiError'; this.statusCode = statusCode; }
}
