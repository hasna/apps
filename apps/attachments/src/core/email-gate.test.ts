import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { tmpdir } from "os";
import { join } from "path";
import { rmSync } from "fs";
import { AttachmentsDB, type AccessGrant, type Attachment, type ShareLink } from "./db";
import { generateShareToken, hashShareToken } from "./security";
import {
  requestAccessGrant,
  verifyAccessGrant,
  requestAccessGrantAsync,
  verifyAccessGrantAsync,
  EmailGateError,
  type AsyncEmailGateSource,
  type EmailSender,
} from "./email-gate";

let counter = 0;
function makeDb(): { db: AttachmentsDB; path: string } {
  const path = join(tmpdir(), `att-emailgate-${process.pid}-${++counter}-${Date.now()}.sqlite`);
  return { db: new AttachmentsDB(path), path };
}

function makeAttachment(): Attachment {
  return {
    id: `att_eg_${++counter}`,
    filename: "FUNDATIA-HASNA-documente-semnate.zip",
    s3Key: "attachments/2026-06-29/att_eg/x.zip",
    bucket: "cloud",
    size: 1234,
    contentType: "application/zip",
    link: null,
    tag: null,
    expiresAt: null,
    createdAt: Date.now(),
  };
}

function seedRequireEmailLink(db: AttachmentsDB, allowedEmails: string[] | null = null): string {
  const att = makeAttachment();
  db.insert(att);
  const { token } = db.createShareLink({
    attachmentId: att.id,
    expiresAt: null,
    requireEmail: true,
    allowedEmails,
  });
  return token;
}

function makeSender() {
  const sent: Array<{ to: string; subject: string; text: string; html?: string }> = [];
  const sender: EmailSender = {
    send: async (m) => {
      sent.push(m);
    },
  };
  return { sender, sent };
}

describe("email-gate", () => {
  let dbHandle: { db: AttachmentsDB; path: string };
  beforeEach(() => {
    dbHandle = makeDb();
  });
  afterEach(() => {
    try {
      rmSync(dbHandle.path, { force: true });
    } catch {}
  });

  it("createShareLink persists requireEmail + allowedEmails", () => {
    const token = seedRequireEmailLink(dbHandle.db, ["a@bcr.ro", "B@BCR.RO"]);
    const link = dbHandle.db.findShareLinkByToken(token);
    expect(link?.requireEmail).toBe(true);
    expect(link?.allowedEmails).toEqual(["a@bcr.ro", "B@BCR.RO"]);
  });

  it("requestAccessGrant emails a unique access link for a valid email", async () => {
    const token = seedRequireEmailLink(dbHandle.db);
    const { sender, sent } = makeSender();
    let grantToken = "";
    const res = await requestAccessGrant({
      db: dbHandle.db,
      token,
      email: "Ionut.Babos@BCR.ro",
      sender,
      buildAccessUrl: (g) => {
        grantToken = g;
        return `https://has.na/a/${token}?grant=${g}`;
      },
      filename: "docs.zip",
    });
    expect(res.email).toBe("ionut.babos@bcr.ro"); // normalized
    expect(sent).toHaveLength(1);
    expect(sent[0]!.to).toBe("ionut.babos@bcr.ro");
    expect(sent[0]!.text).toContain(grantToken);
    // the emailed grant must verify against this link
    const verified = verifyAccessGrant(dbHandle.db, token, grantToken);
    expect(verified.email).toBe("ionut.babos@bcr.ro");
  });

  it("rejects an invalid email with 400 and sends nothing", async () => {
    const token = seedRequireEmailLink(dbHandle.db);
    const { sender, sent } = makeSender();
    await expect(
      requestAccessGrant({ db: dbHandle.db, token, email: "not-an-email", sender, buildAccessUrl: (g) => g })
    ).rejects.toMatchObject({ status: 400 });
    expect(sent).toHaveLength(0);
  });

  it("enforces the allowlist (403 for disallowed, ok for allowed, case-insensitive)", async () => {
    const token = seedRequireEmailLink(dbHandle.db, ["Digital.Inbox@bcr.ro"]);
    const { sender, sent } = makeSender();
    await expect(
      requestAccessGrant({ db: dbHandle.db, token, email: "stranger@evil.com", sender, buildAccessUrl: (g) => g })
    ).rejects.toMatchObject({ status: 403 });
    expect(sent).toHaveLength(0);
    const ok = await requestAccessGrant({
      db: dbHandle.db,
      token,
      email: "DIGITAL.INBOX@BCR.RO",
      sender,
      buildAccessUrl: (g) => g,
    });
    expect(ok.email).toBe("digital.inbox@bcr.ro");
    expect(sent).toHaveLength(1);
  });

  it("refuses to gate a link that does not require email", async () => {
    const att = makeAttachment();
    dbHandle.db.insert(att);
    const { token } = dbHandle.db.createShareLink({ attachmentId: att.id, expiresAt: null });
    const { sender } = makeSender();
    await expect(
      requestAccessGrant({ db: dbHandle.db, token, email: "x@y.com", sender, buildAccessUrl: (g) => g })
    ).rejects.toBeInstanceOf(EmailGateError);
  });

  it("verifyAccessGrant rejects a wrong/foreign grant token (401) and expired grants (410)", async () => {
    const token = seedRequireEmailLink(dbHandle.db);
    expect(() => verifyAccessGrant(dbHandle.db, token, "bogus-grant")).toThrow(EmailGateError);
    try {
      verifyAccessGrant(dbHandle.db, token, "bogus-grant");
    } catch (e) {
      expect((e as EmailGateError).status).toBe(401);
    }
    // expired grant
    const { sender } = makeSender();
    let g = "";
    await requestAccessGrant({
      db: dbHandle.db,
      token,
      email: "a@b.com",
      sender,
      buildAccessUrl: (t) => (g = t),
      ttlMs: -1000,
    });
    try {
      verifyAccessGrant(dbHandle.db, token, g);
      throw new Error("should have thrown");
    } catch (e) {
      expect((e as EmailGateError).status).toBe(410);
    }
  });
});

