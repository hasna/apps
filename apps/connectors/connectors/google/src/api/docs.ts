import type { GoogleClient } from './client';
import type {
  Document,
  DocumentCreateParams,
  DocumentBatchUpdateRequest,
  DocumentBatchUpdateResponse,
  DocumentRequest,
} from '../types';

/**
 * Google Docs API module
 * https://docs.googleapis.com/v1
 */
export class DocsApi {
  constructor(private readonly client: GoogleClient) {}

  // ============================================
  // Documents
  // ============================================

  /**
   * Create a new document
   */
  async createDocument(params: DocumentCreateParams): Promise<Document> {
    return this.client.docsPost<Document>('/documents', {
      title: params.title,
    });
  }

  /**
   * Get a document
   */
  async getDocument(documentId: string, options?: {
    suggestionsViewMode?: 'DEFAULT_FOR_CURRENT_ACCESS' | 'SUGGESTIONS_INLINE' | 'PREVIEW_SUGGESTIONS_ACCEPTED' | 'PREVIEW_WITHOUT_SUGGESTIONS';
  }): Promise<Document> {
    return this.client.docsGet<Document>(`/documents/${documentId}`, {
      suggestionsViewMode: options?.suggestionsViewMode,
    });
  }

  /**
   * Batch update a document with multiple requests
   */
  async batchUpdate(documentId: string, requests: DocumentRequest[], options?: {
    writeControlRequiredRevisionId?: string;
    writeControlTargetRevisionId?: string;
  }): Promise<DocumentBatchUpdateResponse> {
    const body: DocumentBatchUpdateRequest = {
      requests,
    };

    if (options?.writeControlRequiredRevisionId || options?.writeControlTargetRevisionId) {
      body.writeControl = {
        requiredRevisionId: options?.writeControlRequiredRevisionId,
        targetRevisionId: options?.writeControlTargetRevisionId,
      };
    }

    return this.client.docsPost<DocumentBatchUpdateResponse>(`/documents/${documentId}:batchUpdate`, body as unknown as Record<string, unknown>);
  }

  // ============================================
  // Convenience Methods
  // ============================================

  /**
   * Insert text at the end of the document
   */
  async appendText(documentId: string, text: string): Promise<DocumentBatchUpdateResponse> {
    return this.batchUpdate(documentId, [
      {
        insertText: {
          text,
          endOfSegmentLocation: {},
        },
      },
    ]);
  }

  /**
   * Insert text at a specific index
   */
  async insertText(documentId: string, text: string, index: number): Promise<DocumentBatchUpdateResponse> {
    return this.batchUpdate(documentId, [
      {
        insertText: {
          text,
          location: { index },
        },
      },
    ]);
  }

  /**
   * Delete content in a range
   */
  async deleteContent(documentId: string, startIndex: number, endIndex: number): Promise<DocumentBatchUpdateResponse> {
    return this.batchUpdate(documentId, [
      {
        deleteContentRange: {
          range: { startIndex, endIndex },
        },
      },
    ]);
  }

  /**
   * Replace all occurrences of text
   */
  async replaceAllText(documentId: string, searchText: string, replaceText: string, matchCase: boolean = false): Promise<DocumentBatchUpdateResponse> {
    return this.batchUpdate(documentId, [
      {
        replaceAllText: {
          replaceText,
          containsText: {
            text: searchText,
            matchCase,
          },
        },
      },
    ]);
  }

  /**
   * Insert an inline image
   */
  async insertImage(documentId: string, imageUri: string, options?: {
    index?: number;
    width?: number;
    height?: number;
  }): Promise<DocumentBatchUpdateResponse> {
    const request: DocumentRequest = {
      insertInlineImage: {
        uri: imageUri,
      },
    };

    if (options?.index !== undefined) {
      request.insertInlineImage!.location = { index: options.index };
    } else {
      request.insertInlineImage!.endOfSegmentLocation = {};
    }

    if (options?.width || options?.height) {
      request.insertInlineImage!.objectSize = {};
      if (options.width) {
        request.insertInlineImage!.objectSize.width = { magnitude: options.width, unit: 'PT' };
      }
      if (options.height) {
        request.insertInlineImage!.objectSize.height = { magnitude: options.height, unit: 'PT' };
      }
    }

    return this.batchUpdate(documentId, [request]);
  }

  /**
   * Insert a table
   */
  async insertTable(documentId: string, rows: number, columns: number, options?: {
    index?: number;
  }): Promise<DocumentBatchUpdateResponse> {
    const request: DocumentRequest = {
      insertTable: {
        rows,
        columns,
      },
    };

    if (options?.index !== undefined) {
      request.insertTable!.location = { index: options.index };
    } else {
      request.insertTable!.endOfSegmentLocation = {};
    }

    return this.batchUpdate(documentId, [request]);
  }

