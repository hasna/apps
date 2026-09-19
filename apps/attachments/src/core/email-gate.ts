import { AttachmentsDB, type AccessGrant, type ShareLink } from "./db";
import { isValidEmail, normalizeEmail } from "./security";

/**
 * Pluggable email sender. The package ships a Resend adapter (see resendSender)
 * but any transport (SMTP, SES, a hosted mail service) can implement this.
 */
export interface EmailSender {
  send(input: { to: string; subject: string; text: string; html?: string }): Promise<void>;
}

export class EmailGateError extends Error {
  constructor(
    message: string,
    public status: 400 | 401 | 403 | 404 | 410
  ) {
    super(message);
    this.name = "EmailGateError";
  }
}

export interface RequestAccessInput {
  db: AttachmentsDB;
  /** Plaintext share-link token from the public URL. */
  token: string;
  email: string;
  sender: EmailSender;
  /** Builds the absolute access URL the recipient clicks (receives the grant token). */
  buildAccessUrl: (grantToken: string) => string;
  filename?: string;
  ttlMs?: number;
}

/**
 * Shared gate policy: is this share link open for email-gated access at all?
 * Throws EmailGateError for missing, revoked, expired, or non-gated links.
 */
function assertGateOpen(shareLink: ShareLink | null): ShareLink {
  if (!shareLink) throw new EmailGateError("Share link not found", 404);
  if (shareLink.revokedAt !== null) throw new EmailGateError("Share link has been revoked", 410);
  if (shareLink.expiresAt !== null && shareLink.expiresAt <= Date.now()) {
    throw new EmailGateError("Share link has expired", 410);
  }
  if (!shareLink.requireEmail) {
    throw new EmailGateError("This link does not require email access", 400);
  }
  return shareLink;
}

/**
 * Shared gate policy: may this email pass the allowlist? Returns the normalized
 * email. Throws EmailGateError for invalid or disallowed addresses.
 */
function authorizeEmail(email: string, shareLink: ShareLink): string {
  const normalized = normalizeEmail(email);
  if (!isValidEmail(normalized)) throw new EmailGateError("A valid email address is required", 400);
  if (shareLink.allowedEmails && !shareLink.allowedEmails.map(normalizeEmail).includes(normalized)) {
    // Generic message — do not reveal who is on the allowlist.
    throw new EmailGateError("This email is not authorized for this document", 403);
  }
  return normalized;
}

function gateEmailBody(fname: string, url: string, to: string): {
  to: string;
  subject: string;
  text: string;
  html: string;
} {
  return {
    to,
    subject: `Your access link for ${fname}`,
    text:
      `You requested access to ${fname}.\n\n` +
      `Open this link to download (valid for a limited time):\n${url}\n\n` +
      `If you did not request this, you can safely ignore this email.`,
    html:
      `<p>You requested access to <strong>${escapeHtml(fname)}</strong>.</p>` +
      `<p><a href="${escapeAttr(url)}">Download the file</a> — valid for a limited time.</p>` +
      `<p style="color:#888;font-size:13px">If you did not request this, you can ignore this email.</p>`,
  };
}

/**
 * Email-gated access: a visitor enters their email, we mint a single-window
 * grant and email them a unique access link. Returns the (normalized) email.
 * Throws EmailGateError for invalid links, bad emails, or disallowed addresses.
 */
export async function requestAccessGrant(input: RequestAccessInput): Promise<{ email: string }> {
  const shareLink = assertGateOpen(input.db.findShareLinkByToken(input.token));
  const email = authorizeEmail(input.email, shareLink);

  const { token: grantToken } = input.db.createAccessGrant({
    shareLinkId: shareLink.id,
    email,
    ttlMs: input.ttlMs,
  });
  await input.sender.send(gateEmailBody(input.filename ?? "the requested file", input.buildAccessUrl(grantToken), email));
  return { email };
}

export interface VerifyGrantResult {
  shareLink: ShareLink;
  email: string;
}

/**
 * Validate a grant token against a share link. Used when serving the download
 * after the recipient clicks their emailed link. Throws if missing, mismatched,
 * expired, or revoked.
 */
export function verifyAccessGrant(
  db: AttachmentsDB,
  token: string,
  grantToken: string
): VerifyGrantResult {
  const shareLink = assertGateOpen(db.findShareLinkByToken(token));
  const grant = db.findAccessGrantByToken(grantToken);
  return verifyGrantAgainstLink(grant, shareLink);
}

/**
 * The async store surface the cloud/Postgres service implements, so the same
 * gate policy runs on the hosted path without a local SQLite handle.
 */
export interface AsyncEmailGateSource {
  findShareLinkByToken(token: string): Promise<ShareLink | null>;
  createAccessGrant(input: {
    shareLinkId: string;
    email: string;
    ttlMs?: number;
  }): Promise<{ grant: AccessGrant; token: string }>;
  findAccessGrantByToken(token: string): Promise<AccessGrant | null>;
}

export interface RequestAccessGrantInput {
  source: AsyncEmailGateSource;
  /** Plaintext share-link token from the public URL. */
  token: string;
  email: string;
  sender: EmailSender;
  /** Builds the absolute access URL the recipient clicks (receives the grant token). */
  buildAccessUrl: (grantToken: string) => string;
  filename?: string;
  ttlMs?: number;
}

/**
 * Hosted equivalent of {@link requestAccessGrant}: same policy, same email,
 * with the async store as the only difference.
 */
export async function requestAccessGrantAsync(
  input: RequestAccessGrantInput
): Promise<{ email: string }> {
  const shareLink = assertGateOpen(await input.source.findShareLinkByToken(input.token));
  const email = authorizeEmail(input.email, shareLink);

  const { token: grantToken } = await input.source.createAccessGrant({
    shareLinkId: shareLink.id,
    email,
    ttlMs: input.ttlMs,
  });
  await input.sender.send(gateEmailBody(input.filename ?? "the requested file", input.buildAccessUrl(grantToken), email));
  return { email };
}

function verifyGrantAgainstLink(
  grant: AccessGrant | null,
  shareLink: ShareLink
): VerifyGrantResult {
  if (!grant || grant.shareLinkId !== shareLink.id) {
    throw new EmailGateError("Invalid access link", 401);
  }
  if (grant.expiresAt <= Date.now()) {
    throw new EmailGateError("This access link has expired", 410);
  }
  return { shareLink, email: grant.email };
}

/**
 * Hosted equivalent of {@link verifyAccessGrant}: same policy, async store.
 */
export async function verifyAccessGrantAsync(
  source: AsyncEmailGateSource,
  token: string,
  grantToken: string
): Promise<VerifyGrantResult> {
  const shareLink = assertGateOpen(await source.findShareLinkByToken(token));
  return verifyGrantAgainstLink(await source.findAccessGrantByToken(grantToken), shareLink);
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>]/g, (c) => (c === "&" ? "&amp;" : c === "<" ? "&lt;" : "&gt;"));
}
function escapeAttr(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
}
