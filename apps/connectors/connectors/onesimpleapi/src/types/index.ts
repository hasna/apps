export interface OneSimpleAPIConfig { apiKey: string; }

export interface OSScreenshot { url: string; image_url: string; }
export interface OSPdf { url: string; pdf_url: string; }
export interface OSScrape { url: string; text: string; html: string; title: string; description: string; }
export interface OSQRCode { data: string; image_url: string; }
export interface OSExchangeRate { base: string; target: string; rate: number; date: string; }

export class OneSimpleAPIApiError extends Error {
  public readonly statusCode: number;
  constructor(message: string, statusCode: number) { super(message); this.name = 'OneSimpleAPIApiError'; this.statusCode = statusCode; }
}
