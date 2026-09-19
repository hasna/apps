import { promises as dns } from "node:dns";
import {
  checkAvailability,
  deleteDefaultHostedZone,
  getDomainDetail,
  listHostedZonesByDomain,
  getRegistrationContactFromDomain,
  getRegistrationStatus,
  registerDomain,
  updateNameservers,
} from "../lib/route53.js";
import {
  bindWorkerCustomDomain,
  ensureZone,
  getZone,
  listRecords,
  reconcileRecords,
  upsertRecord,
  workerCustomDomainReady,
  type CloudflareConfig,
} from "../lib/cloudflare.js";
import type { DomainProvisioningProviders } from "../lib/provisioning.js";

function sourceDomain(env: NodeJS.ProcessEnv): string {
  const value = env["DOMAINS_REGISTRANT_SOURCE_DOMAIN"]?.trim();
  if (!value) throw new Error("DOMAINS_REGISTRANT_SOURCE_DOMAIN is required for hosted domain purchases");
  return value;
}

function hostedCloudflareConfig(env: NodeJS.ProcessEnv): CloudflareConfig {
  const apiToken = env["CLOUDFLARE_API_TOKEN"]?.trim();
  const accountId = env["CLOUDFLARE_ACCOUNT_ID"]?.trim();
  if (!apiToken) {
    if (env["CLOUDFLARE_API_KEY"] || env["CLOUDFLARE_EMAIL"]) {
      throw new Error("hosted provisioning requires CLOUDFLARE_API_TOKEN; global API key/email authentication is not accepted");
    }
    throw new Error("CLOUDFLARE_API_TOKEN is required for hosted provisioning");
  }
  if (!accountId) throw new Error("CLOUDFLARE_ACCOUNT_ID is required for hosted provisioning");
  return { apiToken, accountId };
}

function nameserversEqual(left: string[], right: string[]): boolean {
  const norm = (items: string[]) => [...new Set(items.map((item) => item.trim().toLowerCase().replace(/\.$/, "")).filter(Boolean))].sort();
  return JSON.stringify(norm(left)) === JSON.stringify(norm(right));
}

export function createHostedProvisioningProviders(
  env: NodeJS.ProcessEnv = process.env,
): DomainProvisioningProviders {
  const cloudflareConfig = hostedCloudflareConfig(env);
  const registrantSourceDomain = sourceDomain(env);
  return {
    async checkAvailability(name) {
      const availability = await checkAvailability(name);
      return {
        available: availability.available,
        ...(availability.price !== undefined ? { price_usd: Number(availability.price) } : {}),
        ...(availability.price !== undefined
          ? { registration_price_usd: Number(availability.price) }
          : {}),
        ...(availability.renewal_price !== undefined
          ? { renewal_price_usd: Number(availability.renewal_price) }
          : {}),
        ...(availability.currency ? { currency: availability.currency } : {}),
      };
    },

    async submitRegistration(input) {
      const contact = await getRegistrationContactFromDomain(registrantSourceDomain);
      return registerDomain(
        input.name,
        contact,
        input.years,
        input.autoRenew,
        undefined,
        { privacy_protected: true },
      );
    },

    getOperationStatus(operationId) {
      return getRegistrationStatus(operationId);
    },

    async getDomainDetail(name) {
      try {
        const detail = await getDomainDetail(name);
        return {
          registered_at: detail.created || undefined,
          expires_at: detail.expiry || undefined,
          auto_renew: detail.auto_renew ?? undefined,
          nameservers: detail.nameservers,
          registrar: detail.registrar_name || "AWS Route 53",
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (/not found|not registered|InvalidInput|404/i.test(message)) return null;
        throw error;
      }
    },

    async ensureCloudflareZone(name) {
      const zone = await ensureZone(name, cloudflareConfig);
      return { id: zone.id, status: zone.status, nameservers: zone.nameservers };
    },

    updateNameservers(name, nameservers) {
      return updateNameservers(name, nameservers);
    },

    async resolvePublicNameservers(name) {
      return dns.resolveNs(name).catch(() => [] as string[]);
    },

    async bindWorkerDomain(input) {
      await bindWorkerCustomDomain(input.hostname, input.zoneId, input.workerName, cloudflareConfig);
    },

    workerDomainReady(input) {
      return workerCustomDomainReady(input.hostname, input.zoneId, input.workerName, cloudflareConfig);
    },

    async configureWebsiteOrigin(input) {
      const records = [input.hostname, `www.${input.hostname}`].map((name) => ({
        type: "CNAME" as const,
        name,
        content: input.originHostname,
        proxied: true as const,
        ttl: 1,
      }));
      for (const record of records) {
        await upsertRecord(input.zoneId, record, cloudflareConfig);
      }
      return records.map((record) => ({
        type: record.type,
        name: record.name,
        value: record.content,
        proxied: record.proxied,
        ttl: record.ttl,
      }));
    },

    async websiteOriginReady(input) {
      const records = await listRecords(input.zoneId, cloudflareConfig);
      const names = new Set([input.hostname, `www.${input.hostname}`]);
      const matching = records.filter((record) =>
        record.type === "CNAME"
        && names.has(record.name.toLowerCase().replace(/\.$/u, ""))
        && record.content.toLowerCase().replace(/\.$/u, "") === input.originHostname
        && record.proxied === true
      );
      if (matching.length !== names.size) return false;
      try {
        const response = await fetch(`https://${input.hostname}/`, {
          method: "GET",
          redirect: "error",
          signal: AbortSignal.timeout(10_000),
          headers: { "user-agent": "hasna-domains-provisioning/1" },
        });
        return response.status >= 200 && response.status < 400;
      } catch {
        return false;
      }
    },

    async reconcileDnsRecords(input) {
      await reconcileRecords(input.zoneId, input.records.map((record) => ({
        type: record.type,
        name: record.name,
        content: record.value,
        ttl: record.ttl,
        ...(record.priority === null ? {} : { priority: record.priority }),
        ...(record.type === "CNAME" ? { proxied: false } : {}),
      })), cloudflareConfig);
      return input.records;
    },

    async dnsRecordsReady(input) {
      const current = await listRecords(input.zoneId, cloudflareConfig);
      return input.records.every((expected) => current.some((record) =>
        record.type === expected.type
        && record.name.toLowerCase().replace(/\.$/u, "") === expected.name
        && record.content === expected.value
        && record.ttl === expected.ttl
        && (record.priority ?? null) === expected.priority
        && (expected.type !== "CNAME" || record.proxied === false)
      ));
    },

    async listRoute53HostedZoneIds(name) {
      return (await listHostedZonesByDomain(name)).map((zone) => zone.id).sort();
    },

    async cleanupRoute53HostedZone(input) {
      const cloudflare = await getZone(input.name, cloudflareConfig);
      if (!cloudflare || !nameserversEqual(cloudflare.nameservers, input.registrarNameservers)) return false;
      const result = await deleteDefaultHostedZone(
        input.hostedZoneId,
        input.name,
        input.registrarNameservers,
      );
      return result.deleted;
    },
  };
}
