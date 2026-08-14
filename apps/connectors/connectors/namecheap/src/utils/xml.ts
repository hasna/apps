/**
 * XML parsing helpers for Namecheap API responses
 * Regex-based, zero dependencies
 */

/**
 * Extract text content from a single XML tag
 */
export function extractTag(xml: string, tag: string): string | null {
  const regex = new RegExp(`<${tag}[^>]*>([^<]*)</${tag}>`, 'i');
  const match = xml.match(regex);
  return match ? match[1].trim() : null;
}

/**
 * Extract an attribute value from the first occurrence of a tag
 */
export function extractAttribute(xml: string, tag: string, attr: string): string | null {
  const regex = new RegExp(`<${tag}\\s[^>]*${attr}="([^"]*)"`, 'i');
  const match = xml.match(regex);
  return match ? match[1] : null;
}

/**
 * Extract all occurrences of a tag (self-closing or with content)
 */
export function extractAllTags(xml: string, tag: string): string[] {
  const regex = new RegExp(`<${tag}(?:\\s[^>]*)?\\/?>(?:([^<]*)<\\/${tag}>)?`, 'gi');
  const results: string[] = [];
  let match;
  while ((match = regex.exec(xml)) !== null) {
    const fullMatch = match[0];
    const tagNameCheck = new RegExp(`^<${tag}(?:\\s|\\/>|>)`, 'i');
    if (tagNameCheck.test(fullMatch)) {
      results.push(fullMatch);
    }
  }
  return results;
}

/**
 * Extract an attribute value from an already-extracted element string
 */
export function extractAttributeFromElement(element: string, attr: string): string | null {
  const regex = new RegExp(`${attr}="([^"]*)"`, 'i');
  const match = element.match(regex);
  return match ? match[1] : null;
}

/**
 * Check API response for errors and throw if found
 */
export function checkApiError(xml: string): void {
  const status = extractAttribute(xml, 'ApiResponse', 'Status');
  if (status === 'ERROR') {
    const errorMsg = extractTag(xml, 'Message') || extractTag(xml, 'Err') || 'Unknown Namecheap API error';
    const errorNumber = extractAttribute(xml, 'Error', 'Number') || extractAttribute(xml, 'Err', 'Number');
    throw new Error(`Namecheap API error${errorNumber ? ` (${errorNumber})` : ''}: ${errorMsg}`);
  }
}

/**
 * Split a domain name into SLD and TLD
 * Handles multi-part TLDs like .co.uk
 */
export function splitDomain(domain: string): { sld: string; tld: string } {
  const parts = domain.split('.');
  if (parts.length < 2) {
    throw new Error(`Invalid domain: ${domain}`);
  }
  // Handle multi-part TLDs like .co.uk
  if (parts.length >= 3 && ['co', 'com', 'org', 'net', 'ac', 'gov'].includes(parts[parts.length - 2])) {
    return {
      sld: parts.slice(0, -2).join('.'),
      tld: parts.slice(-2).join('.'),
    };
  }
  return {
    sld: parts.slice(0, -1).join('.'),
    tld: parts[parts.length - 1],
  };
}
