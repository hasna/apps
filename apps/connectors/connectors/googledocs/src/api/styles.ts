import type { GoogleDocsClient } from './client';
import type {
  BatchUpdateResponse,
  Request,
  TextStyle,
  ParagraphStyle,
  Range,
  NamedStyleType,
  Alignment,
} from '../types';

/**
 * Styles API - Helper methods for text and paragraph styling
 * Wraps common style operations into convenient methods
 */
export class StylesApi {
  constructor(private readonly client: GoogleDocsClient) {}

  /**
   * Update text style for a range
   * @param documentId The document ID
   * @param range The range to style
   * @param style The text style to apply
   * @param fields Which fields to update (e.g., 'bold,italic' or '*' for all)
   */
  async updateTextStyle(
    documentId: string,
    range: Range,
    style: TextStyle,
    fields: string
  ): Promise<BatchUpdateResponse> {
    const requests: Request[] = [
      {
        updateTextStyle: {
          range,
          textStyle: style,
          fields,
        },
      },
    ];
    return this.batchUpdate(documentId, requests);
  }

  /**
   * Update paragraph style for a range
   * @param documentId The document ID
   * @param range The range to style
   * @param style The paragraph style to apply
   * @param fields Which fields to update (e.g., 'alignment,lineSpacing' or '*' for all)
   */
  async updateParagraphStyle(
    documentId: string,
    range: Range,
    style: ParagraphStyle,
    fields: string
  ): Promise<BatchUpdateResponse> {
    const requests: Request[] = [
      {
        updateParagraphStyle: {
          range,
          paragraphStyle: style,
          fields,
        },
      },
    ];
    return this.batchUpdate(documentId, requests);
  }

  /**
   * Make text bold
   * @param documentId The document ID
   * @param startIndex Start of the range
   * @param endIndex End of the range
   */
  async setBold(documentId: string, startIndex: number, endIndex: number): Promise<BatchUpdateResponse> {
    return this.updateTextStyle(
      documentId,
      { startIndex, endIndex },
      { bold: true },
      'bold'
    );
  }

  /**
   * Make text italic
   * @param documentId The document ID
   * @param startIndex Start of the range
   * @param endIndex End of the range
   */
  async setItalic(documentId: string, startIndex: number, endIndex: number): Promise<BatchUpdateResponse> {
    return this.updateTextStyle(
      documentId,
      { startIndex, endIndex },
      { italic: true },
      'italic'
    );
  }

  /**
   * Underline text
   * @param documentId The document ID
   * @param startIndex Start of the range
   * @param endIndex End of the range
   */
  async setUnderline(documentId: string, startIndex: number, endIndex: number): Promise<BatchUpdateResponse> {
    return this.updateTextStyle(
      documentId,
      { startIndex, endIndex },
      { underline: true },
      'underline'
    );
  }

  /**
   * Strikethrough text
   * @param documentId The document ID
   * @param startIndex Start of the range
   * @param endIndex End of the range
   */
  async setStrikethrough(documentId: string, startIndex: number, endIndex: number): Promise<BatchUpdateResponse> {
    return this.updateTextStyle(
      documentId,
      { startIndex, endIndex },
      { strikethrough: true },
      'strikethrough'
    );
  }

  /**
   * Set font size
   * @param documentId The document ID
   * @param startIndex Start of the range
   * @param endIndex End of the range
   * @param sizePt Font size in points
   */
  async setFontSize(
    documentId: string,
    startIndex: number,
    endIndex: number,
    sizePt: number
  ): Promise<BatchUpdateResponse> {
    return this.updateTextStyle(
      documentId,
      { startIndex, endIndex },
      { fontSize: { magnitude: sizePt, unit: 'PT' } },
      'fontSize'
    );
  }

  /**
   * Set font family
   * @param documentId The document ID
   * @param startIndex Start of the range
   * @param endIndex End of the range
   * @param fontFamily Font family name (e.g., 'Arial', 'Times New Roman')
   */
  async setFontFamily(
    documentId: string,
    startIndex: number,
    endIndex: number,
    fontFamily: string
  ): Promise<BatchUpdateResponse> {
    return this.updateTextStyle(
      documentId,
      { startIndex, endIndex },
      { weightedFontFamily: { fontFamily } },
      'weightedFontFamily'
    );
  }

  /**
   * Set text color (foreground color)
   * @param documentId The document ID
   * @param startIndex Start of the range
   * @param endIndex End of the range
   * @param red Red component (0-1)
   * @param green Green component (0-1)
   * @param blue Blue component (0-1)
   */
  async setTextColor(
    documentId: string,
    startIndex: number,
    endIndex: number,
    red: number,
    green: number,
    blue: number
  ): Promise<BatchUpdateResponse> {
    return this.updateTextStyle(
      documentId,
      { startIndex, endIndex },
      {
        foregroundColor: {
          color: { rgbColor: { red, green, blue } },
        },
      },
      'foregroundColor'
    );
  }

