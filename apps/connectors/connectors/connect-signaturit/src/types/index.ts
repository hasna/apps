export interface SignaturitConfig { token: string; sandbox?: boolean; }

export interface SGSignature { id: string; created_at: string; documents: SGDocument[]; }
export interface SGDocument { id: string; name: string; file: { name: string; pages: number; size: number }; status: string; signed_at: string | null; events: SGEvent[]; }
export interface SGEvent { type: string; created_at: string; }
export interface SGSignatureRequest { id: string; created_at: string; documents: { id: string; name: string; status: string }[]; recipients: SGRecipient[]; }
export interface SGRecipient { name: string; email: string; phone: string | null; status: string; }
export interface SGTemplate { id: string; name: string; created_at: string; }
export interface SGCertifiedEmail { id: string; subject: string; body: string; recipients: { name: string; email: string; status: string }[]; created_at: string; }

export class SignaturitApiError extends Error {
  public readonly statusCode: number;
  constructor(message: string, statusCode: number) { super(message); this.name = 'SignaturitApiError'; this.statusCode = statusCode; }
}
