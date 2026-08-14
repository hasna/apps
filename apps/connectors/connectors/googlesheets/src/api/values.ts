import type { GoogleSheetsClient } from './client';
import type {
  ValueRange,
  CellValue,
  UpdateValuesResponse,
  AppendValuesResponse,
  ClearValuesResponse,
  BatchGetValuesResponse,
  BatchUpdateValuesResponse,
  ValueInputOption,
  ValueRenderOption,
  InsertDataOption,
  DateTimeRenderOption,
} from '../types';

/**
 * Values API for reading and writing cell values
 */
export class ValuesApi {
  constructor(private readonly client: GoogleSheetsClient) {}

  /**
   * Read values from a single range
   * @param spreadsheetId The ID of the spreadsheet
   * @param range The A1 notation range (e.g., "Sheet1!A1:B10")
   * @param options Optional parameters
   */
  async get(
    spreadsheetId: string,
    range: string,
    options?: {
      majorDimension?: 'ROWS' | 'COLUMNS';
      valueRenderOption?: ValueRenderOption;
      dateTimeRenderOption?: DateTimeRenderOption;
    }
  ): Promise<ValueRange> {
    const params: Record<string, string | undefined> = {
      majorDimension: options?.majorDimension,
      valueRenderOption: options?.valueRenderOption,
      dateTimeRenderOption: options?.dateTimeRenderOption,
    };

    return this.client.get<ValueRange>(
      `/spreadsheets/${spreadsheetId}/values/${encodeURIComponent(range)}`,
      params
    );
  }

  /**
   * Write values to a single range
   * @param spreadsheetId The ID of the spreadsheet
   * @param range The A1 notation range
   * @param values 2D array of values to write
   * @param options Optional parameters
   */
  async update(
    spreadsheetId: string,
    range: string,
    values: CellValue[][],
    options?: {
      valueInputOption?: ValueInputOption;
      includeValuesInResponse?: boolean;
      responseValueRenderOption?: ValueRenderOption;
      responseDateTimeRenderOption?: DateTimeRenderOption;
    }
  ): Promise<UpdateValuesResponse> {
    const body: ValueRange = {
      range,
      values,
    };

    const params: Record<string, string | boolean | undefined> = {
      valueInputOption: options?.valueInputOption || 'USER_ENTERED',
      includeValuesInResponse: options?.includeValuesInResponse,
      responseValueRenderOption: options?.responseValueRenderOption,
      responseDateTimeRenderOption: options?.responseDateTimeRenderOption,
    };

    return this.client.put<UpdateValuesResponse>(
      `/spreadsheets/${spreadsheetId}/values/${encodeURIComponent(range)}`,
      body,
      params
    );
  }

  /**
   * Append values to a table (finds the last row and adds data after it)
   * @param spreadsheetId The ID of the spreadsheet
   * @param range The A1 notation range (table is detected from this range)
   * @param values 2D array of values to append
   * @param options Optional parameters
   */
  async append(
    spreadsheetId: string,
    range: string,
    values: CellValue[][],
    options?: {
      valueInputOption?: ValueInputOption;
      insertDataOption?: InsertDataOption;
      includeValuesInResponse?: boolean;
      responseValueRenderOption?: ValueRenderOption;
      responseDateTimeRenderOption?: DateTimeRenderOption;
    }
  ): Promise<AppendValuesResponse> {
    const body: ValueRange = {
      range,
      values,
    };

    const params: Record<string, string | boolean | undefined> = {
      valueInputOption: options?.valueInputOption || 'USER_ENTERED',
      insertDataOption: options?.insertDataOption || 'INSERT_ROWS',
      includeValuesInResponse: options?.includeValuesInResponse,
      responseValueRenderOption: options?.responseValueRenderOption,
      responseDateTimeRenderOption: options?.responseDateTimeRenderOption,
    };

    return this.client.post<AppendValuesResponse>(
      `/spreadsheets/${spreadsheetId}/values/${encodeURIComponent(range)}:append`,
      body,
      params
    );
  }

  /**
   * Clear values from a range
   * @param spreadsheetId The ID of the spreadsheet
   * @param range The A1 notation range to clear
   */
  async clear(spreadsheetId: string, range: string): Promise<ClearValuesResponse> {
    return this.client.post<ClearValuesResponse>(
      `/spreadsheets/${spreadsheetId}/values/${encodeURIComponent(range)}:clear`,
      {}
    );
  }

  /**
   * Read values from multiple ranges in a single request
   * @param spreadsheetId The ID of the spreadsheet
   * @param ranges Array of A1 notation ranges
   * @param options Optional parameters
   */
  async batchGet(
    spreadsheetId: string,
    ranges: string[],
    options?: {
      majorDimension?: 'ROWS' | 'COLUMNS';
      valueRenderOption?: ValueRenderOption;
      dateTimeRenderOption?: DateTimeRenderOption;
    }
  ): Promise<BatchGetValuesResponse> {
    const params: Record<string, string | undefined> = {
      ranges: ranges.join(','),
      majorDimension: options?.majorDimension,
      valueRenderOption: options?.valueRenderOption,
      dateTimeRenderOption: options?.dateTimeRenderOption,
    };

    return this.client.get<BatchGetValuesResponse>(
      `/spreadsheets/${spreadsheetId}/values:batchGet`,
      params
    );
  }

  /**
   * Write values to multiple ranges in a single request
   * @param spreadsheetId The ID of the spreadsheet
   * @param data Array of ValueRange objects
   * @param options Optional parameters
   */
  async batchUpdate(
    spreadsheetId: string,
    data: ValueRange[],
    options?: {
      valueInputOption?: ValueInputOption;
      includeValuesInResponse?: boolean;
      responseValueRenderOption?: ValueRenderOption;
      responseDateTimeRenderOption?: DateTimeRenderOption;
    }
  ): Promise<BatchUpdateValuesResponse> {
    const body = {
      valueInputOption: options?.valueInputOption || 'USER_ENTERED',
      data,
      includeValuesInResponse: options?.includeValuesInResponse,
      responseValueRenderOption: options?.responseValueRenderOption,
      responseDateTimeRenderOption: options?.responseDateTimeRenderOption,
    };

    return this.client.post<BatchUpdateValuesResponse>(
      `/spreadsheets/${spreadsheetId}/values:batchUpdate`,
      body
    );
  }

  /**
   * Clear values from multiple ranges in a single request
   * @param spreadsheetId The ID of the spreadsheet
   * @param ranges Array of A1 notation ranges to clear
   */
  async batchClear(
    spreadsheetId: string,
    ranges: string[]
  ): Promise<{ spreadsheetId: string; clearedRanges: string[] }> {
    return this.client.post<{ spreadsheetId: string; clearedRanges: string[] }>(
      `/spreadsheets/${spreadsheetId}/values:batchClear`,
      { ranges }
    );
  }
}
