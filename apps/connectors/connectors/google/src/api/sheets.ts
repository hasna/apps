import type { GoogleClient } from './client';
import type {
  Spreadsheet,
  SpreadsheetCreateParams,
  ValueRange,
  UpdateValuesResponse,
  AppendValuesResponse,
  BatchGetValuesResponse,
  BatchUpdateValuesRequest,
  BatchUpdateValuesResponse,
  ClearValuesResponse,
} from '../types';

/**
 * Google Sheets API module
 * https://sheets.googleapis.com/v4
 */
export class SheetsApi {
  constructor(private readonly client: GoogleClient) {}

  // ============================================
  // Spreadsheets
  // ============================================

  /**
   * Create a new spreadsheet
   */
  async createSpreadsheet(params: SpreadsheetCreateParams): Promise<Spreadsheet> {
    const body: Record<string, unknown> = {
      properties: {
        title: params.title,
      },
    };

    if (params.sheets) {
      body.sheets = params.sheets.map(sheet => ({
        properties: {
          title: sheet.title,
          gridProperties: sheet.gridProperties,
        },
      }));
    }

    return this.client.sheetsPost<Spreadsheet>('/spreadsheets', body);
  }

  /**
   * Get a spreadsheet
   */
  async getSpreadsheet(spreadsheetId: string, options?: {
    ranges?: string[];
    includeGridData?: boolean;
  }): Promise<Spreadsheet> {
    return this.client.sheetsGet<Spreadsheet>(`/spreadsheets/${spreadsheetId}`, {
      ranges: options?.ranges?.join(','),
      includeGridData: options?.includeGridData,
    });
  }

  /**
   * Get spreadsheet properties and metadata only (no cell data)
   */
  async getSpreadsheetMetadata(spreadsheetId: string): Promise<Spreadsheet> {
    return this.getSpreadsheet(spreadsheetId, { includeGridData: false });
  }

  // ============================================
  // Values - Read
  // ============================================

  /**
   * Get values from a range
   */
  async getValues(spreadsheetId: string, range: string, options?: {
    majorDimension?: 'ROWS' | 'COLUMNS';
    valueRenderOption?: 'FORMATTED_VALUE' | 'UNFORMATTED_VALUE' | 'FORMULA';
    dateTimeRenderOption?: 'SERIAL_NUMBER' | 'FORMATTED_STRING';
  }): Promise<ValueRange> {
    return this.client.sheetsGet<ValueRange>(
      `/spreadsheets/${spreadsheetId}/values/${encodeURIComponent(range)}`,
      {
        majorDimension: options?.majorDimension,
        valueRenderOption: options?.valueRenderOption,
        dateTimeRenderOption: options?.dateTimeRenderOption,
      }
    );
  }

  /**
   * Get values from multiple ranges
   */
  async batchGetValues(spreadsheetId: string, ranges: string[], options?: {
    majorDimension?: 'ROWS' | 'COLUMNS';
    valueRenderOption?: 'FORMATTED_VALUE' | 'UNFORMATTED_VALUE' | 'FORMULA';
    dateTimeRenderOption?: 'SERIAL_NUMBER' | 'FORMATTED_STRING';
  }): Promise<BatchGetValuesResponse> {
    return this.client.sheetsGet<BatchGetValuesResponse>(
      `/spreadsheets/${spreadsheetId}/values:batchGet`,
      {
        ranges: ranges.join(','),
        majorDimension: options?.majorDimension,
        valueRenderOption: options?.valueRenderOption,
        dateTimeRenderOption: options?.dateTimeRenderOption,
      }
    );
  }

  // ============================================
  // Values - Write
  // ============================================

