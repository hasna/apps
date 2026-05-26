import { readFileSync } from 'fs';
import { basename } from 'path';
import { getApiKey } from '../utils/config';
import type {
  ParseOptions,
  ParseResult,
  ExtractOptions,
  ExtractResult,
  SplitOptions,
  SplitResult,
  EditOptions,
  EditResult,
  JobStatus,
  Document,
  ReductoError,
  AuthenticationError,
} from '../types';

const API_BASE = 'https://api.reducto.ai/v1';

export class ReductoClient {
  private apiKey?: string;

  constructor(apiKey?: string) {
    this.apiKey = apiKey;
  }

  private getValidApiKey(): string {
    const key = this.apiKey || getApiKey();
    if (!key) {
      throw {
        name: 'AuthenticationError',
        message: 'Not authenticated. Run "connect-reducto auth setup" first.',
      } as AuthenticationError;
    }
    return key;
  }

  private async request<T>(
    method: string,
    path: string,
    body?: unknown,
    isFormData?: boolean
  ): Promise<T> {
    const apiKey = this.getValidApiKey();
    const url = `${API_BASE}${path}`;

    const headers: Record<string, string> = {
      'Authorization': `Bearer ${apiKey}`,
    };

    if (!isFormData) {
      headers['Content-Type'] = 'application/json';
    }

    const response = await fetch(url, {
      method,
      headers,
      body: isFormData ? (body as BodyInit) : body ? JSON.stringify(body) : undefined,
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      const message = error.message || error.error || response.statusText;
      throw {
        name: 'ReductoError',
        message,
        statusCode: response.status,
        details: error,
      } as ReductoError;
    }

    if (response.status === 204) {
      return {} as T;
    }

    return response.json();
  }

  private async uploadFile(
    endpoint: string,
    filePath: string,
    options?: Record<string, unknown>
  ): Promise<unknown> {
    const apiKey = this.getValidApiKey();
    const url = `${API_BASE}${endpoint}`;

    const fileContent = readFileSync(filePath);
    const fileName = basename(filePath);

    // Create form data manually for Bun compatibility
    const boundary = `----FormBoundary${Date.now()}`;
    const parts: string[] = [];

    // Add file part
    parts.push(`--${boundary}`);
    parts.push(`Content-Disposition: form-data; name="file"; filename="${fileName}"`);
    parts.push('Content-Type: application/octet-stream');
    parts.push('');

    // Add options as separate form fields
    if (options) {
      for (const [key, value] of Object.entries(options)) {
        if (value !== undefined) {
          parts.push(`--${boundary}`);
          parts.push(`Content-Disposition: form-data; name="${key}"`);
          parts.push('');
          parts.push(typeof value === 'object' ? JSON.stringify(value) : String(value));
        }
      }
    }

    parts.push(`--${boundary}--`);

    // Build multipart body
    const textEncoder = new TextEncoder();
    const textParts = parts.join('\r\n');
    const textBytes = textEncoder.encode(textParts.split('\r\n\r\n')[0] + '\r\n\r\n');
    const afterFileParts = textParts.split('\r\n\r\n').slice(1).join('\r\n\r\n');
    const afterFileBytes = textEncoder.encode('\r\n' + afterFileParts);

    const body = new Uint8Array(textBytes.length + fileContent.length + afterFileBytes.length);
    body.set(textBytes, 0);
    body.set(fileContent, textBytes.length);
    body.set(afterFileBytes, textBytes.length + fileContent.length);

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': `multipart/form-data; boundary=${boundary}`,
      },
      body,
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      throw {
        name: 'ReductoError',
        message: error.message || response.statusText,
        statusCode: response.status,
        details: error,
      } as ReductoError;
    }

