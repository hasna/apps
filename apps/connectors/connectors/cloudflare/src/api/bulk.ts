import type { CloudflareClient } from './client';
import type { DNSRecord, CreateDNSRecordParams, DNSRecordType, FirewallRule, CreateFirewallRuleParams } from '../types';
import { DNSApi } from './dns';
import { FirewallApi } from './firewall';
import { WorkersApi } from './workers';

// ============================================
// Filter Parser for DNS Records
// ============================================

export interface DNSFilter {
  type?: DNSRecordType | DNSRecordType[];
  name?: string;  // Supports wildcards: *.example.com, mail.*
  content?: string;
  proxied?: boolean;
  ttl?: number;
  comment?: string;
}

export interface ParsedFilter {
  field: string;
  operator: 'eq' | 'neq' | 'contains' | 'startswith' | 'endswith' | 'regex' | 'glob';
  value: string | number | boolean;
}

/**
 * FilterParser for DNS records
 * Supports filter expressions like:
 * - "type=A" - exact match
 * - "name=*.example.com" - glob pattern
 * - "content~192.168" - contains
 * - "proxied=true" - boolean
 * - "type=A,AAAA" - multiple values (OR)
 */
export class FilterParser {
  /**
   * Parse a filter string into structured filters
   * @example "type=A" -> { type: 'A' }
   * @example "type=A,AAAA" -> { type: ['A', 'AAAA'] }
   * @example "name=*.example.com" -> matches subdomains
   */
  static parse(filterString: string): DNSFilter {
    const filter: DNSFilter = {};

    if (!filterString || filterString.trim() === '') {
      return filter;
    }

    // Split by spaces or ampersands for multiple conditions
    const conditions = filterString.split(/\s+(?:and\s+)?|&/i).filter(Boolean);

    for (const condition of conditions) {
      const match = condition.match(/^(\w+)(=|!=|~|!~)(.+)$/);
      if (!match) continue;

      const [, field, operator, value] = match;

      switch (field?.toLowerCase()) {
        case 'type':
          if (value?.includes(',')) {
            filter.type = value.split(',').map(v => v.trim().toUpperCase()) as DNSRecordType[];
          } else {
            filter.type = value?.toUpperCase() as DNSRecordType;
          }
          break;
        case 'name':
          filter.name = value;
          break;
        case 'content':
          filter.content = value;
          break;
        case 'proxied':
          filter.proxied = value?.toLowerCase() === 'true';
          break;
        case 'ttl':
          filter.ttl = parseInt(value || '0', 10);
          break;
        case 'comment':
          filter.comment = value;
          break;
      }
    }

    return filter;
  }

  /**
   * Test if a DNS record matches the filter
   */
  static matches(record: DNSRecord, filter: DNSFilter): boolean {
    // Type filter
    if (filter.type) {
      const types = Array.isArray(filter.type) ? filter.type : [filter.type];
      if (!types.includes(record.type)) {
        return false;
      }
    }

    // Name filter (supports glob patterns)
    if (filter.name) {
      if (!this.matchGlob(record.name, filter.name)) {
        return false;
      }
    }

    // Content filter (supports contains)
    if (filter.content) {
      if (!record.content.includes(filter.content)) {
        return false;
      }
    }

    // Proxied filter
    if (filter.proxied !== undefined) {
      if (record.proxied !== filter.proxied) {
        return false;
      }
    }

    // TTL filter
    if (filter.ttl !== undefined) {
      if (record.ttl !== filter.ttl) {
        return false;
      }
    }

    // Comment filter
    if (filter.comment) {
      if (!record.comment?.includes(filter.comment)) {
        return false;
      }
    }

    return true;
  }

  /**
   * Match a string against a glob pattern
   * Supports: * (any chars), ? (single char)
   */
  static matchGlob(str: string, pattern: string): boolean {
    // Convert glob to regex
    const regex = pattern
      .replace(/[.+^${}()|[\]\\]/g, '\\$&')  // Escape special regex chars except * and ?
      .replace(/\*/g, '.*')
      .replace(/\?/g, '.');

    return new RegExp(`^${regex}$`, 'i').test(str);
  }
}

// ============================================
// Bulk Operation Types
// ============================================

export interface BulkOperationOptions {
  /** Maximum concurrent operations (default: 5) */
  concurrency?: number;
  /** Dry run - don't actually make changes */
  dryRun?: boolean;
  /** Progress callback */
  onProgress?: (progress: BulkProgress) => void;
  /** Continue on error (default: false) */
  continueOnError?: boolean;
  /** Delay between operations in ms (rate limiting) */
  delayMs?: number;
}