  /**
   * Update values in a range
   */
  async updateValues(spreadsheetId: string, range: string, values: unknown[][], options?: {
    valueInputOption?: 'RAW' | 'USER_ENTERED';
    includeValuesInResponse?: boolean;
    responseValueRenderOption?: 'FORMATTED_VALUE' | 'UNFORMATTED_VALUE' | 'FORMULA';
    responseDateTimeRenderOption?: 'SERIAL_NUMBER' | 'FORMATTED_STRING';
  }): Promise<UpdateValuesResponse> {
    const body: ValueRange = {
      range,
      values,
    };

    return this.client.sheetsPut<UpdateValuesResponse>(
      `/spreadsheets/${spreadsheetId}/values/${encodeURIComponent(range)}`,
      body as unknown as Record<string, unknown>,
      {
        valueInputOption: options?.valueInputOption || 'USER_ENTERED',
        includeValuesInResponse: options?.includeValuesInResponse,
        responseValueRenderOption: options?.responseValueRenderOption,
        responseDateTimeRenderOption: options?.responseDateTimeRenderOption,
      }
    );
  }

  /**
   * Update values in multiple ranges
   */
  async batchUpdateValues(spreadsheetId: string, data: Array<{ range: string; values: unknown[][] }>, options?: {
    valueInputOption?: 'RAW' | 'USER_ENTERED';
    includeValuesInResponse?: boolean;
    responseValueRenderOption?: 'FORMATTED_VALUE' | 'UNFORMATTED_VALUE' | 'FORMULA';
    responseDateTimeRenderOption?: 'SERIAL_NUMBER' | 'FORMATTED_STRING';
  }): Promise<BatchUpdateValuesResponse> {
    const body: BatchUpdateValuesRequest = {
      valueInputOption: options?.valueInputOption || 'USER_ENTERED',
      data: data.map(d => ({ range: d.range, values: d.values })),
      includeValuesInResponse: options?.includeValuesInResponse,
      responseValueRenderOption: options?.responseValueRenderOption,
      responseDateTimeRenderOption: options?.responseDateTimeRenderOption,
    };

    return this.client.sheetsPost<BatchUpdateValuesResponse>(
      `/spreadsheets/${spreadsheetId}/values:batchUpdate`,
      body as unknown as Record<string, unknown>
    );
  }

  /**
   * Append values to a range (add rows)
   */
  async appendValues(spreadsheetId: string, range: string, values: unknown[][], options?: {
    valueInputOption?: 'RAW' | 'USER_ENTERED';
    insertDataOption?: 'OVERWRITE' | 'INSERT_ROWS';
    includeValuesInResponse?: boolean;
    responseValueRenderOption?: 'FORMATTED_VALUE' | 'UNFORMATTED_VALUE' | 'FORMULA';
    responseDateTimeRenderOption?: 'SERIAL_NUMBER' | 'FORMATTED_STRING';
  }): Promise<AppendValuesResponse> {
    const body: ValueRange = {
      range,
      values,
    };

    return this.client.sheetsPost<AppendValuesResponse>(
      `/spreadsheets/${spreadsheetId}/values/${encodeURIComponent(range)}:append`,
      body as unknown as Record<string, unknown>,
      {
        valueInputOption: options?.valueInputOption || 'USER_ENTERED',
        insertDataOption: options?.insertDataOption || 'INSERT_ROWS',
        includeValuesInResponse: options?.includeValuesInResponse,
        responseValueRenderOption: options?.responseValueRenderOption,
        responseDateTimeRenderOption: options?.responseDateTimeRenderOption,
      }
    );
  }

  /**
   * Clear values from a range
   */
  async clearValues(spreadsheetId: string, range: string): Promise<ClearValuesResponse> {
    return this.client.sheetsPost<ClearValuesResponse>(
      `/spreadsheets/${spreadsheetId}/values/${encodeURIComponent(range)}:clear`,
      {}
    );
  }

  // ============================================
  // Convenience Methods
  // ============================================

  /**
   * Get all values from a sheet
   */
  async getAllValues(spreadsheetId: string, sheetName: string): Promise<ValueRange> {
    return this.getValues(spreadsheetId, sheetName);
  }

  /**
   * Get a single cell value
   */
  async getCellValue(spreadsheetId: string, sheetName: string, cell: string): Promise<unknown> {
    const result = await this.getValues(spreadsheetId, `${sheetName}!${cell}`);
    return result.values?.[0]?.[0];
  }

