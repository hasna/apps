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

export class WebhookUrlError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'WebhookUrlError';
  }
}

function isPrivateIpv4(parts: number[]): boolean {
  const [a, b] = parts;
  if (a === 10) return true;
  if (a === 127) return true;
  if (a === 0) return true;
  if (a === 169 && b === 254) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 100 && b >= 64 && b <= 127) return true;
  return false;
}

function isPrivateIpv6(address: string): boolean {
  const normalized = address.toLowerCase();
  if (normalized === '::1' || normalized === '::') return true;
  if (normalized.startsWith('fc') || normalized.startsWith('fd')) return true;
  if (normalized.startsWith('fe80:')) return true;
  if (normalized === 'fd00:ec2::254') return true;
  return false;
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

  const hostname = parsed.hostname.replace(/^\[|\]$/g, '').toLowerCase();
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
