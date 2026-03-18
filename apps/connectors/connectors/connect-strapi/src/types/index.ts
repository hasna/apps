export interface StrapiConfig { url: string; token: string; }

export interface StrapiEntry { id: number; attributes: Record<string, unknown>; meta?: Record<string, unknown>; }
export interface StrapiEntryList { data: StrapiEntry[]; meta: { pagination: { page: number; pageSize: number; pageCount: number; total: number } }; }
export interface StrapiSingleEntry { data: StrapiEntry; meta: Record<string, unknown>; }
export interface StrapiContentType { uid: string; apiID: string; schema: { displayName: string; singularName: string; pluralName: string; description: string; kind: string; collectionName: string; attributes: Record<string, { type: string; required?: boolean; [key: string]: unknown }> }; }
export interface StrapiUser { id: number; username: string; email: string; confirmed: boolean; blocked: boolean; role: { id: number; name: string; type: string }; createdAt: string; }
export interface StrapiMedia { id: number; name: string; url: string; mime: string; size: number; width: number; height: number; formats: Record<string, { url: string; width: number; height: number }>; }

export class StrapiApiError extends Error {
  public readonly statusCode: number;
  constructor(message: string, statusCode: number) { super(message); this.name = 'StrapiApiError'; this.statusCode = statusCode; }
}
