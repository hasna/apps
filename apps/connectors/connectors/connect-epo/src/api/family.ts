import type { EPOClient } from './client';
import type {
  DocumentType,
  DocumentFormat,
  FamilyResponse,
  FamilyData,
  FamilyMember,
} from '../types';

/**
 * Family API - Get INPADOC patent family data
 */
export class FamilyApi {
  constructor(private readonly client: EPOClient) {}

  /**
   * Get patent family (INPADOC) for a document
   * @param type - Document type (publication, application, priority)
   * @param format - Document format (docdb, epodoc, original)
   * @param number - Document number
   */
  async getFamily(
    type: DocumentType,
    format: DocumentFormat,
    number: string
  ): Promise<FamilyResponse> {
    try {
      const path = `/family/${type}/${format}/${encodeURIComponent(number)}`;
      const xml = await this.client.get<string>(path, undefined, 'application/xml');
      return this.parseFamilyResponse(xml);
    } catch (error) {
      return {
        success: false,
        error: String(error),
      };
    }
  }

  /**
   * Get patent family with bibliographic data
   * @param type - Document type (publication, application, priority)
   * @param format - Document format (docdb, epodoc, original)
   * @param number - Document number
   */
  async getFamilyWithBiblio(
    type: DocumentType,
    format: DocumentFormat,
    number: string
  ): Promise<FamilyResponse> {
    try {
      const path = `/family/${type}/${format}/${encodeURIComponent(number)}/biblio`;
      const xml = await this.client.get<string>(path, undefined, 'application/xml');
      return this.parseFamilyResponse(xml);
    } catch (error) {
      return {
        success: false,
        error: String(error),
      };
    }
  }

  /**
   * Get patent family with legal status
   * @param type - Document type (publication, application, priority)
   * @param format - Document format (docdb, epodoc, original)
   * @param number - Document number
   */
  async getFamilyWithLegal(
    type: DocumentType,
    format: DocumentFormat,
    number: string
  ): Promise<FamilyResponse> {
    try {
      const path = `/family/${type}/${format}/${encodeURIComponent(number)}/legal`;
      const xml = await this.client.get<string>(path, undefined, 'application/xml');
      return this.parseFamilyResponse(xml);
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

  private parseFamilyResponse(xml: string): FamilyResponse {
    const members: FamilyMember[] = [];

    // Extract family ID if available
    const familyIdMatch = xml.match(/family-id="([^"]*)"/);
    const familyId = familyIdMatch ? familyIdMatch[1] : undefined;

    // Extract family members from patent-family/family-member elements
    const memberRegex = /<family-member[^>]*>([\s\S]*?)<\/family-member>/gi;
    let match;
    let sequence = 0;

    while ((match = memberRegex.exec(xml)) !== null) {
      sequence++;
      const memberXml = match[1];

      // Extract publication reference
      const pubRefMatch = memberXml.match(/<publication-reference[^>]*>([\s\S]*?)<\/publication-reference>/i);
      if (pubRefMatch) {
        const pubRef = pubRefMatch[1];

        const country = this.extractDocId(pubRef, 'country');
        const docNumber = this.extractDocId(pubRef, 'doc-number');
        const kind = this.extractDocId(pubRef, 'kind');
        const date = this.extractDocId(pubRef, 'date');

        // Extract application reference
        const appRefMatch = memberXml.match(/<application-reference[^>]*>([\s\S]*?)<\/application-reference>/i);
        let applicationRef: FamilyMember['applicationRef'] | undefined;
        if (appRefMatch) {
          const appRef = appRefMatch[1];
          applicationRef = {
            country: this.extractDocId(appRef, 'country') || '',
            docNumber: this.extractDocId(appRef, 'doc-number') || '',
            date: this.extractDocId(appRef, 'date'),
          };
        }

        // Extract priority claims
        const priorityClaims = this.extractPriorityClaims(memberXml);

        members.push({
          documentId: `${country || ''}${docNumber || ''}${kind || ''}`,
          country: country || '',
          docNumber: docNumber || '',
          kind,
          date,
          familySequence: sequence,
          applicationRef,
          priorityClaims,
        });
      }
    }

    // If no family-member elements found, try to parse simple-family format
    if (members.length === 0) {
      const simpleRegex = /<exchange-document[^>]*>([\s\S]*?)<\/exchange-document>/gi;
      while ((match = simpleRegex.exec(xml)) !== null) {
        sequence++;
        const docXml = match[0];

        const country = this.extractAttribute(docXml, 'exchange-document', 'country');
        const docNumber = this.extractAttribute(docXml, 'exchange-document', 'doc-number');
        const kind = this.extractAttribute(docXml, 'exchange-document', 'kind');

        members.push({
          documentId: `${country || ''}${docNumber || ''}${kind || ''}`,
          country: country || '',
          docNumber: docNumber || '',
          kind,
          familySequence: sequence,
        });
      }
    }

    return {
      success: true,
      data: {
        familyId,
        members,
        totalMembers: members.length,
      },
    };
  }

  private extractDocId(xml: string, field: string): string | undefined {
    const match = xml.match(new RegExp(`<${field}[^>]*>([^<]*)</${field}>`, 'i'));
    return match ? match[1].trim() : undefined;
  }

  private extractAttribute(xml: string, tag: string, attr: string): string | undefined {
    const match = xml.match(new RegExp(`<${tag}[^>]*\\s${attr}="([^"]*)"`, 'i'));
    return match ? match[1] : undefined;
  }

  private extractPriorityClaims(xml: string): FamilyMember['priorityClaims'] {
    const claims: NonNullable<FamilyMember['priorityClaims']> = [];

    const claimRegex = /<priority-claim[^>]*>([\s\S]*?)<\/priority-claim>/gi;
    let match;

    while ((match = claimRegex.exec(xml)) !== null) {
      const claimXml = match[1];

      const country = this.extractDocId(claimXml, 'country');
      const docNumber = this.extractDocId(claimXml, 'doc-number');
      const date = this.extractDocId(claimXml, 'date');
      const kind = this.extractDocId(claimXml, 'kind');

      if (country && docNumber && date) {
        claims.push({
          country,
          docNumber,
          date,
          kind,
        });
      }
    }

    return claims.length > 0 ? claims : undefined;
  }
}
