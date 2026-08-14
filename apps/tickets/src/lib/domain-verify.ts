import { resolve } from "node:dns/promises";
import { getDomainByName, verifyDomain, generateVerificationToken } from "../db/domains.ts";

const VERIFY_SECRET = process.env["TICKETS_DOMAIN_SECRET"] ?? "domain-verify-secret-change-in-production";

/**
 * Generate the expected DNS TXT record value for domain verification.
 * Callers should instruct the user to add:
 *   Host:  _tickets-verify.<domain>
 *   Value: <token>
 */
export function getDomainVerificationToken(domainId: string): string {
  return generateVerificationToken(domainId, VERIFY_SECRET);
}

/**
 * Check DNS TXT records for _tickets-verify.<domain> and compare to expected token.
 * Returns true if the record is present and matches.
 */
export async function checkDnsVerification(domain: string, expectedToken: string): Promise<boolean> {
  const lookupHost = `_tickets-verify.${domain}`;
  try {
    const records = await resolve(lookupHost, "TXT");
    return records.some((chunks) => {
      const value = Array.isArray(chunks) ? chunks.join("") : String(chunks);
      return value === expectedToken;
    });
  } catch {
    return false; // NXDOMAIN or DNS error — not yet verified
  }
}

/**
 * Verify a domain by checking DNS and updating the DB if confirmed.
 * Returns { verified: true } on success, { verified: false, reason } on failure.
 */
export async function verifyDomainByName(domain: string): Promise<{ verified: boolean; reason?: string }> {
  const d = getDomainByName(domain);
  if (!d) return { verified: false, reason: `Domain "${domain}" not registered` };
  if (d.verified) return { verified: true };

  const token = getDomainVerificationToken(d.id);
  const confirmed = await checkDnsVerification(domain, token);

  if (!confirmed) {
    return {
      verified: false,
      reason: `DNS TXT record not found. Add _tickets-verify.${domain} = ${token}`,
    };
  }

  verifyDomain(d.id);
  return { verified: true };
}

/**
 * Poll for DNS verification every 10 seconds for up to 5 minutes.
 * onCheck is called on each attempt with the result.
 */
export async function pollVerification(
  domain: string,
  onCheck?: (attempt: number, verified: boolean) => void,
  maxAttempts = 30, // 5 min at 10s intervals
): Promise<boolean> {
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const result = await verifyDomainByName(domain);
    onCheck?.(attempt, result.verified);
    if (result.verified) return true;
    if (attempt < maxAttempts) {
      await new Promise((resolve) => setTimeout(resolve, 10_000));
    }
  }
  return false;
}
