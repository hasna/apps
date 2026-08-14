import type { ArxivPaper, SearchResult, SearchOptions } from '../types';
import { ArxivApiError } from '../types';

const BASE_URL = 'http://export.arxiv.org/api/query';

export class ArxivClient {
  /**
   * Execute a search query against the arXiv API
   */
  async search(options: SearchOptions): Promise<SearchResult> {
    const params = new URLSearchParams();

    // Build search query
    let searchQuery = options.query;
    if (options.category) {
      searchQuery = `cat:${options.category} AND ${searchQuery}`;
    }
    params.set('search_query', searchQuery);
    params.set('start', String(options.start || 0));
    params.set('max_results', String(options.maxResults || 10));

    if (options.sortBy) {
      params.set('sortBy', options.sortBy);
    }
    if (options.sortOrder) {
      params.set('sortOrder', options.sortOrder);
    }

    const url = `${BASE_URL}?${params.toString()}`;
    const response = await fetch(url);

    if (!response.ok) {
      throw new ArxivApiError(`arXiv API error: ${response.statusText}`, response.status);
    }

    const xml = await response.text();
    return this.parseSearchResult(xml);
  }

  /**
   * Get a paper by its arXiv ID
   */
  async get(arxivId: string): Promise<ArxivPaper> {
    // Normalize ID (remove version suffix for query, keep for display)
    const cleanId = arxivId.replace(/^arxiv:/i, '');
    const params = new URLSearchParams({
      id_list: cleanId,
      max_results: '1',
    });

    const url = `${BASE_URL}?${params.toString()}`;
    const response = await fetch(url);

    if (!response.ok) {
      throw new ArxivApiError(`arXiv API error: ${response.statusText}`, response.status);
    }

    const xml = await response.text();
    const result = this.parseSearchResult(xml);

    if (result.papers.length === 0) {
      throw new ArxivApiError(`Paper not found: ${arxivId}`);
    }

    return result.papers[0];
  }

  /**
   * List recent papers in a category
   */
  async listRecent(category: string, options?: { maxResults?: number; start?: number }): Promise<SearchResult> {
    return this.search({
      query: `cat:${category}`,
      maxResults: options?.maxResults || 20,
      start: options?.start || 0,
      sortBy: 'submittedDate',
      sortOrder: 'descending',
    });
  }

  /**
   * Search papers by author name
   */
  async searchAuthors(authorName: string, options?: { maxResults?: number; start?: number }): Promise<SearchResult> {
    return this.search({
      query: `au:"${authorName}"`,
      maxResults: options?.maxResults || 10,
      start: options?.start || 0,
      sortBy: 'submittedDate',
      sortOrder: 'descending',
    });
  }

  /**
   * Download paper PDF to local path
   */
  async downloadPdf(arxivId: string, outputPath: string): Promise<string> {
    const cleanId = arxivId.replace(/^arxiv:/i, '');
    const pdfUrl = `https://arxiv.org/pdf/${cleanId}.pdf`;

    const response = await fetch(pdfUrl);
    if (!response.ok) {
      throw new ArxivApiError(`Failed to download PDF: ${response.statusText}`, response.status);
    }

    const buffer = await response.arrayBuffer();
    const { writeFileSync } = await import('fs');
    writeFileSync(outputPath, Buffer.from(buffer));

    return outputPath;
  }

  /**
   * Parse Atom XML response into SearchResult
   */
  private parseSearchResult(xml: string): SearchResult {
    const totalResults = parseInt(this.extractTag(xml, 'opensearch:totalResults') || '0', 10);
    const startIndex = parseInt(this.extractTag(xml, 'opensearch:startIndex') || '0', 10);
    const itemsPerPage = parseInt(this.extractTag(xml, 'opensearch:itemsPerPage') || '0', 10);

    const papers: ArxivPaper[] = [];
    const entries = xml.split('<entry>').slice(1);

    for (const entry of entries) {
      const entryXml = entry.split('</entry>')[0];
      const paper = this.parseEntry(entryXml);
      if (paper) {
        papers.push(paper);
      }
    }

    return { papers, totalResults, startIndex, itemsPerPage };
  }

  /**
   * Parse a single Atom entry into an ArxivPaper
   */
  private parseEntry(xml: string): ArxivPaper | null {
    const fullId = this.extractTag(xml, 'id') || '';
    // Extract arXiv ID from URL: http://arxiv.org/abs/2301.12345v1
    const idMatch = fullId.match(/arxiv\.org\/abs\/(.+)/);
    if (!idMatch) return null;

    const id = idMatch[1].replace(/v\d+$/, ''); // Remove version suffix

    const title = (this.extractTag(xml, 'title') || '').replace(/\s+/g, ' ').trim();
    const abstract = (this.extractTag(xml, 'summary') || '').replace(/\s+/g, ' ').trim();
    const published = this.extractTag(xml, 'published') || '';
    const updated = this.extractTag(xml, 'updated') || '';
    const doi = this.extractTag(xml, 'arxiv:doi') || undefined;
    const journalRef = this.extractTag(xml, 'arxiv:journal_ref') || undefined;
    const comment = this.extractTag(xml, 'arxiv:comment') || undefined;

    // Extract authors
    const authors: string[] = [];
    const authorMatches = xml.matchAll(/<author>\s*<name>([^<]+)<\/name>/g);
    for (const match of authorMatches) {
      authors.push(match[1].trim());
    }

    // Extract categories
    const categories: string[] = [];
    const catMatches = xml.matchAll(/category[^>]*term="([^"]+)"/g);
    for (const match of catMatches) {
      categories.push(match[1]);
    }

    // Extract primary category
    const primaryCatMatch = xml.match(/arxiv:primary_category[^>]*term="([^"]+)"/);
    const primaryCategory = primaryCatMatch ? primaryCatMatch[1] : categories[0] || '';

    // Extract PDF link
    const pdfMatch = xml.match(/<link[^>]*title="pdf"[^>]*href="([^"]+)"/);
    const pdfUrl = pdfMatch ? pdfMatch[1] : `https://arxiv.org/pdf/${id}.pdf`;

    const absUrl = `https://arxiv.org/abs/${id}`;

    return {
      id,
      title,
      authors,
      abstract,
      categories,
      primaryCategory,
      published,
      updated,
      pdfUrl,
      absUrl,
      doi,
      journalRef,
      comment,
    };
  }

  /**
   * Extract text content of an XML tag
   */
  private extractTag(xml: string, tag: string): string | null {
    const escapedTag = tag.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const match = xml.match(new RegExp(`<${escapedTag}[^>]*>([\\s\\S]*?)<\\/${escapedTag}>`));
    return match ? match[1].trim() : null;
  }
}
