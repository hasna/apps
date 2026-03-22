import { ArxivClient } from './client';

export class Arxiv {
  public readonly client: ArxivClient;

  constructor() {
    this.client = new ArxivClient();
  }

  /**
   * Search papers by query
   */
  get search() {
    return this.client.search.bind(this.client);
  }

  /**
   * Get paper by ID
   */
  get get() {
    return this.client.get.bind(this.client);
  }

  /**
   * List recent papers in a category
   */
  get listRecent() {
    return this.client.listRecent.bind(this.client);
  }

  /**
   * Search papers by author
   */
  get searchAuthors() {
    return this.client.searchAuthors.bind(this.client);
  }

  /**
   * Download paper PDF
   */
  get downloadPdf() {
    return this.client.downloadPdf.bind(this.client);
  }
}

export { ArxivClient } from './client';
export { Arxiv as Connector };
