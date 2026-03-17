import type { EPOClient } from './client';
import type {
  DocumentType,
  DocumentFormat,
  RegisterSearchResponse,
  RegisterResult,
  RegisterDataResponse,
  RegisterData,
  RegisterEvent,
  RegisterDocument,
  Applicant,
  Inventor,
  Representative,
  Classification,
  PriorityData,
} from '../types';

/**
 * Register API - Access EP Register data
 */
export class RegisterApi {
  constructor(private readonly client: EPOClient) {}

  /**
   * Search the EP Register
   * @param query - CQL query string
   * @param options - Search options
   */
  async search(query: string, options?: { rangeBegin?: number; rangeEnd?: number }): Promise<RegisterSearchResponse> {
    try {
      const params: Record<string, string | number> = {
        q: query,
      };

      if (options?.rangeBegin !== undefined && options?.rangeEnd !== undefined) {
        params['Range'] = `${options.rangeBegin}-${options.rangeEnd}`;
      }

      const xml = await this.client.get<string>(
        '/register/search',
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
   * Get register data for a publication
   * @param type - Document type (publication, application, priority)
   * @param format - Document format (docdb, epodoc, original)
   * @param number - Document number
   */
  async getRegisterData(
    type: DocumentType,
    format: DocumentFormat,
    number: string
  ): Promise<RegisterDataResponse> {
    try {
      const path = `/register/publication/${type}/${format}/${encodeURIComponent(number)}`;
      const xml = await this.client.get<string>(path, undefined, 'application/xml');
      return this.parseRegisterDataResponse(xml);
    } catch (error) {
      return {
        success: false,
        error: String(error),
      };
    }
  }

  /**
   * Get register data for an application
   * @param type - Document type (publication, application, priority)
   * @param format - Document format (docdb, epodoc, original)
   * @param number - Document number
   */
  async getApplicationData(
    type: DocumentType,
    format: DocumentFormat,
    number: string
  ): Promise<RegisterDataResponse> {
    try {
      const path = `/register/application/${type}/${format}/${encodeURIComponent(number)}`;
      const xml = await this.client.get<string>(path, undefined, 'application/xml');
      return this.parseRegisterDataResponse(xml);
    } catch (error) {
      return {
        success: false,
        error: String(error),
      };
    }
  }

  /**
   * Get procedural steps for an application
   * @param type - Document type (publication, application, priority)
   * @param format - Document format (docdb, epodoc, original)
   * @param number - Document number
   */
  async getProceduralSteps(
    type: DocumentType,
    format: DocumentFormat,
    number: string
  ): Promise<RegisterDataResponse> {
    try {
      const path = `/register/application/${type}/${format}/${encodeURIComponent(number)}/procedural-steps`;
      const xml = await this.client.get<string>(path, undefined, 'application/xml');
      return this.parseRegisterDataResponse(xml);
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

  private parseSearchResponse(xml: string): RegisterSearchResponse {
    const totalMatch = xml.match(/total-result-count="(\d+)"/);
    const totalResults = totalMatch ? parseInt(totalMatch[1]) : 0;

    const results: RegisterResult[] = [];

    // Extract register documents
    const docRegex = /<register-document[^>]*>([\s\S]*?)<\/register-document>/gi;
    let match;

    while ((match = docRegex.exec(xml)) !== null) {
      const docXml = match[1];

      const applicationNumber = this.extractElement(docXml, 'application-number') ||
                                this.extractElement(docXml, 'doc-number');
      const publicationNumber = this.extractElement(docXml, 'publication-number');
      const status = this.extractElement(docXml, 'status') ||
                     this.extractElement(docXml, 'application-status');
      const title = this.extractElement(docXml, 'invention-title');

      // Extract applicants
      const applicants = this.extractAllElements(docXml, 'applicant-name')
        .concat(this.extractAllElements(docXml, 'name'));

      const filingDate = this.extractElement(docXml, 'filing-date') ||
                         this.extractElement(docXml, 'date-of-filing');

      results.push({
        applicationNumber: applicationNumber || '',
        publicationNumber,
        status,
        title,
        applicants: applicants.length > 0 ? applicants : undefined,
        filingDate,
      });
    }

    return {
      success: true,
      totalResults,
      results,
    };
  }

  private parseRegisterDataResponse(xml: string): RegisterDataResponse {
    const applicationNumber = this.extractElement(xml, 'application-number') ||
                              this.extractElement(xml, 'doc-number') || '';
    const publicationNumber = this.extractElement(xml, 'publication-number');
    const status = this.extractElement(xml, 'status') ||
                   this.extractElement(xml, 'application-status');
    const procedureType = this.extractElement(xml, 'procedure-type');
    const title = this.extractElement(xml, 'invention-title');

    // Extract applicants
    const applicants = this.parseApplicants(xml);

    // Extract inventors
    const inventors = this.parseInventors(xml);

    // Extract representatives
    const representatives = this.parseRepresentatives(xml);

    // Extract dates
    const filingDate = this.extractElement(xml, 'filing-date') ||
                       this.extractElement(xml, 'date-of-filing');
    const publicationDate = this.extractElement(xml, 'publication-date');
    const grantDate = this.extractElement(xml, 'grant-date') ||
                      this.extractElement(xml, 'date-of-grant');
    const oppositionDeadline = this.extractElement(xml, 'opposition-deadline');

    // Extract designated states
    const designatedStates = this.extractAllElements(xml, 'designated-state')
      .concat(this.extractAllElements(xml, 'country-code'));

    // Extract classifications
    const classifications = this.parseClassifications(xml);

    // Extract priorities
    const priorities = this.parsePriorities(xml);

    // Extract events/procedural steps
    const events = this.parseEvents(xml);

    // Extract documents
    const documents = this.parseDocuments(xml);

    const data: RegisterData = {
      applicationNumber,
      publicationNumber,
      status,
      procedureType,
      title,
      filingDate,
      publicationDate,
      grantDate,
      oppositionDeadline,
    };

    if (applicants.length > 0) data.applicants = applicants;
    if (inventors.length > 0) data.inventors = inventors;
    if (representatives.length > 0) data.representatives = representatives;
    if (designatedStates.length > 0) data.designatedStates = designatedStates;
    if (classifications.length > 0) data.classifications = classifications;
    if (priorities.length > 0) data.priorities = priorities;
    if (events.length > 0) data.events = events;
    if (documents.length > 0) data.documents = documents;

    return {
      success: true,
      data,
    };
  }

  private parseApplicants(xml: string): Applicant[] {
    const applicants: Applicant[] = [];
    const applicantRegex = /<applicant[^>]*>([\s\S]*?)<\/applicant>/gi;
    let match;
    let sequence = 0;

    while ((match = applicantRegex.exec(xml)) !== null) {
      sequence++;
      const appXml = match[1];
      const name = this.extractElement(appXml, 'name') ||
                   this.extractElement(appXml, 'applicant-name');
      const country = this.extractElement(appXml, 'country') ||
                      this.extractElement(appXml, 'residence');

      if (name) {
        applicants.push({ name, country, sequence });
      }
    }

    return applicants;
  }

  private parseInventors(xml: string): Inventor[] {
    const inventors: Inventor[] = [];
    const inventorRegex = /<inventor[^>]*>([\s\S]*?)<\/inventor>/gi;
    let match;
    let sequence = 0;

    while ((match = inventorRegex.exec(xml)) !== null) {
      sequence++;
      const invXml = match[1];
      const name = this.extractElement(invXml, 'name') ||
                   this.extractElement(invXml, 'inventor-name');
      const country = this.extractElement(invXml, 'country') ||
                      this.extractElement(invXml, 'residence');

      if (name) {
        inventors.push({ name, country, sequence });
      }
    }

    return inventors;
  }

  private parseRepresentatives(xml: string): Representative[] {
    const representatives: Representative[] = [];
    const repRegex = /<representative[^>]*>([\s\S]*?)<\/representative>/gi;
    let match;

    while ((match = repRegex.exec(xml)) !== null) {
      const repXml = match[1];
      const name = this.extractElement(repXml, 'name') ||
                   this.extractElement(repXml, 'representative-name');
      const address = this.extractElement(repXml, 'address');
      const country = this.extractElement(repXml, 'country');

      if (name) {
        representatives.push({ name, address, country });
      }
    }

    return representatives;
  }

  private parseClassifications(xml: string): Classification[] {
    const classifications: Classification[] = [];

    // IPC classifications
    const ipcRegex = /<classification-ipc[^>]*>([\s\S]*?)<\/classification-ipc>/gi;
    let match;

    while ((match = ipcRegex.exec(xml)) !== null) {
      const classXml = match[1];
      const symbol = this.extractElement(classXml, 'text') ||
                     this.extractElement(classXml, 'classification-symbol') ||
                     classXml.replace(/<[^>]+>/g, '').trim();

      if (symbol) {
        classifications.push({ scheme: 'IPC', symbol });
      }
    }

    // CPC classifications
    const cpcRegex = /<classification-cpc[^>]*>([\s\S]*?)<\/classification-cpc>/gi;

    while ((match = cpcRegex.exec(xml)) !== null) {
      const classXml = match[1];
      const symbol = this.extractElement(classXml, 'text') ||
                     this.extractElement(classXml, 'classification-symbol') ||
                     classXml.replace(/<[^>]+>/g, '').trim();

      if (symbol) {
        classifications.push({ scheme: 'CPC', symbol });
      }
    }

    return classifications;
  }

  private parsePriorities(xml: string): PriorityData[] {
    const priorities: PriorityData[] = [];
    const priorityRegex = /<priority-claim[^>]*>([\s\S]*?)<\/priority-claim>/gi;
    let match;

    while ((match = priorityRegex.exec(xml)) !== null) {
      const priXml = match[1];
      const country = this.extractElement(priXml, 'country');
      const docNumber = this.extractElement(priXml, 'doc-number');
      const date = this.extractElement(priXml, 'date');
      const kind = this.extractElement(priXml, 'kind');

      if (country && docNumber && date) {
        priorities.push({ country, docNumber, date, kind });
      }
    }

    return priorities;
  }

  private parseEvents(xml: string): RegisterEvent[] {
    const events: RegisterEvent[] = [];
    const eventRegex = /<procedural-step[^>]*>([\s\S]*?)<\/procedural-step>/gi;
    let match;

    while ((match = eventRegex.exec(xml)) !== null) {
      const eventXml = match[1];
      const date = this.extractElement(eventXml, 'date') ||
                   this.extractElement(eventXml, 'procedural-step-date');
      const code = this.extractElement(eventXml, 'code') ||
                   this.extractElement(eventXml, 'procedural-step-code');
      const description = this.extractElement(eventXml, 'text') ||
                          this.extractElement(eventXml, 'procedural-step-text');
      const details = this.extractElement(eventXml, 'details');

      if (date) {
        events.push({ date, code, description, details });
      }
    }

    return events;
  }

  private parseDocuments(xml: string): RegisterDocument[] {
    const documents: RegisterDocument[] = [];
    const docRegex = /<document-available[^>]*>([\s\S]*?)<\/document-available>/gi;
    let match;

    while ((match = docRegex.exec(xml)) !== null) {
      const docXml = match[1];
      const type = this.extractElement(docXml, 'document-type') ||
                   this.extractElement(docXml, 'type');
      const date = this.extractElement(docXml, 'date') ||
                   this.extractElement(docXml, 'document-date');
      const format = this.extractElement(docXml, 'format');
      const pagesStr = this.extractElement(docXml, 'pages') ||
                       this.extractElement(docXml, 'number-of-pages');
      const pages = pagesStr ? parseInt(pagesStr) : undefined;

      if (type && date) {
        documents.push({ type, date, format, pages });
      }
    }

    return documents;
  }

  private extractElement(xml: string, tag: string): string | undefined {
    // Try with exact tag
    let match = xml.match(new RegExp(`<${tag}[^>]*>([^<]*)</${tag}>`, 'i'));
    if (match) return match[1].trim();

    // Try with reg: prefix (common in register responses)
    match = xml.match(new RegExp(`<reg:${tag}[^>]*>([^<]*)</reg:${tag}>`, 'i'));
    if (match) return match[1].trim();

    // Try with ops: prefix
    match = xml.match(new RegExp(`<ops:${tag}[^>]*>([^<]*)</ops:${tag}>`, 'i'));
    if (match) return match[1].trim();

    return undefined;
  }

  private extractAllElements(xml: string, tag: string): string[] {
    const results: string[] = [];
    const regex = new RegExp(`<${tag}[^>]*>([^<]*)</${tag}>`, 'gi');
    let match;

    while ((match = regex.exec(xml)) !== null) {
      const text = match[1].trim();
      if (text) results.push(text);
    }

    return results;
  }
}
