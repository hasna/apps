export interface ERPNextConfig { url: string; apiKey: string; apiSecret: string; }

export interface ENDocument { name: string; doctype: string; [key: string]: unknown; }
export interface ENDocumentList { data: ENDocument[]; }
export interface ENDocType { name: string; fields: { fieldname: string; fieldtype: string; label: string; reqd: number }[]; }

export class ERPNextApiError extends Error {
  public readonly statusCode: number;
  constructor(message: string, statusCode: number) { super(message); this.name = 'ERPNextApiError'; this.statusCode = statusCode; }
}
