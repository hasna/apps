import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { generateKeyPairSync, createSign, createPublicKey } from "node:crypto";
import { createServer, type Server } from "node:https";
import type { AddressInfo } from "node:net";
import { createEvent } from "./index.js";
import { dispatchWebhook } from "./transports.js";
import type { WebhookTargetPolicy } from "./ssrf.js";

/**
 * HTTPS end-to-end regression tests for the pinned webhook transport.
 *
 * The transport must deliver to a real HTTPS target while keeping standard TLS
 * hostname verification intact: the connection is pinned to the validated
 * address, but the certificate is validated against the original hostname, so
 * a certificate issued for the hostname verifies normally on Node/undici and
 * Bun alike (Bun must NOT skip hostname verification). The SSRF block must
 * also hold for private HTTPS targets.
 *
 * A self-signed certificate is generated at test time (pure Node crypto, no
 * fixture private keys in the tree) and trusted via `transportOptions.tls.ca`.
 */

// --- Minimal DER / X.509 self-signed certificate generator -------------------

function derLength(length: number): Buffer {
  if (length < 0x80) return Buffer.from([length]);
  const bytes: number[] = [];
  let n = length;
  while (n > 0) {
    bytes.unshift(n & 0xff);
    n = Math.floor(n / 256);
  }
  return Buffer.from([0x80 | bytes.length, ...bytes]);
}

function derTlv(tag: number, content: Buffer): Buffer {
  return Buffer.concat([Buffer.from([tag]), derLength(content.length), content]);
}

function derSequence(...items: Buffer[]): Buffer {
  return derTlv(0x30, Buffer.concat(items));
}

function derSet(...items: Buffer[]): Buffer {
  return derTlv(0x31, Buffer.concat(items));
}

function derInteger(value: number): Buffer {
  let hex = value.toString(16);
  if (hex.length % 2) hex = `0${hex}`;
  let bytes = Buffer.from(hex, "hex");
  while (bytes.length > 1 && bytes[0] === 0 && !(bytes[1] & 0x80)) bytes = bytes.subarray(1);
  if (bytes[0] & 0x80) bytes = Buffer.concat([Buffer.from([0]), bytes]);
  return derTlv(0x02, bytes);
}

function derOid(oid: string): Buffer {
  const parts = oid.split(".").map(Number);
  const body: number[] = [40 * parts[0] + parts[1]];
  for (const part of parts.slice(2)) {
    const stack: number[] = [];
    let n = part;
    do {
      stack.unshift(n & 0x7f);
      n = Math.floor(n / 128);
    } while (n > 0);
    for (let i = 0; i < stack.length; i += 1) {
      body.push(i < stack.length - 1 ? stack[i] | 0x80 : stack[i]);
    }
  }
  return derTlv(0x06, Buffer.from(body));
}

function derPrintable(value: string): Buffer {
  return derTlv(0x13, Buffer.from(value, "ascii"));
}

function derBitString(content: Buffer): Buffer {
  return derTlv(0x03, Buffer.concat([Buffer.from([0]), content]));
}

function derOctetString(content: Buffer): Buffer {
  return derTlv(0x04, content);
}

function derUtcTime(date: Date): Buffer {
  const iso = date.toISOString();
  const body = `${iso.slice(2, 10).replace(/-/g, "")}${iso.slice(11, 19).replace(/:/g, "")}Z`;
  return derTlv(0x17, Buffer.from(body, "ascii"));
}

function derExplicit(tag: number, content: Buffer): Buffer {
  return derTlv(0xa0 + tag, content);
}

function derNull(): Buffer {
  return Buffer.from([0x05, 0x00]);
}

const RSA_SHA256_OID = derOid("1.2.840.113549.1.1.11");
const RSA_OID = derOid("1.2.840.113549.1.1.1");
const CN_OID = derOid("2.5.4.3");
const SAN_OID = derOid("2.5.29.17");
const BASIC_CONSTRAINTS_OID = derOid("2.5.29.19");
const KEY_USAGE_OID = derOid("2.5.29.15");

function algorithmIdentifier(oid: Buffer): Buffer {
  return derSequence(oid, derNull());
}

function rdnName(cn: string): Buffer {
  return derSequence(derSet(derSequence(CN_OID, derPrintable(cn))));
}

function subjectAltName(dnsNames: string[], ipAddresses: string[]): Buffer {
  const names: Buffer[] = [];
  for (const name of dnsNames) names.push(derTlv(0x82, Buffer.from(name, "ascii")));
  for (const ip of ipAddresses) names.push(derTlv(0x87, Buffer.from(ip.split(".").map(Number))));
  return derSequence(...names);
}

function x509Extension(oid: Buffer, value: Buffer): Buffer {
  return derSequence(oid, derOctetString(value));
}

function pemWrap(label: string, der: Buffer): string {
  const body = der.toString("base64").replace(/(.{64})/g, "$1\n");
  return `-----BEGIN ${label}-----\n${body}\n-----END ${label}-----\n`;
}

/**
 * Generates a self-signed CA cert + key for the given hostnames/IPs. Returns
 * PEM strings suitable for both `node:https` server options and a `ca` trust
 * override.
 */