export interface BulkProgress {
  total: number;
  completed: number;
  succeeded: number;
  failed: number;
  current?: string;
  errors: BulkError[];
}

export interface BulkError {
  item: string;
  error: string;
}

export interface BulkResult<T> {
  success: boolean;
  total: number;
  succeeded: number;
  failed: number;
  results: T[];
  errors: BulkError[];
  dryRun: boolean;
}

export interface DNSImportRecord {
  type: DNSRecordType;
  name: string;
  content: string;
  ttl?: number;
  priority?: number;
  proxied?: boolean;
  comment?: string;
}

export interface DNSExportOptions {
  format: 'json' | 'csv' | 'bind';
  filter?: DNSFilter;
  includeIds?: boolean;
}

// ============================================
// Bulk API Class
// ============================================

export class BulkApi {
  private dns: DNSApi;
  private firewall: FirewallApi;
  private workers: WorkersApi;

  constructor(private client: CloudflareClient) {
    this.dns = new DNSApi(client);
    this.firewall = new FirewallApi(client);
    this.workers = new WorkersApi(client);
  }

  // ============================================
  // Bulk DNS Operations
  // ============================================

  /**
   * Get all DNS records for a zone (handles pagination)
   */
  async getAllDNSRecords(zoneId: string, filter?: DNSFilter): Promise<DNSRecord[]> {
    const allRecords: DNSRecord[] = [];
    let page = 1;
    const perPage = 100;
    let hasMore = true;

    while (hasMore) {
      const response = await this.dns.list(zoneId, { page, per_page: perPage });
      const records = response.result || [];

      // Apply filter if provided
      const filtered = filter
        ? records.filter(r => FilterParser.matches(r, filter))
        : records;

      allRecords.push(...filtered);

      // Check if there are more pages
      const resultInfo = response.result_info;
      if (resultInfo && resultInfo.page < resultInfo.total_pages) {
        page++;
      } else {
        hasMore = false;
      }
    }

    return allRecords;
  }

  /**
   * Preview records that match a filter (for dry-run/preview)
   */
  async previewDNSRecords(zoneId: string, filter: DNSFilter): Promise<DNSRecord[]> {
    return this.getAllDNSRecords(zoneId, filter);
  }

  /**
   * Bulk create DNS records
   */
  async bulkCreateDNS(
    zoneId: string,
    records: DNSImportRecord[],
    options: BulkOperationOptions = {}
  ): Promise<BulkResult<DNSRecord>> {
    const {
      concurrency = 5,
      dryRun = false,
      onProgress,
      continueOnError = false,
      delayMs = 0,
    } = options;

    const results: DNSRecord[] = [];
    const errors: BulkError[] = [];
    let completed = 0;
    let succeeded = 0;
    let failed = 0;

    const reportProgress = () => {
      onProgress?.({
        total: records.length,
        completed,
        succeeded,
        failed,
        errors,
      });
    };

    // Process in batches for concurrency control
    for (let i = 0; i < records.length; i += concurrency) {
      const batch = records.slice(i, i + concurrency);

      const batchPromises = batch.map(async (record) => {
        try {
          if (dryRun) {
            // Simulate success for dry run
            results.push({
              id: 'dry-run-id',
              zone_id: zoneId,
              zone_name: '',
              name: record.name,
              type: record.type,
              content: record.content,
              proxiable: true,
              proxied: record.proxied ?? false,
              ttl: record.ttl ?? 1,
              locked: false,
              created_on: new Date().toISOString(),
              modified_on: new Date().toISOString(),
            });
            succeeded++;
          } else {
            const result = await this.dns.create(zoneId, {
              type: record.type,
              name: record.name,
              content: record.content,
              ttl: record.ttl,
              priority: record.priority,
              proxied: record.proxied,
              comment: record.comment,
            });
            results.push(result);
            succeeded++;
          }
        } catch (err) {
          failed++;
          errors.push({
            item: `${record.type} ${record.name} -> ${record.content}`,
            error: err instanceof Error ? err.message : String(err),
          });
          if (!continueOnError) {
            throw err;
          }
        } finally {
          completed++;
          reportProgress();
        }
      });

      try {
        await Promise.all(batchPromises);
      } catch {
        if (!continueOnError) break;
      }

      // Rate limiting delay between batches
      if (delayMs > 0 && i + concurrency < records.length) {
        await this.delay(delayMs);
      }
    }

    return {
      success: failed === 0,
      total: records.length,
      succeeded,
      failed,
      results,
      errors,
      dryRun,
    };
  }

