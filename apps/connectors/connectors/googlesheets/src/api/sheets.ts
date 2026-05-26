import type { GoogleSheetsClient } from './client';
import type {
  SheetProperties,
  BatchUpdateSpreadsheetResponse,
  Color,
  GridProperties,
} from '../types';

/**
 * Sheets API for managing individual sheets within a spreadsheet
 */
export class SheetsApi {
  constructor(private readonly client: GoogleSheetsClient) {}

  /**
   * Add a new sheet to a spreadsheet
   * @param spreadsheetId The ID of the spreadsheet
   * @param title The title of the new sheet
   * @param options Optional sheet properties
   */
  async add(
    spreadsheetId: string,
    title: string,
    options?: {
      index?: number;
      tabColor?: Color;
      gridProperties?: GridProperties;
      hidden?: boolean;
    }
  ): Promise<BatchUpdateSpreadsheetResponse> {
    const properties: Partial<SheetProperties> = {
      title,
      ...options,
    };

    return this.client.post<BatchUpdateSpreadsheetResponse>(
      `/spreadsheets/${spreadsheetId}:batchUpdate`,
      {
        requests: [
          {
            addSheet: {
              properties,
            },
          },
        ],
      }
    );
  }

  /**
   * Delete a sheet from a spreadsheet
   * @param spreadsheetId The ID of the spreadsheet
   * @param sheetId The ID of the sheet to delete
   */
  async delete(spreadsheetId: string, sheetId: number): Promise<BatchUpdateSpreadsheetResponse> {
    return this.client.post<BatchUpdateSpreadsheetResponse>(
      `/spreadsheets/${spreadsheetId}:batchUpdate`,
      {
        requests: [
          {
            deleteSheet: {
              sheetId,
            },
          },
        ],
      }
    );
  }

  /**
   * Rename a sheet
   * @param spreadsheetId The ID of the spreadsheet
   * @param sheetId The ID of the sheet to rename
   * @param newTitle The new title for the sheet
   */
  async rename(
    spreadsheetId: string,
    sheetId: number,
    newTitle: string
  ): Promise<BatchUpdateSpreadsheetResponse> {
    return this.client.post<BatchUpdateSpreadsheetResponse>(
      `/spreadsheets/${spreadsheetId}:batchUpdate`,
      {
        requests: [
          {
            updateSheetProperties: {
              properties: {
                sheetId,
                title: newTitle,
              },
              fields: 'title',
            },
          },
        ],
      }
    );
  }

  /**
   * Copy a sheet to another spreadsheet
   * @param spreadsheetId The source spreadsheet ID
   * @param sheetId The ID of the sheet to copy
   * @param destinationSpreadsheetId The destination spreadsheet ID
   */
  async copy(
    spreadsheetId: string,
    sheetId: number,
    destinationSpreadsheetId: string
  ): Promise<SheetProperties> {
    return this.client.post<SheetProperties>(
      `/spreadsheets/${spreadsheetId}/sheets/${sheetId}:copyTo`,
      {
        destinationSpreadsheetId,
      }
    );
  }

  /**
   * Duplicate a sheet within the same spreadsheet
   * @param spreadsheetId The ID of the spreadsheet
   * @param sheetId The ID of the sheet to duplicate
   * @param options Optional parameters for the duplicated sheet
   */
  async duplicate(
    spreadsheetId: string,
    sheetId: number,
    options?: {
      insertSheetIndex?: number;
      newSheetId?: number;
      newSheetName?: string;
    }
  ): Promise<BatchUpdateSpreadsheetResponse> {
    return this.client.post<BatchUpdateSpreadsheetResponse>(
      `/spreadsheets/${spreadsheetId}:batchUpdate`,
      {
        requests: [
          {
            duplicateSheet: {
              sourceSheetId: sheetId,
              ...options,
            },
          },
        ],
      }
    );
  }

  /**
   * Update sheet properties
   * @param spreadsheetId The ID of the spreadsheet
   * @param sheetId The ID of the sheet
   * @param properties Properties to update
   */
  async updateProperties(
    spreadsheetId: string,
    sheetId: number,
    properties: Partial<Omit<SheetProperties, 'sheetId'>>
  ): Promise<BatchUpdateSpreadsheetResponse> {
    const fields = Object.keys(properties).join(',');

    return this.client.post<BatchUpdateSpreadsheetResponse>(
      `/spreadsheets/${spreadsheetId}:batchUpdate`,
      {
        requests: [
          {
            updateSheetProperties: {
              properties: {
                sheetId,
                ...properties,
              },
              fields,
            },
          },
        ],
      }
    );
  }

  /**
   * Hide a sheet
   * @param spreadsheetId The ID of the spreadsheet
   * @param sheetId The ID of the sheet to hide
   */
  async hide(spreadsheetId: string, sheetId: number): Promise<BatchUpdateSpreadsheetResponse> {
    return this.updateProperties(spreadsheetId, sheetId, { hidden: true });
  }

  /**
   * Show a hidden sheet
   * @param spreadsheetId The ID of the spreadsheet
   * @param sheetId The ID of the sheet to show
   */
  async show(spreadsheetId: string, sheetId: number): Promise<BatchUpdateSpreadsheetResponse> {
    return this.updateProperties(spreadsheetId, sheetId, { hidden: false });
  }

  /**
   * Set sheet tab color
   * @param spreadsheetId The ID of the spreadsheet
   * @param sheetId The ID of the sheet
   * @param color The tab color (RGB values 0-1)
   */
  async setTabColor(
    spreadsheetId: string,
    sheetId: number,
    color: Color
  ): Promise<BatchUpdateSpreadsheetResponse> {
    return this.updateProperties(spreadsheetId, sheetId, { tabColor: color });
  }

  /**
   * Freeze rows and/or columns
   * @param spreadsheetId The ID of the spreadsheet
   * @param sheetId The ID of the sheet
   * @param options Number of rows/columns to freeze
   */
  async freeze(
    spreadsheetId: string,
    sheetId: number,
    options: {
      rows?: number;
      columns?: number;
    }
  ): Promise<BatchUpdateSpreadsheetResponse> {
    const gridProperties: Partial<GridProperties> = {};
    if (options.rows !== undefined) {
      gridProperties.frozenRowCount = options.rows;
    }
    if (options.columns !== undefined) {
      gridProperties.frozenColumnCount = options.columns;
    }

    return this.updateProperties(spreadsheetId, sheetId, { gridProperties: gridProperties as GridProperties });
  }

  /**
   * Move a sheet to a different index position
   * @param spreadsheetId The ID of the spreadsheet
   * @param sheetId The ID of the sheet to move
   * @param newIndex The new index position (0-based)
   */
  async move(
    spreadsheetId: string,
    sheetId: number,
    newIndex: number
  ): Promise<BatchUpdateSpreadsheetResponse> {
    return this.updateProperties(spreadsheetId, sheetId, { index: newIndex });
  }
}