function generateSelfSignedCert(options: {
  dnsNames: string[];
  ipAddresses: string[];
  notBefore: Date;
  notAfter: Date;
}): { keyPem: string; certPem: string } {
  const { publicKey, privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const publicKeyPem = publicKey.export({ format: "pem", type: "spki" });
  const pkcs1 = createPublicKey(publicKeyPem).export({ format: "der", type: "pkcs1" });
  const subjectPublicKeyInfo = derSequence(algorithmIdentifier(RSA_OID), derBitString(pkcs1));

  const validity = derSequence(derUtcTime(options.notBefore), derUtcTime(options.notAfter));
  const extensions = derSequence(
    x509Extension(BASIC_CONSTRAINTS_OID, derSequence(derTlv(0x01, Buffer.from([0xff])))), // cA: TRUE
    x509Extension(KEY_USAGE_OID, derTlv(0x03, Buffer.from([0, 0xa4]))), // digitalSignature|keyEncipherment|keyCertSign
    x509Extension(SAN_OID, subjectAltName(options.dnsNames, options.ipAddresses)),
  );
  const cn = options.dnsNames[0] ?? "webhook.test";
  const tbsCertificate = derSequence(
    derExplicit(0, derInteger(2)), // version v3
    derInteger(1), // serial
    algorithmIdentifier(RSA_SHA256_OID),
    rdnName(cn),
    validity,
    rdnName(cn),
    subjectPublicKeyInfo,
    derExplicit(3, extensions),
  );
  const signer = createSign("sha256");
  signer.update(tbsCertificate);
  signer.end();
  const signature = signer.sign(privateKey);
  const certificate = derSequence(tbsCertificate, algorithmIdentifier(RSA_SHA256_OID), derBitString(signature));
  return {
    keyPem: privateKey.export({ format: "pem", type: "pkcs8" }),
    certPem: pemWrap("CERTIFICATE", certificate),
  };
}

// --- Fixture ----------------------------------------------------------------

const HOSTNAME = "webhook.test";
const WRONG_HOSTNAME = "wronghost.test";

let server: Server | undefined;
let port = 0;
const captured: { host?: string } = {};
let tls: { ca: string } = { ca: "" };
let allowPolicy: WebhookTargetPolicy;

beforeAll(async () => {
  const now = Date.now();
  const generated = generateSelfSignedCert({
    dnsNames: [HOSTNAME, "localhost"],
    ipAddresses: ["127.0.0.1"],
    notBefore: new Date(now - 60_000),
    notAfter: new Date(now + 24 * 3600_000),
  });
  tls = { ca: generated.certPem };
  await new Promise<void>((resolve) => {
    server = createServer(
      {
        key: generated.keyPem,
        cert: generated.certPem,
      },
      (request, response) => {
        captured.host = request.headers.host;
        response.writeHead(200, { "content-type": "application/json" });
        response.end(JSON.stringify({ ok: true }));
      },
    );
    server.listen(0, "127.0.0.1", resolve);
  });
  port = (server!.address() as AddressInfo).port;
  // The lookup pins the connection to the loopback server; the loopback
  // address is admitted only through the explicit private-host allowlist.
  allowPolicy = {
    allowPrivateHosts: ["127.0.0.1"],
    lookup: async (hostname) => [{ address: "127.0.0.1", family: 4 }],
  };
});

afterAll(() => {
  server?.close();
});

describe("webhook HTTPS delivery over the pinned transport", () => {
  test("hostname verification PASSES for an HTTPS target with a cert for the hostname", async () => {
    const attempt = await dispatchWebhook(createEvent({ id: "https-ok", source: "notes", type: "note.created" }), {
      id: "https",
      enabled: true,
      transport: "webhook",
      webhook: { url: `https://${HOSTNAME}:${port}/hook` },
      createdAt: "2026-08-06T10:00:00.000Z",
      updatedAt: "2026-08-06T10:00:00.000Z",
    }, {
      webhookTargetPolicy: allowPolicy,
      tls,
    });
    expect(attempt.status).toBe("success");
    // The connection reached the pinned loopback server and TLS hostname
    // verification passed against the real certificate for the hostname.
    expect(captured.host).toBe(`${HOSTNAME}:${port}`);
  });

  test("hostname verification is enforced: a hostname not covered by the cert FAILS", async () => {
    const attempt = await dispatchWebhook(createEvent({ id: "https-mismatch", source: "notes", type: "note.created" }), {
      id: "https-mismatch",
      enabled: true,
      transport: "webhook",
      webhook: { url: `https://${WRONG_HOSTNAME}:${port}/hook` },
      createdAt: "2026-08-06T10:00:00.000Z",
      updatedAt: "2026-08-06T10:00:00.000Z",
    }, {
      webhookTargetPolicy: allowPolicy,
      tls,
    });
    expect(attempt.status).toBe("failed");
    expect(attempt.error).toMatch(/hostname|altname|certificate|altnames/i);
  });

  test("SSRF block still holds for private HTTPS targets", async () => {
    const attempt = await dispatchWebhook(createEvent({ id: "https-private", source: "notes", type: "note.created" }), {
      id: "https-private",
      enabled: true,
      transport: "webhook",
      webhook: { url: "https://10.0.0.5/hook" },
      createdAt: "2026-08-06T10:00:00.000Z",
      updatedAt: "2026-08-06T10:00:00.000Z",
    }, {
      webhookTargetPolicy: {},
    });
    expect(attempt.status).toBe("failed");
    expect(attempt.error).toMatch(/private or special-use/);
  });
});