  /**
   * Set a single cell value
   */
  async setCellValue(spreadsheetId: string, sheetName: string, cell: string, value: unknown): Promise<UpdateValuesResponse> {
    return this.updateValues(spreadsheetId, `${sheetName}!${cell}`, [[value]]);
  }

  /**
   * Get a row by index (1-based)
   */
  async getRow(spreadsheetId: string, sheetName: string, rowIndex: number): Promise<unknown[]> {
    const result = await this.getValues(spreadsheetId, `${sheetName}!${rowIndex}:${rowIndex}`);
    return result.values?.[0] || [];
  }

  /**
   * Get a column by letter
   */
  async getColumn(spreadsheetId: string, sheetName: string, column: string): Promise<unknown[]> {
    const result = await this.getValues(spreadsheetId, `${sheetName}!${column}:${column}`);
    return result.values?.map(row => row[0]) || [];
  }

  /**
   * Append a single row
   */
  async appendRow(spreadsheetId: string, sheetName: string, row: unknown[]): Promise<AppendValuesResponse> {
    return this.appendValues(spreadsheetId, sheetName, [row]);
  }

  /**
   * Append multiple rows
   */
  async appendRows(spreadsheetId: string, sheetName: string, rows: unknown[][]): Promise<AppendValuesResponse> {
    return this.appendValues(spreadsheetId, sheetName, rows);
  }

  /**
   * Update a row by index (1-based)
   */
  async updateRow(spreadsheetId: string, sheetName: string, rowIndex: number, row: unknown[]): Promise<UpdateValuesResponse> {
    return this.updateValues(spreadsheetId, `${sheetName}!${rowIndex}:${rowIndex}`, [row]);
  }

  /**
   * Find rows matching a value in a specific column
   */
  async findRows(spreadsheetId: string, sheetName: string, columnLetter: string, searchValue: unknown): Promise<{ rowIndex: number; row: unknown[] }[]> {
    const allValues = await this.getValues(spreadsheetId, sheetName);
    if (!allValues.values) return [];

    const columnIndex = this.columnLetterToIndex(columnLetter);
    const results: { rowIndex: number; row: unknown[] }[] = [];

    allValues.values.forEach((row, index) => {
      if (row[columnIndex] === searchValue) {
        results.push({ rowIndex: index + 1, row }); // 1-based index
      }
    });

    return results;
  }

  /**
   * Get sheet names from a spreadsheet
   */
  async getSheetNames(spreadsheetId: string): Promise<string[]> {
    const spreadsheet = await this.getSpreadsheetMetadata(spreadsheetId);
    return spreadsheet.sheets?.map(sheet => sheet.properties?.title || '') || [];
  }

  // ============================================
  // Utility Methods
  // ============================================

  /**
   * Convert column letter to 0-based index (A=0, B=1, etc.)
   */
  columnLetterToIndex(letter: string): number {
    let result = 0;
    for (let i = 0; i < letter.length; i++) {
      result = result * 26 + letter.charCodeAt(i) - 64;
    }
    return result - 1;
  }

  /**
   * Convert 0-based index to column letter (0=A, 1=B, etc.)
   */
  indexToColumnLetter(index: number): string {
    let result = '';
    let num = index + 1;
    while (num > 0) {
      const remainder = (num - 1) % 26;
      result = String.fromCharCode(65 + remainder) + result;
      num = Math.floor((num - 1) / 26);
    }
    return result;
  }

  /**
   * Parse A1 notation to row and column indices
   */
  parseA1Notation(a1: string): { column: string; row: number } | null {
    const match = a1.match(/^([A-Z]+)(\d+)$/i);
    if (!match) return null;
    return {
      column: match[1].toUpperCase(),
      row: parseInt(match[2], 10),
    };
  }

  /**
   * Create A1 notation from column letter and row number
   */
  createA1Notation(column: string, row: number): string {
    return `${column.toUpperCase()}${row}`;
  }

  /**
   * Create range notation
   */
  createRangeNotation(sheetName: string, startColumn: string, startRow: number, endColumn: string, endRow: number): string {
    return `${sheetName}!${startColumn}${startRow}:${endColumn}${endRow}`;
  }
}