  /**
   * Bulk update DNS records matching a filter
   */
  async bulkUpdateDNS(
    zoneId: string,
    filter: DNSFilter,
    updates: Partial<CreateDNSRecordParams>,
    options: BulkOperationOptions = {}
  ): Promise<BulkResult<DNSRecord>> {
    const {
      concurrency = 5,
      dryRun = false,
      onProgress,
      continueOnError = false,
      delayMs = 0,
    } = options;

    // First, get all matching records
    const matchingRecords = await this.getAllDNSRecords(zoneId, filter);

    const results: DNSRecord[] = [];
    const errors: BulkError[] = [];
    let completed = 0;
    let succeeded = 0;
    let failed = 0;

    const reportProgress = () => {
      onProgress?.({
        total: matchingRecords.length,
        completed,
        succeeded,
        failed,
        current: matchingRecords[completed]?.name,
        errors,
      });
    };

    // Process in batches
    for (let i = 0; i < matchingRecords.length; i += concurrency) {
      const batch = matchingRecords.slice(i, i + concurrency);

      const batchPromises = batch.map(async (record) => {
        try {
          if (dryRun) {
            // Simulate the update
            results.push({
              ...record,
              ...updates,
              modified_on: new Date().toISOString(),
            } as DNSRecord);
            succeeded++;
          } else {
            // Merge existing record with updates
            const updateParams: CreateDNSRecordParams = {
              type: updates.type ?? record.type,
              name: updates.name ?? record.name,
              content: updates.content ?? record.content,
              ttl: updates.ttl ?? record.ttl,
              proxied: updates.proxied ?? record.proxied,
              priority: updates.priority ?? record.priority,
              comment: updates.comment ?? record.comment,
            };

            const result = await this.dns.update(zoneId, record.id, updateParams);
            results.push(result);
            succeeded++;
          }
        } catch (err) {
          failed++;
          errors.push({
            item: `${record.type} ${record.name} (${record.id})`,
            error: err instanceof Error ? err.message : String(err),
          });
          if (!continueOnError) {
            throw err;
          }
        } finally {
          completed++;
          reportProgress();
        }
      });

      try {
        await Promise.all(batchPromises);
      } catch {
        if (!continueOnError) break;
      }

      if (delayMs > 0 && i + concurrency < matchingRecords.length) {
        await this.delay(delayMs);
      }
    }

    return {
      success: failed === 0,
      total: matchingRecords.length,
      succeeded,
      failed,
      results,
      errors,
      dryRun,
    };
  }

  /**
   * Bulk delete DNS records matching a filter
   */
  async bulkDeleteDNS(
    zoneId: string,
    filter: DNSFilter,
    options: BulkOperationOptions = {}
  ): Promise<BulkResult<{ id: string; name: string }>> {
    const {
      concurrency = 5,
      dryRun = false,
      onProgress,
      continueOnError = false,
      delayMs = 0,
    } = options;

    // Get all matching records
    const matchingRecords = await this.getAllDNSRecords(zoneId, filter);

    const results: { id: string; name: string }[] = [];
    const errors: BulkError[] = [];
    let completed = 0;
    let succeeded = 0;
    let failed = 0;

    const reportProgress = () => {
      onProgress?.({
        total: matchingRecords.length,
        completed,
        succeeded,
        failed,
        current: matchingRecords[completed]?.name,
        errors,
      });
    };

    // Process in batches
    for (let i = 0; i < matchingRecords.length; i += concurrency) {
      const batch = matchingRecords.slice(i, i + concurrency);

      const batchPromises = batch.map(async (record) => {
        try {
          if (dryRun) {
            results.push({ id: record.id, name: record.name });
            succeeded++;
          } else {
            await this.dns.delete(zoneId, record.id);
            results.push({ id: record.id, name: record.name });
            succeeded++;
          }
        } catch (err) {
          failed++;
          errors.push({
            item: `${record.type} ${record.name} (${record.id})`,
            error: err instanceof Error ? err.message : String(err),
          });
          if (!continueOnError) {
            throw err;
          }
        } finally {
          completed++;
          reportProgress();
        }
      });

      try {
        await Promise.all(batchPromises);
      } catch {
        if (!continueOnError) break;
      }

      if (delayMs > 0 && i + concurrency < matchingRecords.length) {
        await this.delay(delayMs);
      }
    }

    return {
      success: failed === 0,
      total: matchingRecords.length,
      succeeded,
      failed,
      results,
      errors,
      dryRun,
    };
  }

