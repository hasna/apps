import { lookup as lookupHostname } from 'node:dns/promises';
import { isIP } from 'node:net';

const BLOCKED_HOSTS = new Set([
  'localhost',
  '0.0.0.0',
  'metadata.google.internal',
  'metadata.azure.com',
  'metadata.aws.cloud',
  'kubernetes.default.svc',
  'kubernetes.default.svc.cluster.local',
]);

export interface DnsLookupAddress {
  address: string;
  family: 4 | 6;
}

export type DnsLookupFn = (hostname: string) => Promise<DnsLookupAddress[]>;

export class WebhookUrlError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'WebhookUrlError';
  }
}

function isPrivateIpv4(parts: number[]): boolean {
  const [a, b] = parts;
  if (parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return false;
  if (a === 10) return true;
  if (a === 127) return true;
  if (a === 0) return true;
  if (a === 169 && b === 254) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 100 && b >= 64 && b <= 127) return true;
  if (a === 198 && (b === 18 || b === 19)) return true;
  if (a >= 224) return true;
  return false;
}

function isPrivateIpv6(address: string): boolean {
  const normalized = address.toLowerCase();
  const mappedIpv4 = ipv4FromMappedIpv6(normalized);
  if (mappedIpv4) {
    return isPrivateIp(mappedIpv4);
  }

  const firstHextet = Number.parseInt(normalized.split(':')[0] || '0', 16);
  if (normalized === '::1' || normalized === '::') return true;
  if ((firstHextet & 0xfe00) === 0xfc00) return true;
  if ((firstHextet & 0xffc0) === 0xfe80) return true;
  if ((firstHextet & 0xff00) === 0xff00) return true;
  if (normalized === 'fd00:ec2::254') return true;
  return false;
}

function ipv4FromMappedIpv6(address: string): string | undefined {
  if (!address.startsWith('::ffff:')) return undefined;
  const tail = address.slice('::ffff:'.length);
  if (isIP(tail) === 4) return tail;

  const parts = tail.split(':');
  if (parts.length !== 2) return undefined;

  const words = parts.map((part) => Number.parseInt(part, 16));
  if (
    words.some((word, index) => (
      !/^[0-9a-f]{1,4}$/i.test(parts[index] ?? '') ||
      Number.isNaN(word) ||
      word < 0 ||
      word > 0xffff
    ))
  ) {
    return undefined;
  }

  return [
    words[0] >> 8,
    words[0] & 0xff,
    words[1] >> 8,
    words[1] & 0xff,
  ].join('.');
}

export function isPrivateIp(address: string): boolean {
  const ipVersion = isIP(address);
  if (ipVersion === 4) {
    const parts = address.split('.').map((part) => Number(part));
    if (parts.length !== 4 || parts.some((part) => Number.isNaN(part))) return false;
    return isPrivateIpv4(parts);
  }
  if (ipVersion === 6) {
    return isPrivateIpv6(address);
  }
  return false;
}

function normalizeHostname(hostname: string): string {
  return hostname.replace(/^\[|\]$/g, '').toLowerCase();
}

async function defaultDnsLookup(hostname: string): Promise<DnsLookupAddress[]> {
  const addresses = await lookupHostname(hostname, { all: true });
  return addresses
    .filter((address): address is DnsLookupAddress => address.family === 4 || address.family === 6)
    .map((address) => ({
      address: address.address,
      family: address.family,
    }));
}

export function validatePublicHttpUrl(rawUrl: string, label = 'URL'): string {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new WebhookUrlError(`Invalid ${label}: not a valid URL`);
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new WebhookUrlError(`Invalid ${label}: only http and https URLs are allowed`);
  }

  const hostname = normalizeHostname(parsed.hostname);
  if (!hostname) {
    throw new WebhookUrlError(`Invalid ${label}: hostname is required`);
  }

  if (BLOCKED_HOSTS.has(hostname)) {
    throw new WebhookUrlError(`Invalid ${label}: blocked host "${hostname}"`);
  }

  if (hostname === '169.254.169.254') {
    throw new WebhookUrlError(`Invalid ${label}: metadata endpoints are not allowed`);
  }

  if (isIP(hostname) && isPrivateIp(hostname)) {
    throw new WebhookUrlError(`Invalid ${label}: private or loopback IP addresses are not allowed`);
  }

  if (hostname.endsWith('.localhost') || hostname.endsWith('.local')) {
    throw new WebhookUrlError(`Invalid ${label}: local domain names are not allowed`);
  }

  return parsed.toString();
}

export async function validatePublicHttpUrlForRequest(
  rawUrl: string,
  label = 'URL',
  dnsLookup: DnsLookupFn = defaultDnsLookup,
): Promise<string> {
  const normalizedUrl = validatePublicHttpUrl(rawUrl, label);
  const parsed = new URL(normalizedUrl);
  const hostname = normalizeHostname(parsed.hostname);

  if (isIP(hostname)) {
    return normalizedUrl;
  }

  let addresses: DnsLookupAddress[];
  try {
    addresses = await dnsLookup(hostname);
  } catch {
    throw new WebhookUrlError(`Invalid ${label}: hostname could not be resolved`);
  }

  if (addresses.length === 0) {
    throw new WebhookUrlError(`Invalid ${label}: hostname did not resolve to an IP address`);
  }

  const blockedAddress = addresses.find(({ address }) => isPrivateIp(address));
  if (blockedAddress) {
    throw new WebhookUrlError(
      `Invalid ${label}: hostname resolves to private, loopback, link-local, metadata, or reserved IP address "${blockedAddress.address}"`,
    );
  }

  return normalizedUrl;
}
