export interface TildaConfig { publicKey: string; secretKey: string; }

export interface TildaProject { id: string; title: string; descr: string; customdomain: string; export_csspath: string; export_jspath: string; indexpageid: string; }
export interface TildaProjectData { id: string; title: string; descr: string; customdomain: string; css: string[]; js: string[]; }
export interface TildaPage { id: string; projectid: string; title: string; descr: string; img: string; featureimg: string; alias: string; date: string; sort: number; published: string; }
export interface TildaPageFull { id: string; projectid: string; title: string; descr: string; img: string; html: string; css: string; js: string; published: string; }

export class TildaApiError extends Error {
  public readonly statusCode: number;
  constructor(message: string, statusCode: number) { super(message); this.name = 'TildaApiError'; this.statusCode = statusCode; }
}