  /**
   * Export DNS records to various formats
   */
  async exportDNS(zoneId: string, options: DNSExportOptions): Promise<string> {
    const records = await this.getAllDNSRecords(zoneId, options.filter);

    switch (options.format) {
      case 'json':
        return this.exportDNSToJSON(records, options.includeIds);
      case 'csv':
        return this.exportDNSToCSV(records, options.includeIds);
      case 'bind':
        return this.dns.export(zoneId);
      default:
        throw new Error(`Unknown export format: ${options.format}`);
    }
  }

  /**
   * Import DNS records from JSON or CSV
   */
  async importDNS(
    zoneId: string,
    data: string,
    format: 'json' | 'csv',
    options: BulkOperationOptions = {}
  ): Promise<BulkResult<DNSRecord>> {
    let records: DNSImportRecord[];

    if (format === 'json') {
      records = this.parseDNSFromJSON(data);
    } else {
      records = this.parseDNSFromCSV(data);
    }

    return this.bulkCreateDNS(zoneId, records, options);
  }

  // ============================================
  // Bulk Firewall Operations
  // ============================================

  /**
   * Get all firewall rules for a zone
   */
  async getAllFirewallRules(zoneId: string): Promise<FirewallRule[]> {
    const allRules: FirewallRule[] = [];
    let page = 1;
    const perPage = 100;
    let hasMore = true;

    while (hasMore) {
      const response = await this.firewall.listRules(zoneId, { page, per_page: perPage });
      const rules = response.result || [];
      allRules.push(...rules);

      const resultInfo = response.result_info;
      if (resultInfo && resultInfo.page < resultInfo.total_pages) {
        page++;
      } else {
        hasMore = false;
      }
    }

    return allRules;
  }

  /**
   * Bulk create firewall rules
   */
  async bulkCreateFirewallRules(
    zoneId: string,
    rules: CreateFirewallRuleParams[],
    options: BulkOperationOptions = {}
  ): Promise<BulkResult<FirewallRule>> {
    const {
      dryRun = false,
      onProgress,
    } = options;

    const errors: BulkError[] = [];
    let results: FirewallRule[] = [];

    onProgress?.({
      total: rules.length,
      completed: 0,
      succeeded: 0,
      failed: 0,
      errors,
    });

    if (dryRun) {
      // Simulate success for dry run
      results = rules.map((rule, i) => ({
        id: `dry-run-${i}`,
        paused: rule.paused ?? false,
        description: rule.description ?? '',
        action: rule.action,
        filter: {
          id: `filter-${i}`,
          expression: rule.filter.expression,
          paused: false,
          description: rule.filter.description,
        },
        created_on: new Date().toISOString(),
        modified_on: new Date().toISOString(),
      }));

      onProgress?.({
        total: rules.length,
        completed: rules.length,
        succeeded: rules.length,
        failed: 0,
        errors,
      });

      return {
        success: true,
        total: rules.length,
        succeeded: rules.length,
        failed: 0,
        results,
        errors,
        dryRun: true,
      };
    }

    try {
      // Cloudflare API supports batch creation
      results = await this.firewall.createRules(zoneId, rules);

      onProgress?.({
        total: rules.length,
        completed: rules.length,
        succeeded: results.length,
        failed: rules.length - results.length,
        errors,
      });

      return {
        success: true,
        total: rules.length,
        succeeded: results.length,
        failed: 0,
        results,
        errors,
        dryRun: false,
      };
    } catch (err) {
      errors.push({
        item: 'Bulk firewall rules creation',
        error: err instanceof Error ? err.message : String(err),
      });

      return {
        success: false,
        total: rules.length,
        succeeded: 0,
        failed: rules.length,
        results: [],
        errors,
        dryRun: false,
      };
    }
  }