  /**
   * Update text style (bold, italic, etc.)
   */
  async updateTextStyle(documentId: string, startIndex: number, endIndex: number, style: {
    bold?: boolean;
    italic?: boolean;
    underline?: boolean;
    strikethrough?: boolean;
    fontSize?: number;
    foregroundColor?: { red?: number; green?: number; blue?: number };
    backgroundColor?: { red?: number; green?: number; blue?: number };
    link?: string;
  }): Promise<DocumentBatchUpdateResponse> {
    const textStyle: Record<string, unknown> = {};
    const fields: string[] = [];

    if (style.bold !== undefined) {
      textStyle.bold = style.bold;
      fields.push('bold');
    }
    if (style.italic !== undefined) {
      textStyle.italic = style.italic;
      fields.push('italic');
    }
    if (style.underline !== undefined) {
      textStyle.underline = style.underline;
      fields.push('underline');
    }
    if (style.strikethrough !== undefined) {
      textStyle.strikethrough = style.strikethrough;
      fields.push('strikethrough');
    }
    if (style.fontSize !== undefined) {
      textStyle.fontSize = { magnitude: style.fontSize, unit: 'PT' };
      fields.push('fontSize');
    }
    if (style.foregroundColor) {
      textStyle.foregroundColor = { color: { rgbColor: style.foregroundColor } };
      fields.push('foregroundColor');
    }
    if (style.backgroundColor) {
      textStyle.backgroundColor = { color: { rgbColor: style.backgroundColor } };
      fields.push('backgroundColor');
    }
    if (style.link) {
      textStyle.link = { url: style.link };
      fields.push('link');
    }

    return this.batchUpdate(documentId, [
      {
        updateTextStyle: {
          textStyle,
          range: { startIndex, endIndex },
          fields: fields.join(','),
        },
      },
    ]);
  }

  /**
   * Update paragraph style (alignment, heading, etc.)
   */
  async updateParagraphStyle(documentId: string, startIndex: number, endIndex: number, style: {
    namedStyleType?: 'NORMAL_TEXT' | 'TITLE' | 'SUBTITLE' | 'HEADING_1' | 'HEADING_2' | 'HEADING_3' | 'HEADING_4' | 'HEADING_5' | 'HEADING_6';
    alignment?: 'START' | 'CENTER' | 'END' | 'JUSTIFIED';
    lineSpacing?: number;
    spaceAbove?: number;
    spaceBelow?: number;
  }): Promise<DocumentBatchUpdateResponse> {
    const paragraphStyle: Record<string, unknown> = {};
    const fields: string[] = [];

    if (style.namedStyleType !== undefined) {
      paragraphStyle.namedStyleType = style.namedStyleType;
      fields.push('namedStyleType');
    }
    if (style.alignment !== undefined) {
      paragraphStyle.alignment = style.alignment;
      fields.push('alignment');
    }
    if (style.lineSpacing !== undefined) {
      paragraphStyle.lineSpacing = style.lineSpacing;
      fields.push('lineSpacing');
    }
    if (style.spaceAbove !== undefined) {
      paragraphStyle.spaceAbove = { magnitude: style.spaceAbove, unit: 'PT' };
      fields.push('spaceAbove');
    }
    if (style.spaceBelow !== undefined) {
      paragraphStyle.spaceBelow = { magnitude: style.spaceBelow, unit: 'PT' };
      fields.push('spaceBelow');
    }

    return this.batchUpdate(documentId, [
      {
        updateParagraphStyle: {
          paragraphStyle,
          range: { startIndex, endIndex },
          fields: fields.join(','),
        },
      },
    ]);
  }

  /**
   * Create a named range
   */
  async createNamedRange(documentId: string, name: string, startIndex: number, endIndex: number): Promise<DocumentBatchUpdateResponse> {
    return this.batchUpdate(documentId, [
      {
        createNamedRange: {
          name,
          range: { startIndex, endIndex },
        },
      },
    ]);
  }

  /**
   * Delete a named range
   */
  async deleteNamedRange(documentId: string, options: { name?: string; namedRangeId?: string }): Promise<DocumentBatchUpdateResponse> {
    return this.batchUpdate(documentId, [
      {
        deleteNamedRange: options,
      },
    ]);
  }

  /**
   * Create bullet list
   */
  async createBulletList(documentId: string, startIndex: number, endIndex: number, bulletPreset: string = 'BULLET_DISC_CIRCLE_SQUARE'): Promise<DocumentBatchUpdateResponse> {
    return this.batchUpdate(documentId, [
      {
        createParagraphBullets: {
          range: { startIndex, endIndex },
          bulletPreset,
        },
      },
    ]);
  }

  /**
   * Remove bullets from a range
   */
  async deleteBullets(documentId: string, startIndex: number, endIndex: number): Promise<DocumentBatchUpdateResponse> {
    return this.batchUpdate(documentId, [
      {
        deleteParagraphBullets: {
          range: { startIndex, endIndex },
        },
      },
    ]);
  }

  // ============================================
  // Utility Methods
  // ============================================

  /**
   * Get plain text content from a document
   */
  extractPlainText(document: Document): string {
    const parts: string[] = [];

    if (document.body?.content) {
      for (const element of document.body.content) {
        if (element.paragraph?.elements) {
          for (const el of element.paragraph.elements) {
            if (el.textRun?.content) {
              parts.push(el.textRun.content);
            }
          }
        }
      }
    }

    return parts.join('');
  }

  /**
   * Get the end index of the document (for appending)
   */
  getDocumentEndIndex(document: Document): number {
    if (!document.body?.content || document.body.content.length === 0) {
      return 1;
    }

    const lastElement = document.body.content[document.body.content.length - 1];
    return lastElement.endIndex ?? 1;
  }
}
