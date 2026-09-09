import type { Provider } from "../../types/index.js";
import { resolveSesCredentials } from "../../providers/ses.js";

export interface DomainDnsTask {
  type: "TXT" | "CNAME" | "MX";
  name: string;
  value: string;
  purpose: "DKIM" | "SPF" | "MAIL_FROM";
  status: "pending" | "verified";
  priority?: number;
}
export interface DomainConnectionEvidence {
  registered: boolean;
  verified_for_sending: boolean;
  dns_tasks: DomainDnsTask[];
}

export async function readDomainConnection(
  provider: Provider,
  domain: string,
  signal: AbortSignal,
): Promise<DomainConnectionEvidence> {
  if (provider.type === "ses") {
    const { SESv2Client, GetEmailIdentityCommand } = await import(
      "@aws-sdk/client-sesv2"
    );
    const credentials = resolveSesCredentials(provider).credentials;
    const client = new SESv2Client({
      region: provider.region ?? undefined,
      ...(credentials ? { credentials } : {}),
    });
    try {
      const identity = await client.send(
        new GetEmailIdentityCommand({ EmailIdentity: domain }),
        { abortSignal: signal },
      );
      if (identity.IdentityType !== "DOMAIN")
        throw new Error("Provider returned a different identity type");
      const dkim = identity.DkimAttributes;
      const tasks: DomainDnsTask[] = (dkim?.Tokens ?? []).map((token) => ({
        type: "CNAME",
        name: `${token}._domainkey.${domain}`,
        value: `${token}.dkim.amazonses.com`,
        purpose: "DKIM",
        status: dkim?.Status === "SUCCESS" ? "verified" : "pending",
      }));
      const mailFrom = identity.MailFromAttributes?.MailFromDomain;
      if (mailFrom) {
        const region = await client.config.region();
        const status =
          identity.MailFromAttributes?.MailFromDomainStatus === "SUCCESS"
            ? "verified"
            : "pending";
        tasks.push({
          type: "MX",
          name: mailFrom,
          value: `feedback-smtp.${region}.amazonses.com`,
          priority: 10,
          purpose: "MAIL_FROM",
          status,
        });
        tasks.push({
          type: "TXT",
          name: mailFrom,
          value: "v=spf1 include:amazonses.com ~all",
          purpose: "SPF",
          status,
        });
      }
      return {
        registered: true,
        verified_for_sending:
          identity.VerifiedForSendingStatus === true &&
          dkim?.Status === "SUCCESS" &&
          (identity.MailFromAttributes?.BehaviorOnMxFailure !== "REJECT_MESSAGE" ||
            identity.MailFromAttributes.MailFromDomainStatus === "SUCCESS"),
        dns_tasks: tasks,
      };
    } catch (error) {
      if (error instanceof Error && error.name === "NotFoundException")
        return {
          registered: false,
          verified_for_sending: false,
          dns_tasks: [],
        };
      throw error;
    } finally {
      client.destroy();
    }
  }
  if (provider.type !== "resend" || !provider.api_key)
    throw new Error("Domain connection provider binding is unavailable");
  const get = async (path: string) => {
    const response = await fetch(`https://api.resend.com${path}`, {
      headers: { Authorization: `Bearer ${provider.api_key!}` },
      signal,
      redirect: "error",
    });
    if (!response.ok) {
      await response.body?.cancel();
      throw new Error("Domain provider read failed");
    }
    return (await response.json()) as Record<string, any>;
  };
  let after: string | undefined;
  const seen = new Set<string>();
  for (let page = 0; page < 1000; page++) {
    const listing = await get(
      `/domains?limit=100${after ? `&after=${encodeURIComponent(after)}` : ""}`,
    );
    if (!Array.isArray(listing.data) || typeof listing.has_more !== "boolean")
      throw new Error("Domain provider returned an incomplete registry");
    const matches = listing.data.filter(
      (entry: any) =>
        typeof entry?.name === "string" && entry.name.toLowerCase() === domain,
    );
    if (matches.length > 1)
      throw new Error("Domain provider returned ambiguous identities");
    if (matches.length === 1) {
      const id = matches[0].id;
      if (typeof id !== "string" || !id)
        throw new Error("Domain provider returned an invalid identity");
      const detail = await get(`/domains/${encodeURIComponent(id)}`);
      if (
        detail.id !== id ||
        typeof detail.name !== "string" ||
        detail.name.toLowerCase() !== domain ||
        !Array.isArray(detail.records)
      )
        throw new Error("Domain provider identity did not match");
      const tasks: DomainDnsTask[] = [];
      for (const record of detail.records) {
        // Receiving/tracking records are separate capabilities, never a request
        // to replace the domain's existing inbound MX during sending connect.
        if (!["DKIM", "SPF"].includes(record.record)) continue;
        if (
          !["TXT", "CNAME", "MX"].includes(record.type) ||
          typeof record.name !== "string" ||
          typeof record.value !== "string"
        )
          throw new Error("Provider DNS record is incomplete");
        const rawName = record.name.replace(/\.$/, "");
        const name =
          rawName === "@"
            ? domain
            : rawName.toLowerCase().endsWith(`.${domain}`) ||
                rawName.toLowerCase() === domain
              ? rawName
              : `${rawName}.${domain}`;
        if (
          record.type === "MX" &&
          (!Number.isInteger(record.priority) ||
            record.priority < 0 ||
            record.priority > 65535)
        )
          throw new Error("Provider MX priority is missing");
        tasks.push({
          type: record.type,
          name,
          value: record.value,
          purpose: record.record,
          status: record.status === "verified" ? "verified" : "pending",
          ...(record.type === "MX" ? { priority: record.priority } : {}),
        });
      }
      return {
        registered: true,
        verified_for_sending:
          detail.status === "verified" &&
          detail.capabilities?.sending === "enabled",
        dns_tasks: tasks,
      };
    }
    if (!listing.has_more)
      return { registered: false, verified_for_sending: false, dns_tasks: [] };
    const next = listing.data.at(-1)?.id;
    if (typeof next !== "string" || !next || seen.has(next))
      throw new Error("Domain provider pagination did not advance");
    seen.add(next);
    after = next;
  }
  throw new Error("Domain provider registry could not be read completely");
}
