/**
 * Capability-bearing URL projection.
 *
 * Incident 716957 (todos b03cc058): a stored destination that is itself a
 * signed capability URL (an S3 presigned read URL, GCS, or CloudFront signed
 * URL) was emitted verbatim by the CLI into a probe file and reproduced in a
 * session transcript, granting bearer read access until expiry. `secrets scan`
 * does not cover this class, so consumer-side containment is the interim
 * behaviour required by the capability-bearing-output doctrine.
 *
 * Output therefore projects such a URL to its plain unsigned reference — the
 * scheme/host/path with every capability query parameter stripped. A consumer
 * resolving the projected reference goes through the normal unsigned path and
 * never receives a bearer credential from a transcript.
 */
import type { Link } from "../types.js";

const CAPABILITY_PARAM_NAMES = [
  // S3 V4 presigned URLs.
  "X-Amz-Algorithm",
  "X-Amz-Credential",
  "X-Amz-Date",
  "X-Amz-Expires",
  "X-Amz-Security-Token",
  "X-Amz-Signature",
  "X-Amz-SignedHeaders",
  // GCS V4 presigned URLs.
  "X-Goog-Algorithm",
  "X-Goog-Credential",
  "X-Goog-Date",
  "X-Goog-Expires",
  "X-Goog-Signature",
  "X-Goog-SignedHeaders",
  // S3 V2 and CloudFront signed URLs.
  "AWSAccessKeyId",
  "Signature",
  "Policy",
  "Key-Pair-Id",
  "Expires",
];

const CAPABILITY_PARAM_SET = new Set(CAPABILITY_PARAM_NAMES.map((name) => name.toLowerCase()));

/** True when `url` is an http(s) URL whose query carries a signed-capability parameter. */
export function hasCapabilityQuery(url: string): boolean {
  if (!/^https?:\/\//i.test(url)) return false;
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  for (const key of parsed.searchParams.keys()) {
    if (CAPABILITY_PARAM_SET.has(key.toLowerCase())) return true;
  }
  return false;
}

/**
 * Project `url` to its plain unsigned reference: the same scheme/host/path
 * with every capability query parameter stripped and non-capability parameters
 * preserved. Non-capability or malformed values are returned unchanged.
 */
export function projectDestinationUrl(url: string): string {
  if (!hasCapabilityQuery(url)) return url;
  try {
    const parsed = new URL(url);
    const kept: Array<[string, string]> = [];
    for (const [key, value] of parsed.searchParams.entries()) {
      if (!CAPABILITY_PARAM_SET.has(key.toLowerCase())) kept.push([key, value]);
    }
    parsed.search = new URLSearchParams(kept).toString();
    return parsed.toString();
  } catch {
    return url;
  }
}

/** Project a Link record's destination_url (identity when already plain). */
export function projectLink(link: Link): Link {
  const projected = projectDestinationUrl(link.destination_url);
  return projected === link.destination_url ? link : { ...link, destination_url: projected };
}

/**
 * Project a CLI payload for output: a Link, an array of Links, or a LinkStats
 * record get their destination_url projected; every other payload passes
 * through untouched (same object reference).
 */
export function projectForOutput(data: unknown): unknown {
  if (Array.isArray(data)) return data.map((item) => projectForOutput(item));
  if (data && typeof data === "object") {
    const record = data as Record<string, unknown>;
    if (typeof record.destination_url === "string") {
      return projectLink(record as unknown as Link);
    }
    const nestedLink = record.link;
    if (nestedLink && typeof nestedLink === "object" && typeof (nestedLink as Record<string, unknown>).destination_url === "string") {
      const projected = projectLink(nestedLink as unknown as Link);
      return projected === nestedLink ? data : { ...record, link: projected };
    }
  }
  return data;
}
