/**
 * Storage-free inbound primitives entry point for `@hasna/emails/inbound`.
 *
 * This subpath publishes ONLY the hostile-input modules that carry no database
 * or store-seam dependency, so another product (mailery) can reuse them without
 * dragging the storage layer into its module graph:
 *
 *   - lib/inbound-mime.ts    — inbound MIME normalization (lazy mailparser)
 *   - lib/sns-signature.ts   — AWS SNS signature verification + topic policy
 *   - lib/webhook-events.ts  — SES notification parser (+ Resend webhook parser)
 *   - lib/aws-inbound.ts     — SES inbound setup helpers (lazy AWS SDK clients)
 *   - lib/threading.ts       — Message-ID / In-Reply-To / References headers
 *
 * Deliberately NOT exported here:
 *   - lib/webhook.ts — imports ../store-resolution.js and ./storage-wiring.js,
 *     so re-exporting it would pull the storage seam into this graph
 *     (enforced by src/inbound-subpath.test.ts).
 *   - anything under db/, store/, store-sqlite/, store-http/, server/.
 *
 * The one-domain rule holds: these modules stay in src/lib/ and this file is
 * purely an interface layer over them. The module-graph guard lives in
 * src/inbound-subpath.test.ts and fails if any of the re-exported modules
 * grows a db/store import.
 */

// Inbound MIME normalization (hostile-input safe; lazily imports mailparser).
export { parseInboundMime, flattenHeaders } from "./lib/inbound-mime.js";
export type { NormalizedInboundEmail, InboundAttachmentMeta } from "./lib/inbound-mime.js";

// AWS SNS signature verification and topic policy.
export {
  verifyAwsSnsSignature,
  canonicalSnsMessage,
  isAwsSnsCertificateUrl,
  snsMessageAllowed,
  snsPolicyFromEnv,
} from "./lib/sns-signature.js";
export type { SnsPolicy, SnsSignatureOptions, SnsCertificateFetcher } from "./lib/sns-signature.js";

// SES notification parser (and the sibling Resend webhook parser).
export { parseSesWebhook, parseResendWebhook, verifySnsStructure, verifyResendSignature } from "./lib/webhook-events.js";
export type { WebhookEvent } from "./lib/webhook-events.js";

// SES inbound setup helpers (bucket policy merge, setup; lazily imports AWS SDK clients).
export { setupInboundEmail, buildSesBucketPolicy, mergeSesBucketPolicy, BucketPolicyParseError } from "./lib/aws-inbound.js";
export type { InboundSetupOptions, InboundSetupResult } from "./lib/aws-inbound.js";

// Threading headers: Message-ID generation, In-Reply-To/References parsing.
export { generateMessageId, buildThreadingHeaders, parseReferences } from "./lib/threading.js";
export type { ParentRef, ThreadingHeaders } from "./lib/threading.js";