  /**
   * Set background highlight color
   * @param documentId The document ID
   * @param startIndex Start of the range
   * @param endIndex End of the range
   * @param red Red component (0-1)
   * @param green Green component (0-1)
   * @param blue Blue component (0-1)
   */
  async setHighlightColor(
    documentId: string,
    startIndex: number,
    endIndex: number,
    red: number,
    green: number,
    blue: number
  ): Promise<BatchUpdateResponse> {
    return this.updateTextStyle(
      documentId,
      { startIndex, endIndex },
      {
        backgroundColor: {
          color: { rgbColor: { red, green, blue } },
        },
      },
      'backgroundColor'
    );
  }

  /**
   * Add a link to text
   * @param documentId The document ID
   * @param startIndex Start of the range
   * @param endIndex End of the range
   * @param url The URL to link to
   */
  async setLink(
    documentId: string,
    startIndex: number,
    endIndex: number,
    url: string
  ): Promise<BatchUpdateResponse> {
    return this.updateTextStyle(
      documentId,
      { startIndex, endIndex },
      { link: { url } },
      'link'
    );
  }

  /**
   * Set paragraph alignment
   * @param documentId The document ID
   * @param startIndex Start of the range
   * @param endIndex End of the range
   * @param alignment Alignment type
   */
  async setAlignment(
    documentId: string,
    startIndex: number,
    endIndex: number,
    alignment: Alignment
  ): Promise<BatchUpdateResponse> {
    return this.updateParagraphStyle(
      documentId,
      { startIndex, endIndex },
      { alignment },
      'alignment'
    );
  }

  /**
   * Set paragraph line spacing
   * @param documentId The document ID
   * @param startIndex Start of the range
   * @param endIndex End of the range
   * @param lineSpacing Line spacing (100 = single, 200 = double, etc.)
   */
  async setLineSpacing(
    documentId: string,
    startIndex: number,
    endIndex: number,
    lineSpacing: number
  ): Promise<BatchUpdateResponse> {
    return this.updateParagraphStyle(
      documentId,
      { startIndex, endIndex },
      { lineSpacing },
      'lineSpacing'
    );
  }

  /**
   * Set paragraph named style (heading level)
   * @param documentId The document ID
   * @param startIndex Start of the range
   * @param endIndex End of the range
   * @param namedStyleType The style type (NORMAL_TEXT, TITLE, HEADING_1, etc.)
   */
  async setNamedStyle(
    documentId: string,
    startIndex: number,
    endIndex: number,
    namedStyleType: NamedStyleType
  ): Promise<BatchUpdateResponse> {
    return this.updateParagraphStyle(
      documentId,
      { startIndex, endIndex },
      { namedStyleType },
      'namedStyleType'
    );
  }

  /**
   * Set paragraph spacing (above and below)
   * @param documentId The document ID
   * @param startIndex Start of the range
   * @param endIndex End of the range
   * @param spaceAbovePt Space above in points
   * @param spaceBelowPt Space below in points
   */
  async setSpacing(
    documentId: string,
    startIndex: number,
    endIndex: number,
    spaceAbovePt: number,
    spaceBelowPt: number
  ): Promise<BatchUpdateResponse> {
    return this.updateParagraphStyle(
      documentId,
      { startIndex, endIndex },
      {
        spaceAbove: { magnitude: spaceAbovePt, unit: 'PT' },
        spaceBelow: { magnitude: spaceBelowPt, unit: 'PT' },
      },
      'spaceAbove,spaceBelow'
    );
  }

  /**
   * Set paragraph indentation
   * @param documentId The document ID
   * @param startIndex Start of the range
   * @param endIndex End of the range
   * @param firstLinePt First line indent in points
   * @param startPt Start indent in points
   * @param endPt End indent in points
   */
  async setIndentation(
    documentId: string,
    startIndex: number,
    endIndex: number,
    firstLinePt?: number,
    startPt?: number,
    endPt?: number
  ): Promise<BatchUpdateResponse> {
    const style: ParagraphStyle = {};
    const fields: string[] = [];

    if (firstLinePt !== undefined) {
      style.indentFirstLine = { magnitude: firstLinePt, unit: 'PT' };
      fields.push('indentFirstLine');
    }
    if (startPt !== undefined) {
      style.indentStart = { magnitude: startPt, unit: 'PT' };
      fields.push('indentStart');
    }
    if (endPt !== undefined) {
      style.indentEnd = { magnitude: endPt, unit: 'PT' };
      fields.push('indentEnd');
    }

    return this.updateParagraphStyle(
      documentId,
      { startIndex, endIndex },
      style,
      fields.join(',')
    );
  }

  /**
   * Helper to execute batchUpdate
   */
  private async batchUpdate(documentId: string, requests: Request[]): Promise<BatchUpdateResponse> {
    return this.client.post<BatchUpdateResponse>(`/documents/${documentId}:batchUpdate`, { requests });
  }
}
