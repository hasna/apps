/**
 * open-domains — Domain portfolio and DNS management for AI agents
 */

export {
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
  type Domain,
  type CreateDomainInput,
  type UpdateDomainInput,
  type ListDomainsOptions,
  type DomainStats,
} from "./db/domains.js";

export {
  createDnsRecord,
  getDnsRecord,
  listDnsRecords,
  updateDnsRecord,
  deleteDnsRecord,
  type DnsRecord,
  type CreateDnsRecordInput,
  type UpdateDnsRecordInput,
} from "./db/domains.js";

export {
  createAlert,
  getAlert,
  listAlerts,
  deleteAlert,
  type Alert,
  type CreateAlertInput,
} from "./db/domains.js";

export {
  whoisLookup,
  checkDnsPropagation,
  checkSsl,
  exportZoneFile,
  importZoneFile,
  discoverSubdomains,
  validateDns,
  exportPortfolio,
  checkAllDomains,
  type WhoisResult,
  type DnsPropagationResult,
  type SslCheckResult,
  type ZoneImportResult,
  type SubdomainResult,
  type DnsValidationIssue,
  type DnsValidationResult,
  type BulkCheckResult,
} from "./db/domains.js";

export { getDatabase, closeDatabase } from "./db/database.js";
