export interface RDStationCRMConfig { token: string; }

export interface RDDeal { id: string; name: string; amount: number; deal_stage_id: string; user_id: string; organization_id: string | null; win: boolean | null; created_at: string; updated_at: string; }
export interface RDDealList { deals: RDDeal[]; total: number; has_more: boolean; }
export interface RDContact { id: string; name: string; title: string; emails: { email: string }[]; phones: { phone: string }[]; organization_id: string | null; created_at: string; }
export interface RDOrganization { id: string; name: string; website: string; address: string; }
export interface RDDealStage { id: string; name: string; nickname: string; order: number; }
export interface RDUser { id: string; name: string; email: string; role: string; }

export class RDStationCRMApiError extends Error {
  public readonly statusCode: number;
  constructor(message: string, statusCode: number) { super(message); this.name = 'RDStationCRMApiError'; this.statusCode = statusCode; }
}
