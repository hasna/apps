/**
 * Domain, DNS record, and alert CRUD operations
 *
 * This file re-exports everything from the individual modules so that
 * existing imports continue to work without changes.
 */

export type {
  Domain,
  CreateDomainInput,
  UpdateDomainInput,
  ListDomainsOptions,
  DomainStats,
} from "./domain-records.js";

export {
  rowToDomain,
  createDomain,
  getDomain,
  listDomains,
  updateDomain,
  deleteDomain,
  countDomains,
  searchDomains,
  getByRegistrar,
  listExpiring,
  listSslExpiring,
  getDomainStats,
  getDomainByName,
} from "./domain-records.js";

export type {
  DnsRecord,
  CreateDnsRecordInput,
  UpdateDnsRecordInput,
} from "./dns-records.js";

export {
  rowToDnsRecord,
  createDnsRecord,
  getDnsRecord,
  listDnsRecords,
  updateDnsRecord,
  deleteDnsRecord,
} from "./dns-records.js";

export type {
  Alert,
  CreateAlertInput,
} from "./alerts.js";

export {
  createAlert,
  getAlert,
  listAlerts,
  deleteAlert,
} from "./alerts.js";

export type {
  WhoisResult,
  DnsPropagationResult,
  SslCheckResult,
  ZoneImportResult,
  SubdomainResult,
  DnsValidationIssue,
  DnsValidationResult,
} from "./dns-tools.js";

export {
  whoisLookup,
  checkDnsPropagation,
  checkSsl,
  exportZoneFile,
  importZoneFile,
  discoverSubdomains,
  validateDns,
} from "./dns-tools.js";

export type { BulkCheckResult } from "./monitoring.js";

export { exportPortfolio, checkAllDomains } from "./monitoring.js";
