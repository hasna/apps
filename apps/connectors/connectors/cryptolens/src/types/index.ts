export interface CryptolensConfig { token: string; }

export interface CLKey { Id: number; Key: string; Created: string; Expires: string; Period: number; F1: boolean; F2: boolean; F3: boolean; F4: boolean; F5: boolean; F6: boolean; F7: boolean; F8: boolean; Notes: string; Block: boolean; GlobalId: number; Customer: { Id: number; Name: string; Email: string } | null; ActivatedMachines: { Mid: string; IP: string; Time: string }[]; MaxNoOfMachines: number; SignDate: string; }
export interface CLProduct { Id: number; Name: string; Description: string; Created: string; }
export interface CLCustomer { Id: number; Name: string; Email: string; CompanyName: string; Created: string; }
export interface CLActivateResult { LicenseKey: CLKey; Signature: string; Result: number; Message: string; }

export class CryptolensApiError extends Error {
  public readonly statusCode: number;
  constructor(message: string, statusCode: number) { super(message); this.name = 'CryptolensApiError'; this.statusCode = statusCode; }
}
