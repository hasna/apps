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

// Registrar providers
export {
  getProvider,
  getAvailableProviders,
  syncAll,
  autoDetectRegistrar,
  type RegistrarProvider,
  type ProviderDnsRecord,
  type ProviderDomainInfo,
  type ProviderAvailability,
  type ProviderInfo,
  type SyncAllResult,
} from "./lib/registrar.js";

// Route 53
export {
  checkAvailability as r53CheckAvailability,
  registerDomain as r53RegisterDomain,
  getRegistrationStatus as r53GetRegistrationStatus,
  listRegisteredDomains as r53ListRegisteredDomains,
  createHostedZone as r53CreateHostedZone,
  listHostedZones as r53ListHostedZones,
  getHostedZone as r53GetHostedZone,
  deleteHostedZone as r53DeleteHostedZone,
  findHostedZoneByDomain as r53FindHostedZoneByDomain,
  listRecords as r53ListRecords,
  upsertRecord as r53UpsertRecord,
  upsertRecords as r53UpsertRecords,
  deleteRecord as r53DeleteRecord,
  createRoute53Provider,
  getConfig as r53GetConfig,
  type Route53Config,
  type DomainContactInfo,
  type DomainAvailability,
  type RegisteredDomain,
  type HostedZoneInfo,
  type Route53Record,
  type Route53RecordInput,
} from "./lib/route53.js";
