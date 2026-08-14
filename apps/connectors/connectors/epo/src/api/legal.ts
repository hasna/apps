import type { EPOClient } from './client';
import type {
  DocumentType,
  DocumentFormat,
  LegalStatusResponse,
  LegalStatusData,
  LegalEvent,
} from '../types';

/**
 * Legal Status API - Get legal status information for patents
 */
export class LegalApi {
  constructor(private readonly client: EPOClient) {}

  /**
   * Get legal status for a document
   * @param type - Document type (publication, application, priority)
   * @param format - Document format (docdb, epodoc, original)
   * @param number - Document number
   */
  async getLegalStatus(
    type: DocumentType,
    format: DocumentFormat,
    number: string
  ): Promise<LegalStatusResponse> {
    try {
      const path = `/legal/${type}/${format}/${encodeURIComponent(number)}`;
      const xml = await this.client.get<string>(path, undefined, 'application/xml');
      return this.parseLegalStatusResponse(xml, number);
    } catch (error) {
      return {
        success: false,
        error: String(error),
      };
    }
  }

  // ============================================
  // Response Parsing
  // ============================================

  private parseLegalStatusResponse(xml: string, documentId: string): LegalStatusResponse {
    const events: LegalEvent[] = [];

    // Extract legal events
    const eventRegex = /<ops:legal[^>]*>([\s\S]*?)<\/ops:legal>/gi;
    let match;

    while ((match = eventRegex.exec(xml)) !== null) {
      const eventXml = match[1];

      const code = this.extractAttribute(eventXml, 'ops:code', '') ||
                   this.extractElement(eventXml, 'ops:code');
      const date = this.extractAttribute(eventXml, 'ops:date', '') ||
                   this.extractElement(eventXml, 'ops:date');
      const country = this.extractAttribute(eventXml, 'ops:country', '') ||
                      this.extractElement(eventXml, 'ops:country');
      const desc = this.extractElement(eventXml, 'ops:text-desc') ||
                   this.extractElement(eventXml, 'ops:description');

      // Extract gazette info if available
      const gazetteNum = this.extractElement(eventXml, 'ops:gazette-num');
      const gazetteDate = this.extractElement(eventXml, 'ops:gazette-date');

      if (code || date) {
        const event: LegalEvent = {
          code: code || '',
          date: date || '',
          country: country || undefined,
          description: desc || undefined,
        };

        if (gazetteNum || gazetteDate) {
          event.gazette = {
            number: gazetteNum,
            date: gazetteDate,
          };
        }

        events.push(event);
      }
    }

    // Try alternative format without ops: prefix
    if (events.length === 0) {
      const altEventRegex = /<legal-event[^>]*>([\s\S]*?)<\/legal-event>/gi;
      while ((match = altEventRegex.exec(xml)) !== null) {
        const eventXml = match[1];

        const codeEl = this.extractElement(eventXml, 'code');
        const dateEl = this.extractElement(eventXml, 'date');
        const countryEl = this.extractElement(eventXml, 'country');
        const descEl = this.extractElement(eventXml, 'description') ||
                       this.extractElement(eventXml, 'text');

        if (codeEl || dateEl) {
          events.push({
            code: codeEl || '',
            date: dateEl || '',
            country: countryEl || undefined,
            description: descEl || undefined,
          });
        }
      }
    }

    // Try to extract from register-documents format
    if (events.length === 0) {
      const regEventRegex = /<register-event[^>]*>([\s\S]*?)<\/register-event>/gi;
      while ((match = regEventRegex.exec(xml)) !== null) {
        const eventXml = match[1];

        const code = this.extractElement(eventXml, 'event-code') ||
                     this.extractAttribute(eventXml, 'register-event', 'code');
        const date = this.extractElement(eventXml, 'event-date') ||
                     this.extractAttribute(eventXml, 'register-event', 'date');
        const desc = this.extractElement(eventXml, 'event-text');

        if (code || date) {
          events.push({
            code: code || '',
            date: date || '',
            description: desc || undefined,
          });
        }
      }
    }

    return {
      success: true,
      data: {
        documentId,
        events,
      },
    };
  }

  private extractElement(xml: string, tag: string): string | undefined {
    // Handle both prefixed and non-prefixed tags
    const colonIndex = tag.indexOf(':');
    const localName = colonIndex >= 0 ? tag.substring(colonIndex + 1) : tag;

    // Try with exact tag first
    let match = xml.match(new RegExp(`<${tag}[^>]*>([^<]*)</${tag}>`, 'i'));
    if (match) return match[1].trim();

    // Try with just local name (no namespace prefix)
    match = xml.match(new RegExp(`<${localName}[^>]*>([^<]*)</${localName}>`, 'i'));
    if (match) return match[1].trim();

    // Try with any namespace prefix
    match = xml.match(new RegExp(`<[^:>]+:${localName}[^>]*>([^<]*)</[^:>]+:${localName}>`, 'i'));
    if (match) return match[1].trim();

    return undefined;
  }

  private extractAttribute(xml: string, tag: string, attr: string): string | undefined {
    const match = xml.match(new RegExp(`<${tag}[^>]*\\s${attr}="([^"]*)"`, 'i'));
    return match ? match[1] : undefined;
  }
}
