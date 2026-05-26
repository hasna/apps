export interface FlagshipConfig { apiKey: string; environmentId: string; }

export interface FSFlag { id: string; key: string; type: string; value: unknown; default_value: unknown; campaign_id: string; variation_group_id: string; }
export interface FSCampaign { id: string; name: string; description: string; type: string; status: string; variation_groups: { id: string; name: string; variations: { id: string; name: string; reference: boolean; modifications: Record<string, unknown> }[] }[]; }
export interface FSVisitor { visitor_id: string; context: Record<string, unknown>; campaigns: { id: string; variation_group_id: string; variation_id: string }[]; flags: Record<string, unknown>; }
export interface FSGoal { id: string; label: string; type: string; }

export class FlagshipApiError extends Error {
  public readonly statusCode: number;
  constructor(message: string, statusCode: number) { super(message); this.name = 'FlagshipApiError'; this.statusCode = statusCode; }
}