// ---------------------------------------------------------------------------
// Hosted / Postgres store: the same gate policy through async methods
// ---------------------------------------------------------------------------

function makeAsyncSource() {
  const shareLinks = new Map<string, ShareLink>();
  const grantsByHash = new Map<string, AccessGrant>();
  const source: AsyncEmailGateSource = {
    findShareLinkByToken: async (token: string) => shareLinks.get(hashShareToken(token)) ?? null,
    createAccessGrant: async (input: { shareLinkId: string; email: string; ttlMs?: number }) => {
      const token = generateShareToken();
      const now = Date.now();
      const grant: AccessGrant = {
        id: `grant_${generateShareToken().slice(0, 16)}`,
        shareLinkId: input.shareLinkId,
        email: input.email,
        tokenHash: hashShareToken(token),
        createdAt: now,
        expiresAt: now + (input.ttlMs ?? 30 * 60 * 1000),
        consumedAt: null,
      };
      grantsByHash.set(grant.tokenHash, grant);
      return { grant, token };
    },
    findAccessGrantByToken: async (token: string) => grantsByHash.get(hashShareToken(token)) ?? null,
  };
  return { source, shareLinks, grantsByHash };
}

function seedAsyncGatedLink(
  source: AsyncEmailGateSource,
  shareLinks: Map<string, ShareLink>,
  allowedEmails: string[] | null = null,
): string {
  const att = makeAttachment();
  const link: ShareLink = {
    id: `share_async_${++counter}`,
    attachmentId: att.id,
    tokenHash: "",
    expiresAt: null,
    createdAt: Date.now(),
    revokedAt: null,
    passwordHash: null,
    maxUses: null,
    usedCount: 0,
    requireEmail: true,
    allowedEmails,
  };
  const token = generateShareToken();
  link.tokenHash = hashShareToken(token);
  shareLinks.set(link.tokenHash, link);
  return token;
}

describe("async email gate (hosted Postgres store)", () => {
  it("requestAccessGrantAsync mints a grant, emails the allowlisted address, and returns it", async () => {
    const { source, shareLinks, grantsByHash } = makeAsyncSource();
    const token = seedAsyncGatedLink(source, shareLinks, ["dan@bcr.ro"]);
    const { sender, sent } = makeSender();
    let accessUrl = "";
    const result = await requestAccessGrantAsync({
      source,
      token,
      email: "DAN@bcr.ro",
      sender,
      buildAccessUrl: (grant) => (accessUrl = grant),
    });
    expect(result.email).toBe("dan@bcr.ro");
    expect(sent).toHaveLength(1);
    expect(sent[0]!.to).toBe("dan@bcr.ro");
    expect(sent[0]!.text).toContain(accessUrl);
    expect(grantsByHash.size).toBe(1);
  });

  it("requestAccessGrantAsync refuses a non-allowlisted address with 403", async () => {
    const { source, shareLinks } = makeAsyncSource();
    const token = seedAsyncGatedLink(source, shareLinks, ["dan@bcr.ro"]);
    const { sender, sent } = makeSender();
    await expect(
      requestAccessGrantAsync({ source, token, email: "stranger@example.com", sender, buildAccessUrl: (g) => g })
    ).rejects.toThrow(EmailGateError);
    expect(sent).toHaveLength(0);
  });

  it("verifyAccessGrantAsync accepts a minted grant and rejects a foreign one", async () => {
    const { source, shareLinks } = makeAsyncSource();
    const token = seedAsyncGatedLink(source, shareLinks);
    const { sender } = makeSender();
    let grantToken = "";
    await requestAccessGrantAsync({
      source,
      token,
      email: "a@b.com",
      sender,
      buildAccessUrl: (t) => (grantToken = t),
    });
    const ok = await verifyAccessGrantAsync(source, token, grantToken);
    expect(ok.email).toBe("a@b.com");
    await expect(verifyAccessGrantAsync(source, token, "bogus")).rejects.toThrow(EmailGateError);
    await expect(verifyAccessGrantAsync(source, "wrong-token", grantToken)).rejects.toThrow(EmailGateError);
  });
});
