export interface FlotiqConfig { apiKey: string; }

export interface FlotiqContentType { name: string; label: string; schemaDefinition: Record<string, unknown>; metaDefinition: Record<string, unknown>; }
export interface FlotiqContentTypeList { data: FlotiqContentType[]; total_count: number; total_pages: number; current_page: number; }
export interface FlotiqObject { id: string; internal: { createdAt: string; updatedAt: string; contentType: string }; [key: string]: unknown; }
export interface FlotiqObjectList { data: FlotiqObject[]; total_count: number; total_pages: number; current_page: number; count: number; }
export interface FlotiqMedia { id: string; url: string; fileName: string; mimeType: string; size: number; width: number; height: number; }
export interface FlotiqMediaList { data: FlotiqMedia[]; total_count: number; total_pages: number; current_page: number; }

export class FlotiqApiError extends Error {
  public readonly statusCode: number;
  constructor(message: string, statusCode: number) { super(message); this.name = 'FlotiqApiError'; this.statusCode = statusCode; }
}
