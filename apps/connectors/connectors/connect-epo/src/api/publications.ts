import type { EPOClient } from './client';
import type {
  DocumentType,
  DocumentFormat,
  PublicationSearchRequest,
  PublicationSearchResponse,
  PublicationResult,
  BiblioResponse,
  BibliographicData,
  AbstractResponse,
  DescriptionResponse,
  ClaimsResponse,
  Claim,
  ImagesResponse,
  ImageInfo,
} from '../types';

// XML parsing helpers (simple regex-based for common patterns)
function extractText(xml: string, tag: string): string | undefined {
  const match = xml.match(new RegExp(`<${tag}[^>]*>([^<]*)</${tag}>`, 'i'));
  return match ? match[1].trim() : undefined;
}

function extractAll(xml: string, tag: string): string[] {
  const regex = new RegExp(`<${tag}[^>]*>([^<]*)</${tag}>`, 'gi');
  const results: string[] = [];
  let match;
  while ((match = regex.exec(xml)) !== null) {
    results.push(match[1].trim());
  }
  return results;
}

function extractAttribute(xml: string, tag: string, attr: string): string | undefined {
  const match = xml.match(new RegExp(`<${tag}[^>]*\\s${attr}="([^"]*)"`, 'i'));
  return match ? match[1] : undefined;
}

/**
 * Publications API - Search and retrieve published patent data
 */
export class PublicationsApi {
  constructor(private readonly client: EPOClient) {}

  /**
   * Search published patents using CQL query
   * @param query - CQL query string (e.g., "ti=solar AND pa=tesla")
   * @param options - Search options
   */
  async search(query: string, options?: { rangeBegin?: number; rangeEnd?: number }): Promise<PublicationSearchResponse> {
    try {
      const params: Record<string, string | number> = {
        q: query,
      };

      if (options?.rangeBegin !== undefined && options?.rangeEnd !== undefined) {
        params['Range'] = `${options.rangeBegin}-${options.rangeEnd}`;
      }

      const xml = await this.client.get<string>(
        '/published-data/search',
        params,
        'application/xml'
      );

      return this.parseSearchResponse(xml);
    } catch (error) {
      return {
        success: false,
        error: String(error),
      };
    }
  }

  /**
   * Get publication by document number
   * @param type - Document type (publication, application, priority)
   * @param format - Document format (docdb, epodoc, original)
   * @param number - Document number
   */
  async getPublication(
    type: DocumentType,
    format: DocumentFormat,
    number: string
  ): Promise<BiblioResponse> {
    try {
      const path = `/published-data/${type}/${format}/${encodeURIComponent(number)}`;
      const xml = await this.client.get<string>(path, undefined, 'application/xml');
      return this.parseBiblioResponse(xml);
    } catch (error) {
      return {
        success: false,
        error: String(error),
      };
    }
  }

  /**
   * Get bibliographic data for a publication
   * @param type - Document type (publication, application, priority)
   * @param format - Document format (docdb, epodoc, original)
   * @param number - Document number
   */
  async getBiblio(
    type: DocumentType,
    format: DocumentFormat,
    number: string
  ): Promise<BiblioResponse> {
    try {
      const path = `/published-data/${type}/${format}/${encodeURIComponent(number)}/biblio`;
      const xml = await this.client.get<string>(path, undefined, 'application/xml');
      return this.parseBiblioResponse(xml);
    } catch (error) {
      return {
        success: false,
        error: String(error),
      };
    }
  }

  /**
   * Get abstract for a publication
   * @param type - Document type (publication, application, priority)
   * @param format - Document format (docdb, epodoc, original)
   * @param number - Document number
   */
  async getAbstract(
    type: DocumentType,
    format: DocumentFormat,
    number: string
  ): Promise<AbstractResponse> {
    try {
      const path = `/published-data/${type}/${format}/${encodeURIComponent(number)}/abstract`;
      const xml = await this.client.get<string>(path, undefined, 'application/xml');
      return this.parseAbstractResponse(xml, number);
    } catch (error) {
      return {
        success: false,
        error: String(error),
      };
    }
  }

  /**
   * Get description for a publication
   * @param type - Document type (publication, application, priority)
   * @param format - Document format (docdb, epodoc, original)
   * @param number - Document number
   */
  async getDescription(
    type: DocumentType,
    format: DocumentFormat,
    number: string
  ): Promise<DescriptionResponse> {
    try {
      const path = `/published-data/${type}/${format}/${encodeURIComponent(number)}/description`;
      const xml = await this.client.get<string>(path, undefined, 'application/xml');
      return this.parseDescriptionResponse(xml, number);
    } catch (error) {
      return {
        success: false,
        error: String(error),
      };
    }
  }

  /**
   * Get claims for a publication
   * @param type - Document type (publication, application, priority)
   * @param format - Document format (docdb, epodoc, original)
   * @param number - Document number
   */
  async getClaims(
    type: DocumentType,
    format: DocumentFormat,
    number: string
  ): Promise<ClaimsResponse> {
    try {
      const path = `/published-data/${type}/${format}/${encodeURIComponent(number)}/claims`;
      const xml = await this.client.get<string>(path, undefined, 'application/xml');
      return this.parseClaimsResponse(xml, number);
    } catch (error) {
      return {
        success: false,
        error: String(error),
      };
    }
  }