    return response.json();
  }

  // ============================================
  // Parse API
  // ============================================

  /**
   * Parse a document from URL
   */
  async parseUrl(documentUrl: string, options?: ParseOptions): Promise<ParseResult> {
    return this.request<ParseResult>('POST', '/parse', {
      document_url: documentUrl,
      ...this.formatParseOptions(options),
    });
  }

  /**
   * Parse a document from file
   */
  async parseFile(filePath: string, options?: ParseOptions): Promise<ParseResult> {
    return this.uploadFile('/parse', filePath, this.formatParseOptions(options)) as Promise<ParseResult>;
  }

  private formatParseOptions(options?: ParseOptions): Record<string, unknown> {
    if (!options) return {};
    return {
      chunking_strategy: options.chunkingStrategy,
      output_mode: options.outputMode,
      extract_tables: options.extractTables,
      extract_images: options.extractImages,
      ocr_languages: options.ocrLanguages,
      page_range: options.pageRange,
      webhook: options.webhook,
      priority: options.priority,
    };
  }

  // ============================================
  // Extract API
  // ============================================

  /**
   * Extract structured data from document URL
   */
  async extractUrl(documentUrl: string, options: ExtractOptions): Promise<ExtractResult> {
    return this.request<ExtractResult>('POST', '/extract', {
      document_url: documentUrl,
      schema: this.formatSchema(options.schema),
      examples: options.examples,
      webhook: options.webhook,
      priority: options.priority,
    });
  }

  /**
   * Extract structured data from file
   */
  async extractFile(filePath: string, options: ExtractOptions): Promise<ExtractResult> {
    return this.uploadFile('/extract', filePath, {
      schema: JSON.stringify(this.formatSchema(options.schema)),
      examples: options.examples ? JSON.stringify(options.examples) : undefined,
      webhook: options.webhook,
      priority: options.priority,
    }) as Promise<ExtractResult>;
  }

  private formatSchema(schema: ExtractOptions['schema']): Record<string, unknown> {
    return {
      fields: schema.fields.map(field => ({
        name: field.name,
        description: field.description,
        type: field.type,
        required: field.required,
        array_of: field.arrayOf ? this.formatFieldDefinition(field.arrayOf) : undefined,
        properties: field.properties?.map(p => this.formatFieldDefinition(p)),
      })),
    };
  }

  private formatFieldDefinition(field: ExtractOptions['schema']['fields'][0]): Record<string, unknown> {
    return {
      name: field.name,
      description: field.description,
      type: field.type,
      required: field.required,
    };
  }

  // ============================================
  // Split API
  // ============================================

  /**
   * Split a document from URL
   */
  async splitUrl(documentUrl: string, options?: SplitOptions): Promise<SplitResult> {
    return this.request<SplitResult>('POST', '/split', {
      document_url: documentUrl,
      split_by: options?.splitBy,
      custom_delimiter: options?.customDelimiter,
      max_chunk_size: options?.maxChunkSize,
      overlap: options?.overlap,
      webhook: options?.webhook,
    });
  }

  /**
   * Split a document from file
   */
  async splitFile(filePath: string, options?: SplitOptions): Promise<SplitResult> {
    return this.uploadFile('/split', filePath, {
      split_by: options?.splitBy,
      custom_delimiter: options?.customDelimiter,
      max_chunk_size: options?.maxChunkSize,
      overlap: options?.overlap,
      webhook: options?.webhook,
    }) as Promise<SplitResult>;
  }

  // ============================================
  // Edit API
  // ============================================

  /**
   * Edit a document from URL
   */
  async editUrl(documentUrl: string, options: EditOptions): Promise<EditResult> {
    return this.request<EditResult>('POST', '/edit', {
      document_url: documentUrl,
      edits: options.edits.map(e => ({
        field_name: e.fieldName,
        value: e.value,
        operation: e.operation,
      })),
      output_format: options.outputFormat,
      flatten: options.flatten,
      webhook: options.webhook,
    });
  }

  /**
   * Edit a document from file
   */
  async editFile(filePath: string, options: EditOptions): Promise<EditResult> {
    return this.uploadFile('/edit', filePath, {
      edits: JSON.stringify(options.edits.map(e => ({
        field_name: e.fieldName,
        value: e.value,
        operation: e.operation,
      }))),
      output_format: options.outputFormat,
      flatten: options.flatten,
      webhook: options.webhook,
    }) as Promise<EditResult>;
  }

  // ============================================
  // Job Status API
  // ============================================

  /**
   * Get job status
   */
  async getJobStatus(jobId: string): Promise<JobStatus> {
    return this.request<JobStatus>('GET', `/jobs/${jobId}`);
  }

  /**
   * Cancel a job
   */
  async cancelJob(jobId: string): Promise<void> {
    await this.request<void>('DELETE', `/jobs/${jobId}`);
  }

  /**
   * List recent jobs
   */
  async listJobs(limit?: number, offset?: number): Promise<JobStatus[]> {
    const params = new URLSearchParams();
    if (limit) params.append('limit', String(limit));
    if (offset) params.append('offset', String(offset));
    const query = params.toString();
    return this.request<JobStatus[]>('GET', `/jobs${query ? `?${query}` : ''}`);
  }

  // ============================================
  // Document API
  // ============================================

  /**
   * Get document by ID
   */
  async getDocument(documentId: string): Promise<Document> {
    return this.request<Document>('GET', `/documents/${documentId}`);
  }

  /**
   * Delete document
   */
  async deleteDocument(documentId: string): Promise<void> {
    await this.request<void>('DELETE', `/documents/${documentId}`);
  }

  /**
   * List documents
   */
  async listDocuments(limit?: number, offset?: number): Promise<Document[]> {
    const params = new URLSearchParams();
    if (limit) params.append('limit', String(limit));
    if (offset) params.append('offset', String(offset));
    const query = params.toString();
    return this.request<Document[]>('GET', `/documents${query ? `?${query}` : ''}`);
  }
}

export { getApiKey };
