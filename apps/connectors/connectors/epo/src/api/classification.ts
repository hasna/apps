import type { EPOClient } from './client';
import type {
  CPCClassificationResponse,
  CPCNode,
} from '../types';

/**
 * Classification API - Access CPC classification data
 */
export class ClassificationApi {
  constructor(private readonly client: EPOClient) {}

  /**
   * Get CPC classification hierarchy
   * @param symbol - CPC symbol to look up (e.g., "H01L", "A01B1/00")
   */
  async getCPC(symbol: string): Promise<CPCClassificationResponse> {
    try {
      const path = `/classification/cpc/${encodeURIComponent(symbol)}`;
      const xml = await this.client.get<string>(path, undefined, 'application/xml');
      return this.parseCPCResponse(xml);
    } catch (error) {
      return {
        success: false,
        error: String(error),
      };
    }
  }

  /**
   * Get CPC classification with children
   * @param symbol - CPC symbol to look up
   */
  async getCPCWithChildren(symbol: string): Promise<CPCClassificationResponse> {
    try {
      const path = `/classification/cpc/${encodeURIComponent(symbol)}`;
      const xml = await this.client.get<string>(
        path,
        { children: 'true' },
        'application/xml'
      );
      return this.parseCPCResponse(xml);
    } catch (error) {
      return {
        success: false,
        error: String(error),
      };
    }
  }

  /**
   * Get CPC classification with ancestors
   * @param symbol - CPC symbol to look up
   */
  async getCPCWithAncestors(symbol: string): Promise<CPCClassificationResponse> {
    try {
      const path = `/classification/cpc/${encodeURIComponent(symbol)}`;
      const xml = await this.client.get<string>(
        path,
        { ancestors: 'true' },
        'application/xml'
      );
      return this.parseCPCResponse(xml);
    } catch (error) {
      return {
        success: false,
        error: String(error),
      };
    }
  }

  /**
   * Search CPC classifications by keyword
   * @param query - Search query
   */
  async searchCPC(query: string): Promise<CPCClassificationResponse> {
    try {
      const path = `/classification/cpc`;
      const xml = await this.client.get<string>(
        path,
        { q: query },
        'application/xml'
      );
      return this.parseCPCResponse(xml);
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

  private parseCPCResponse(xml: string): CPCClassificationResponse {
    const nodes: CPCNode[] = [];

    // Extract classification items
    const itemRegex = /<class-item[^>]*level="(\d+)"[^>]*>([\s\S]*?)<\/class-item>/gi;
    let match;

    while ((match = itemRegex.exec(xml)) !== null) {
      const level = parseInt(match[1]);
      const itemXml = match[2];

      const symbol = this.extractElement(itemXml, 'classification-symbol') ||
                     this.extractElement(itemXml, 'symbol');
      const title = this.extractElement(itemXml, 'class-title') ||
                    this.extractElement(itemXml, 'title-part');
      const definition = this.extractElement(itemXml, 'definition-text') ||
                         this.extractElement(itemXml, 'note');

      // Extract references
      const references = this.extractAllElements(itemXml, 'class-ref')
        .concat(this.extractAllElements(itemXml, 'reference'));

      if (symbol) {
        const node: CPCNode = {
          symbol,
          level,
          title,
          definition,
        };

        if (references.length > 0) {
          node.references = references;
        }

        nodes.push(node);
      }
    }

    // If no class-item elements, try alternative format
    if (nodes.length === 0) {
      const altRegex = /<cpc-class[^>]*>([\s\S]*?)<\/cpc-class>/gi;

      while ((match = altRegex.exec(xml)) !== null) {
        const itemXml = match[1];

        const symbol = this.extractElement(itemXml, 'symbol') ||
                       this.extractElement(itemXml, 'classification-symbol');
        const title = this.extractElement(itemXml, 'title') ||
                      this.extractElement(itemXml, 'class-title');
        const definition = this.extractElement(itemXml, 'definition');

        if (symbol) {
          nodes.push({
            symbol,
            level: this.inferLevel(symbol),
            title,
            definition,
          });
        }
      }
    }

    // Try simple classification-item format
    if (nodes.length === 0) {
      const simpleRegex = /<classification-item[^>]*>([\s\S]*?)<\/classification-item>/gi;

      while ((match = simpleRegex.exec(xml)) !== null) {
        const itemXml = match[1];

        const symbol = this.extractElement(itemXml, 'classification-symbol') ||
                       itemXml.match(/<classification-symbol>([^<]+)/)?.[1];
        const title = this.extractElement(itemXml, 'title-part') ||
                      this.extractElement(itemXml, 'text');

        if (symbol) {
          nodes.push({
            symbol: symbol.trim(),
            level: this.inferLevel(symbol.trim()),
            title,
          });
        }
      }
    }

    return {
      success: true,
      data: nodes,
    };
  }

  private extractElement(xml: string, tag: string): string | undefined {
    const match = xml.match(new RegExp(`<${tag}[^>]*>([^<]+)</${tag}>`, 'i'));
    return match ? match[1].trim() : undefined;
  }

  private extractAllElements(xml: string, tag: string): string[] {
    const results: string[] = [];
    const regex = new RegExp(`<${tag}[^>]*>([^<]+)</${tag}>`, 'gi');
    let match;

    while ((match = regex.exec(xml)) !== null) {
      const text = match[1].trim();
      if (text) results.push(text);
    }

    return results;
  }

  /**
   * Infer the level of a CPC symbol based on its structure
   */
  private inferLevel(symbol: string): number {
    // Section (e.g., "A")
    if (/^[A-H]$/.test(symbol)) return 1;

    // Class (e.g., "A01")
    if (/^[A-H]\d{2}$/.test(symbol)) return 2;

    // Subclass (e.g., "A01B")
    if (/^[A-H]\d{2}[A-Z]$/.test(symbol)) return 3;

    // Main group (e.g., "A01B1/00")
    if (/^[A-H]\d{2}[A-Z]\d+\/00$/.test(symbol)) return 4;

    // Subgroup (e.g., "A01B1/02")
    if (/^[A-H]\d{2}[A-Z]\d+\/\d+$/.test(symbol)) return 5;

    return 0;
  }
}
