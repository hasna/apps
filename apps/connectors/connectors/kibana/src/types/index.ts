export interface KibanaConfig { url: string; apiKey?: string; username?: string; password?: string; }

export interface KBDashboard { id: string; type: string; attributes: { title: string; description: string; panelsJSON: string; timeRestore: boolean; kibanaSavedObjectMeta: Record<string, unknown> }; }
export interface KBSavedObject { id: string; type: string; attributes: Record<string, unknown>; updated_at: string; version: string; namespaces: string[]; }
export interface KBSavedObjectList { saved_objects: KBSavedObject[]; total: number; per_page: number; page: number; }
export interface KBSpace { id: string; name: string; description: string; color: string; initials: string; disabledFeatures: string[]; }
export interface KBIndexPattern { id: string; title: string; timeFieldName: string; fields: { name: string; type: string; searchable: boolean; aggregatable: boolean }[]; }
export interface KBStatus { name: string; uuid: string; version: { number: string; build_hash: string }; status: { overall: { state: string; title: string } }; }

export class KibanaApiError extends Error {
  public readonly statusCode: number;
  constructor(message: string, statusCode: number) { super(message); this.name = 'KibanaApiError'; this.statusCode = statusCode; }
}