  /**
   * Bulk delete firewall rules
   */
  async bulkDeleteFirewallRules(
    zoneId: string,
    ruleIds: string[],
    options: BulkOperationOptions = {}
  ): Promise<BulkResult<{ id: string }>> {
    const {
      concurrency = 5,
      dryRun = false,
      onProgress,
      continueOnError = false,
      delayMs = 0,
    } = options;

    const results: { id: string }[] = [];
    const errors: BulkError[] = [];
    let completed = 0;
    let succeeded = 0;
    let failed = 0;

    const reportProgress = () => {
      onProgress?.({
        total: ruleIds.length,
        completed,
        succeeded,
        failed,
        errors,
      });
    };

    for (let i = 0; i < ruleIds.length; i += concurrency) {
      const batch = ruleIds.slice(i, i + concurrency);

      const batchPromises = batch.map(async (ruleId) => {
        try {
          if (dryRun) {
            results.push({ id: ruleId });
            succeeded++;
          } else {
            await this.firewall.deleteRule(zoneId, ruleId);
            results.push({ id: ruleId });
            succeeded++;
          }
        } catch (err) {
          failed++;
          errors.push({
            item: `Rule ${ruleId}`,
            error: err instanceof Error ? err.message : String(err),
          });
          if (!continueOnError) {
            throw err;
          }
        } finally {
          completed++;
          reportProgress();
        }
      });

      try {
        await Promise.all(batchPromises);
      } catch {
        if (!continueOnError) break;
      }

      if (delayMs > 0 && i + concurrency < ruleIds.length) {
        await this.delay(delayMs);
      }
    }

    return {
      success: failed === 0,
      total: ruleIds.length,
      succeeded,
      failed,
      results,
      errors,
      dryRun,
    };
  }

  // ============================================
  // Bulk Worker Operations
  // ============================================

  /**
   * Bulk deploy workers from a directory or config
   */
  async bulkDeployWorkers(
    accountId: string,
    workers: Array<{
      name: string;
      script: string;
      compatibility_date?: string;
    }>,
    options: BulkOperationOptions = {}
  ): Promise<BulkResult<{ name: string; id: string }>> {
    const {
      concurrency = 3,
      dryRun = false,
      onProgress,
      continueOnError = false,
      delayMs = 1000, // Workers have stricter rate limits
    } = options;

    const results: { name: string; id: string }[] = [];
    const errors: BulkError[] = [];
    let completed = 0;
    let succeeded = 0;
    let failed = 0;

    const reportProgress = () => {
      onProgress?.({
        total: workers.length,
        completed,
        succeeded,
        failed,
        current: workers[completed]?.name,
        errors,
      });
    };

    for (let i = 0; i < workers.length; i += concurrency) {
      const batch = workers.slice(i, i + concurrency);

      const batchPromises = batch.map(async (worker) => {
        try {
          if (dryRun) {
            results.push({ name: worker.name, id: 'dry-run-id' });
            succeeded++;
          } else {
            const result = await this.workers.create(accountId, worker.name, {
              script: worker.script,
              compatibility_date: worker.compatibility_date,
            });
            results.push({ name: worker.name, id: result.id });
            succeeded++;
          }
        } catch (err) {
          failed++;
          errors.push({
            item: `Worker: ${worker.name}`,
            error: err instanceof Error ? err.message : String(err),
          });
          if (!continueOnError) {
            throw err;
          }
        } finally {
          completed++;
          reportProgress();
        }
      });

      try {
        await Promise.all(batchPromises);
      } catch {
        if (!continueOnError) break;
      }

      if (delayMs > 0 && i + concurrency < workers.length) {
        await this.delay(delayMs);
      }
    }

    return {
      success: failed === 0,
      total: workers.length,
      succeeded,
      failed,
      results,
      errors,
      dryRun,
    };
  }

  /**
   * Bulk delete workers
   */
  async bulkDeleteWorkers(
    accountId: string,
    scriptNames: string[],
    options: BulkOperationOptions = {}
  ): Promise<BulkResult<{ name: string }>> {
    const {
      concurrency = 3,
      dryRun = false,
      onProgress,
      continueOnError = false,
      delayMs = 500,
    } = options;

    const results: { name: string }[] = [];
    const errors: BulkError[] = [];
    let completed = 0;
    let succeeded = 0;
    let failed = 0;

    const reportProgress = () => {
      onProgress?.({
        total: scriptNames.length,
        completed,
        succeeded,
        failed,
        errors,
      });
    };

    for (let i = 0; i < scriptNames.length; i += concurrency) {
      const batch = scriptNames.slice(i, i + concurrency);

      const batchPromises = batch.map(async (name) => {
        try {
          if (dryRun) {
            results.push({ name });
            succeeded++;
          } else {
            await this.workers.delete(accountId, name);
            results.push({ name });
            succeeded++;
          }
        } catch (err) {
          failed++;
          errors.push({
            item: `Worker: ${name}`,
            error: err instanceof Error ? err.message : String(err),
          });
          if (!continueOnError) {
            throw err;
          }
        } finally {
          completed++;
          reportProgress();
        }
      });

      try {
        await Promise.all(batchPromises);
      } catch {
        if (!continueOnError) break;
      }

      if (delayMs > 0 && i + concurrency < scriptNames.length) {
        await this.delay(delayMs);
      }
    }

    return {
      success: failed === 0,
      total: scriptNames.length,
      succeeded,
      failed,
      results,
      errors,
      dryRun,
    };
  }

