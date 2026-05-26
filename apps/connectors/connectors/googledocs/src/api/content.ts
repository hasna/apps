import type { GoogleDocsClient } from './client';
import type { BatchUpdateResponse, Request, Size } from '../types';

/**
 * Content API - Helper methods for content manipulation
 * Wraps common batchUpdate operations into convenient methods
 */
export class ContentApi {
  constructor(private readonly client: GoogleDocsClient) {}

  /**
   * Insert text at a specific position
   * @param documentId The document ID
   * @param text The text to insert
   * @param index The position to insert at (1-based, after the first character of the document body)
   */
  async insertText(documentId: string, text: string, index: number): Promise<BatchUpdateResponse> {
    const requests: Request[] = [
      {
        insertText: {
          text,
          location: { index },
        },
      },
    ];
    return this.batchUpdate(documentId, requests);
  }

  /**
   * Append text to the end of the document
   * @param documentId The document ID
   * @param text The text to append
   */
  async appendText(documentId: string, text: string): Promise<BatchUpdateResponse> {
    const requests: Request[] = [
      {
        insertText: {
          text,
          endOfSegmentLocation: {},
        },
      },
    ];
    return this.batchUpdate(documentId, requests);
  }

  /**
   * Delete content within a range
   * @param documentId The document ID
   * @param startIndex The start of the range (inclusive)
   * @param endIndex The end of the range (exclusive)
   */
  async deleteRange(documentId: string, startIndex: number, endIndex: number): Promise<BatchUpdateResponse> {
    const requests: Request[] = [
      {
        deleteContentRange: {
          range: { startIndex, endIndex },
        },
      },
    ];
    return this.batchUpdate(documentId, requests);
  }

  /**
   * Replace all occurrences of text in the document
   * @param documentId The document ID
   * @param find The text to find
   * @param replace The replacement text
   * @param matchCase Whether to match case (default: false)
   */
  async replaceText(
    documentId: string,
    find: string,
    replace: string,
    matchCase = false
  ): Promise<BatchUpdateResponse> {
    const requests: Request[] = [
      {
        replaceAllText: {
          containsText: {
            text: find,
            matchCase,
          },
          replaceText: replace,
        },
      },
    ];
    return this.batchUpdate(documentId, requests);
  }

  /**
   * Insert an image at a specific position
   * @param documentId The document ID
   * @param uri The URI of the image (must be publicly accessible)
   * @param index The position to insert at
   * @param objectSize Optional size for the image
   */
  async insertImage(
    documentId: string,
    uri: string,
    index: number,
    objectSize?: Size
  ): Promise<BatchUpdateResponse> {
    const requests: Request[] = [
      {
        insertInlineImage: {
          uri,
          location: { index },
          ...(objectSize && { objectSize }),
        },
      },
    ];
    return this.batchUpdate(documentId, requests);
  }

  /**
   * Append an image to the end of the document
   * @param documentId The document ID
   * @param uri The URI of the image (must be publicly accessible)
   * @param objectSize Optional size for the image
   */
  async appendImage(documentId: string, uri: string, objectSize?: Size): Promise<BatchUpdateResponse> {
    const requests: Request[] = [
      {
        insertInlineImage: {
          uri,
          endOfSegmentLocation: {},
          ...(objectSize && { objectSize }),
        },
      },
    ];
    return this.batchUpdate(documentId, requests);
  }

  /**
   * Insert a page break at a specific position
   * @param documentId The document ID
   * @param index The position to insert at
   */
  async insertPageBreak(documentId: string, index: number): Promise<BatchUpdateResponse> {
    const requests: Request[] = [
      {
        insertPageBreak: {
          location: { index },
        },
      },
    ];
    return this.batchUpdate(documentId, requests);
  }

  /**
   * Insert a table at a specific position
   * @param documentId The document ID
   * @param rows Number of rows
   * @param columns Number of columns
   * @param index The position to insert at
   */
  async insertTable(
    documentId: string,
    rows: number,
    columns: number,
    index: number
  ): Promise<BatchUpdateResponse> {
    const requests: Request[] = [
      {
        insertTable: {
          rows,
          columns,
          location: { index },
        },
      },
    ];
    return this.batchUpdate(documentId, requests);
  }

  /**
   * Create a named range for a portion of the document
   * @param documentId The document ID
   * @param name The name for the range
   * @param startIndex Start of the range
   * @param endIndex End of the range
   */
  async createNamedRange(
    documentId: string,
    name: string,
    startIndex: number,
    endIndex: number
  ): Promise<BatchUpdateResponse> {
    const requests: Request[] = [
      {
        createNamedRange: {
          name,
          range: { startIndex, endIndex },
        },
      },
    ];
    return this.batchUpdate(documentId, requests);
  }

  /**
   * Delete a named range
   * @param documentId The document ID
   * @param name The name of the range to delete (or namedRangeId)
   */
  async deleteNamedRange(documentId: string, name: string): Promise<BatchUpdateResponse> {
    const requests: Request[] = [
      {
        deleteNamedRange: { name },
      },
    ];
    return this.batchUpdate(documentId, requests);
  }

  /**
   * Helper to execute batchUpdate
   */
  private async batchUpdate(documentId: string, requests: Request[]): Promise<BatchUpdateResponse> {
    return this.client.post<BatchUpdateResponse>(`/documents/${documentId}:batchUpdate`, { requests });
  }
}
