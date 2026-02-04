import type { GoogleSheetsClient } from './client';
import type {
  Spreadsheet,
  SpreadsheetProperties,
  BatchUpdateSpreadsheetRequest,
  BatchUpdateSpreadsheetResponse,
  Request,
} from '../types';

/**
 * Spreadsheets API for managing spreadsheet metadata and batch updates
 */
export class SpreadsheetsApi {
  constructor(private readonly client: GoogleSheetsClient) {}

  /**
   * Get spreadsheet metadata
   * @param spreadsheetId The ID of the spreadsheet
   * @param options Optional parameters
   */
  async get(
    spreadsheetId: string,
    options?: {
      ranges?: string[];
      includeGridData?: boolean;
    }
  ): Promise<Spreadsheet> {
    const params: Record<string, string | boolean | undefined> = {};

    if (options?.ranges && options.ranges.length > 0) {
      // Multiple ranges are passed as repeated query params
      // but we can also pass them comma-separated
      params.ranges = options.ranges.join(',');
    }

    if (options?.includeGridData !== undefined) {
      params.includeGridData = options.includeGridData;
    }

    return this.client.get<Spreadsheet>(`/spreadsheets/${spreadsheetId}`, params);
  }

  /**
   * Create a new spreadsheet
   * @param title The title of the new spreadsheet
   * @param options Optional spreadsheet properties
   */
  async create(
    title: string,
    options?: {
      locale?: string;
      timeZone?: string;
      autoRecalc?: 'ON_CHANGE' | 'MINUTE' | 'HOUR';
    }
  ): Promise<Spreadsheet> {
    const properties: SpreadsheetProperties = {
      title,
      ...options,
    };

    return this.client.post<Spreadsheet>('/spreadsheets', { properties });
  }

  /**
   * Batch update spreadsheet (add sheets, delete sheets, merge cells, etc.)
   * @param spreadsheetId The ID of the spreadsheet
   * @param requests Array of update requests
   * @param options Optional parameters
   */
  async batchUpdate(
    spreadsheetId: string,
    requests: Request[],
    options?: {
      includeSpreadsheetInResponse?: boolean;
      responseRanges?: string[];
      responseIncludeGridData?: boolean;
    }
  ): Promise<BatchUpdateSpreadsheetResponse> {
    const body: BatchUpdateSpreadsheetRequest = {
      requests,
      ...options,
    };

    return this.client.post<BatchUpdateSpreadsheetResponse>(
      `/spreadsheets/${spreadsheetId}:batchUpdate`,
      body
    );
  }

  /**
   * Get spreadsheet metadata by URL
   * @param url The full URL of the spreadsheet
   */
  async getByUrl(url: string): Promise<Spreadsheet> {
    const spreadsheetId = this.extractSpreadsheetId(url);
    if (!spreadsheetId) {
      throw new Error('Invalid Google Sheets URL');
    }
    return this.get(spreadsheetId);
  }

  /**
   * Extract spreadsheet ID from URL
   */
  private extractSpreadsheetId(url: string): string | null {
    // Match patterns like:
    // https://docs.google.com/spreadsheets/d/SPREADSHEET_ID/edit
    // https://docs.google.com/spreadsheets/d/SPREADSHEET_ID
    const match = url.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
    return match ? match[1] : null;
  }

  /**
   * Duplicate an existing spreadsheet (creates a copy)
   * Note: This uses the Drive API, which requires additional OAuth scopes
   */
  async duplicate(spreadsheetId: string, newTitle: string): Promise<Spreadsheet> {
    // This would require the Drive API
    // For now, we can create a new spreadsheet and copy sheets
    throw new Error('Spreadsheet duplication requires the Google Drive API. Use sheets.copy() to copy individual sheets instead.');
  }

  /**
   * Update spreadsheet properties (title, locale, etc.)
   * @param spreadsheetId The ID of the spreadsheet
   * @param properties Properties to update
   */
  async updateProperties(
    spreadsheetId: string,
    properties: Partial<SpreadsheetProperties>
  ): Promise<BatchUpdateSpreadsheetResponse> {
    return this.batchUpdate(spreadsheetId, [
      {
        updateSpreadsheetProperties: {
          properties: properties as SpreadsheetProperties,
          fields: Object.keys(properties).join(','),
        },
      },
    ]);
  }

  /**
   * Rename a spreadsheet
   * @param spreadsheetId The ID of the spreadsheet
   * @param newTitle The new title
   */
  async rename(spreadsheetId: string, newTitle: string): Promise<BatchUpdateSpreadsheetResponse> {
    return this.updateProperties(spreadsheetId, { title: newTitle });
  }
}