  // ============================================
  // Helper Methods
  // ============================================

  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  private exportDNSToJSON(records: DNSRecord[], includeIds = false): string {
    const exportRecords = records.map(r => ({
      ...(includeIds ? { id: r.id } : {}),
      type: r.type,
      name: r.name,
      content: r.content,
      ttl: r.ttl,
      proxied: r.proxied,
      priority: r.priority,
      comment: r.comment,
    }));
    return JSON.stringify(exportRecords, null, 2);
  }

  private exportDNSToCSV(records: DNSRecord[], includeIds = false): string {
    const headers = includeIds
      ? ['id', 'type', 'name', 'content', 'ttl', 'proxied', 'priority', 'comment']
      : ['type', 'name', 'content', 'ttl', 'proxied', 'priority', 'comment'];

    const rows = records.map(r => {
      const values = includeIds
        ? [r.id, r.type, r.name, r.content, r.ttl, r.proxied, r.priority ?? '', r.comment ?? '']
        : [r.type, r.name, r.content, r.ttl, r.proxied, r.priority ?? '', r.comment ?? ''];
      return values.map(v => this.escapeCSV(String(v))).join(',');
    });

    return [headers.join(','), ...rows].join('\n');
  }

  private escapeCSV(value: string): string {
    if (value.includes(',') || value.includes('"') || value.includes('\n')) {
      return `"${value.replace(/"/g, '""')}"`;
    }
    return value;
  }

  private parseDNSFromJSON(data: string): DNSImportRecord[] {
    const parsed = JSON.parse(data);
    const records = Array.isArray(parsed) ? parsed : [parsed];

    return records.map((r: Record<string, unknown>) => ({
      type: String(r.type).toUpperCase() as DNSRecordType,
      name: String(r.name),
      content: String(r.content),
      ttl: r.ttl ? Number(r.ttl) : undefined,
      priority: r.priority ? Number(r.priority) : undefined,
      proxied: r.proxied === true || r.proxied === 'true',
      comment: r.comment ? String(r.comment) : undefined,
    }));
  }

  private parseDNSFromCSV(data: string): DNSImportRecord[] {
    const lines = data.trim().split('\n');
    if (lines.length < 2) {
      throw new Error('CSV must have a header row and at least one data row');
    }

    const headers = this.parseCSVLine(lines[0]!).map(h => h.toLowerCase().trim());
    const records: DNSImportRecord[] = [];

    for (let i = 1; i < lines.length; i++) {
      const values = this.parseCSVLine(lines[i]!);
      const record: Record<string, unknown> = {};

      headers.forEach((header, idx) => {
        record[header] = values[idx];
      });

      records.push({
        type: String(record.type).toUpperCase() as DNSRecordType,
        name: String(record.name),
        content: String(record.content),
        ttl: record.ttl ? Number(record.ttl) : undefined,
        priority: record.priority ? Number(record.priority) : undefined,
        proxied: record.proxied === 'true' || record.proxied === true,
        comment: record.comment ? String(record.comment) : undefined,
      });
    }

    return records;
  }

  private parseCSVLine(line: string): string[] {
    const values: string[] = [];
    let current = '';
    let inQuotes = false;

    for (let i = 0; i < line.length; i++) {
      const char = line[i];

      if (char === '"') {
        if (inQuotes && line[i + 1] === '"') {
          current += '"';
          i++;
        } else {
          inQuotes = !inQuotes;
        }
      } else if (char === ',' && !inQuotes) {
        values.push(current);
        current = '';
      } else {
        current += char;
      }
    }
    values.push(current);

    return values;
  }
}