  /**
   * Get images metadata for a publication
   * @param type - Document type (publication, application, priority)
   * @param format - Document format (docdb, epodoc, original)
   * @param number - Document number
   */
  async getImages(
    type: DocumentType,
    format: DocumentFormat,
    number: string
  ): Promise<ImagesResponse> {
    try {
      const path = `/published-data/${type}/${format}/${encodeURIComponent(number)}/images`;
      const xml = await this.client.get<string>(path, undefined, 'application/xml');
      return this.parseImagesResponse(xml, number);
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

  private parseSearchResponse(xml: string): PublicationSearchResponse {
    const totalMatch = xml.match(/total-result-count="(\d+)"/);
    const totalResults = totalMatch ? parseInt(totalMatch[1]) : 0;

    const results: PublicationResult[] = [];

    // Extract exchange documents
    const docRegex = /<exchange-document[^>]*>([\s\S]*?)<\/exchange-document>/gi;
    let match;
    while ((match = docRegex.exec(xml)) !== null) {
      const docXml = match[0];

      const country = extractAttribute(docXml, 'exchange-document', 'country');
      const docNumber = extractAttribute(docXml, 'exchange-document', 'doc-number');
      const kind = extractAttribute(docXml, 'exchange-document', 'kind');

      const title = extractText(docXml, 'invention-title');

      results.push({
        documentId: `${country || ''}${docNumber || ''}${kind || ''}`,
        country,
        docNumber,
        kind,
        title,
      });
    }

    return {
      success: true,
      totalResults,
      results,
    };
  }

  private parseBiblioResponse(xml: string): BiblioResponse {
    const country = extractAttribute(xml, 'exchange-document', 'country');
    const docNumber = extractAttribute(xml, 'exchange-document', 'doc-number');
    const kind = extractAttribute(xml, 'exchange-document', 'kind');

    const titles = extractAll(xml, 'invention-title');

    // Extract applicants
    const applicantNames = extractAll(xml, 'name');
    const applicants = applicantNames.slice(0, Math.ceil(applicantNames.length / 2)).map((name, i) => ({
      name,
      sequence: i + 1,
    }));

    // Extract classifications
    const classificationSymbols = extractAll(xml, 'classification-symbol');
    const classifications = classificationSymbols.map(symbol => ({
      scheme: symbol.startsWith('A') || symbol.startsWith('B') ? 'IPC' : 'CPC',
      symbol,
    }));

    const data: BibliographicData = {
      documentId: `${country || ''}${docNumber || ''}${kind || ''}`,
      country,
      docNumber,
      kind,
      title: titles[0],
      titles: titles.map((text, i) => ({ lang: i === 0 ? 'en' : 'other', text })),
      applicants,
      classifications,
    };

    return {
      success: true,
      data,
    };
  }

  private parseAbstractResponse(xml: string, documentId: string): AbstractResponse {
    const abstracts: { lang: string; text: string }[] = [];

    const abstractRegex = /<abstract[^>]*lang="([^"]*)"[^>]*>([\s\S]*?)<\/abstract>/gi;
    let match;
    while ((match = abstractRegex.exec(xml)) !== null) {
      const lang = match[1];
      const content = match[2].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
      abstracts.push({ lang, text: content });
    }

    // Fallback: try to get abstract without lang attribute
    if (abstracts.length === 0) {
      const simpleMatch = xml.match(/<abstract[^>]*>([\s\S]*?)<\/abstract>/i);
      if (simpleMatch) {
        const content = simpleMatch[1].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
        abstracts.push({ lang: 'en', text: content });
      }
    }

    return {
      success: true,
      data: {
        documentId,
        abstracts,
      },
    };
  }

  private parseDescriptionResponse(xml: string, documentId: string): DescriptionResponse {
    const descMatch = xml.match(/<description[^>]*>([\s\S]*?)<\/description>/i);
    const description = descMatch
      ? descMatch[1].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
      : '';

    const langMatch = xml.match(/<description[^>]*lang="([^"]*)"/i);
    const lang = langMatch ? langMatch[1] : undefined;

    return {
      success: true,
      data: {
        documentId,
        description,
        lang,
      },
    };
  }

  private parseClaimsResponse(xml: string, documentId: string): ClaimsResponse {
    const claims: Claim[] = [];

    const claimRegex = /<claim[^>]*num="(\d+)"[^>]*>([\s\S]*?)<\/claim>/gi;
    let match;
    while ((match = claimRegex.exec(xml)) !== null) {
      const num = parseInt(match[1]);
      const content = match[2].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();

      claims.push({
        number: num,
        text: content,
        type: num === 1 ? 'independent' : 'dependent',
      });
    }

    return {
      success: true,
      data: {
        documentId,
        claims,
      },
    };
  }

  private parseImagesResponse(xml: string, documentId: string): ImagesResponse {
    const images: ImageInfo[] = [];

    const imageRegex = /<document-instance[^>]*desc="([^"]*)"[^>]*number-of-pages="(\d+)"[^>]*>/gi;
    let match;
    while ((match = imageRegex.exec(xml)) !== null) {
      images.push({
        type: match[1],
        format: 'PDF',
        pages: parseInt(match[2]),
      });
    }

    return {
      success: true,
      data: {
        documentId,
        images,
      },
    };
  }
}
