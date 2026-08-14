const CONNECTOR = 'Wildcard';

export function validateHttpsUrl(url: string, label: string): string {
  let parsed: URL;
  try {
    parsed = new URL(url.trim());
  } catch {
    throw new Error(`${CONNECTOR}: ${label} must be a valid URL`);
  }
  if (parsed.protocol !== 'https:') {
    throw new Error(`${CONNECTOR}: ${label} must use HTTPS`);
  }
  return parsed.toString();
}

export function normalizeBaseUrl(url: string, label: string): string {
  return validateHttpsUrl(url, label).replace(/\/+$/, '');
}
