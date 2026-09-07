import { parseDocument } from "htmlparser2";
import { marked, type Token } from "marked";
import { safeMailText } from "./message-document.js";
import type { AttachmentContent } from "../../lib/attachment-download.js";

export const MAX_MAIL_IMAGE_BYTES = 5 * 1024 * 1024;
export const MAX_MAIL_IMAGE_PIXELS = 4_000_000;
export const MAX_MAIL_IMAGES = 12;
export type MailImageAttachment = {
  filename: string;
  content_type: string;
  size: number;
  content_id?: string;
};
export type MailImageSource = { label: string; inline: boolean } & (
  | { kind: "attachment"; index: number }
  | { kind: "embedded"; data: string }
  | { kind: "remote"; url: string }
  | { kind: "unavailable"; reason: string }
);
const supported = (type: string) => /^image\/(png|jpeg|gif|webp)$/i.test(type);
const cid = (value: string) => {
  const raw = value.replace(/^cid:/i, "").replace(/^<|>$/g, "").trim();
  try { return decodeURIComponent(raw); } catch { return raw; }
};
export function mailImages(
  text: string | null | undefined,
  html: string | null | undefined,
  attachments: MailImageAttachment[] = [],
): MailImageSource[] {
  const result: MailImageSource[] = [];
  const used = new Set<number>();
  const seen = new Set<string>();
  const add = (src: string, label: string) => {
    if (result.length >= MAX_MAIL_IMAGES || seen.has(src)) return;
    seen.add(src);
    const display = safeMailText(label || "Email image").slice(0, 160);
    if (/^cid:/i.test(src)) {
      const matches = attachments
        .map((a, index) => ({ a, index }))
        .filter(({ a }) => a.content_id && cid(a.content_id) === cid(src));
      if (matches.length === 1 && supported(matches[0]!.a.content_type)) {
        const index = matches[0]!.index;
        used.add(index);
        result.push({
          kind: "attachment",
          index,
          label: display,
          inline: true,
        });
      } else
        result.push({
          kind: "unavailable",
          label: display,
          inline: true,
          reason:
            "Embedded image metadata is unavailable. Check the image attachments below.",
        });
    } else if (/^data:image\/(png|jpeg|gif|webp);base64,/i.test(src))
      result.push({
        kind: "embedded",
        data: src,
        label: display,
        inline: true,
      });
    else {
      try {
        const url = new URL(src);
        if (url.protocol === "https:" && !url.username && !url.password)
          result.push({
            kind: "remote",
            url: url.href,
            label: display,
            inline: true,
          });
      } catch {}
    }
  };
  if (html) {
    const visit = (
      nodes: ReturnType<typeof parseDocument>["children"],
      depth = 0,
    ) => {
      if (depth > 60) return;
      for (const node of nodes) {
        if (result.length >= MAX_MAIL_IMAGES) return;
        if (node.type !== "tag") continue;
        if (
          /^(script|style|head|iframe|svg)$/i.test(node.name) ||
          "hidden" in node.attribs ||
          node.attribs["aria-hidden"] === "true" ||
          /display\s*:\s*none|visibility\s*:\s*hidden/i.test(
            node.attribs.style ?? "",
          )
        )
          continue;
        if (
          node.name === "img" &&
          node.attribs.width !== "1" &&
          node.attribs.height !== "1"
        )
          add(node.attribs.src ?? "", node.attribs.alt ?? "");
        visit(node.children, depth + 1);
      }
    };
    visit(parseDocument(html.slice(0, 220000)).children);
  } else if (text) {
    const visit = (tokens: Token[], depth = 0) => {
      if (depth > 60) return;
      for (const token of tokens) {
        if (token.type === "image") add(token.href, token.text);
        if (token.type === "list")
          for (const item of token.items) visit(item.tokens, depth + 1);
        if (token.type === "table")
          for (const row of [token.header, ...token.rows])
            for (const cell of row) visit(cell.tokens, depth + 1);
        if ("tokens" in token && Array.isArray(token.tokens))
          visit(token.tokens, depth + 1);
      }
    };
    visit(marked.lexer(text.slice(0, 220000)));
  }
  attachments.forEach((attachment, index) => {
    if (
      result.length < MAX_MAIL_IMAGES &&
      !used.has(index) &&
      supported(attachment.content_type)
    )
      result.push({
        kind: "attachment",
        index,
        label: safeMailText(attachment.filename).slice(0, 160),
        inline: false,
      });
  });
  return result;
}

/** Inspect raster dimensions before the native decoder allocates the full image. */
export function validateMailImage(data: Uint8Array): Uint8Array {
  if (data.byteLength === 0 || data.byteLength > MAX_MAIL_IMAGE_BYTES)
    throw new Error("Image exceeds the 5 MiB preview limit");
  const b = Buffer.from(data.buffer, data.byteOffset, data.byteLength);
  let width = 0,
    height = 0;
  if (
    b.length >= 24 &&
    b.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) &&
    b.toString("ascii", 12, 16) === "IHDR"
  ) {
    width = b.readUInt32BE(16);
    height = b.readUInt32BE(20);
  } else if (b.length >= 10 && /^GIF8[79]a$/.test(b.toString("ascii", 0, 6))) {
    width = b.readUInt16LE(6);
    height = b.readUInt16LE(8);
  } else if (
    b.length >= 30 &&
    b.toString("ascii", 0, 4) === "RIFF" &&
    b.toString("ascii", 8, 12) === "WEBP"
  ) {
    const kind = b.toString("ascii", 12, 16);
    if (kind === "VP8X") {
      width = 1 + b.readUIntLE(24, 3);
      height = 1 + b.readUIntLE(27, 3);
    } else if (
      kind === "VP8 " &&
      b[23] === 0x9d &&
      b[24] === 1 &&
      b[25] === 0x2a
    ) {
      width = b.readUInt16LE(26) & 0x3fff;
      height = b.readUInt16LE(28) & 0x3fff;
    } else if (kind === "VP8L" && b[20] === 0x2f) {
      width = 1 + (b.readUInt32LE(21) & 0x3fff);
      height = 1 + ((b.readUInt32LE(21) >>> 14) & 0x3fff);
    }
  } else if (b.length >= 4 && b[0] === 0xff && b[1] === 0xd8) {
    let offset = 2;
    while (offset + 4 < b.length) {
      if (b[offset++] !== 0xff) break;
      while (b[offset] === 0xff) offset++;
      const marker = b[offset++]!;
      if (marker === 0xd9 || marker === 0xda) break;
      if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue;
      const length = b.readUInt16BE(offset);
      if (length < 2 || offset + length > b.length) break;
      if (
        [
          0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd,
          0xce, 0xcf,
        ].includes(marker) &&
        length >= 7
      ) {
        height = b.readUInt16BE(offset + 3);
        width = b.readUInt16BE(offset + 5);
        break;
      }
      offset += length;
    }
  }
  if (!width || !height)
    throw new Error("Preview supports valid PNG, JPEG, GIF or WebP images");
  if (width * height > MAX_MAIL_IMAGE_PIXELS || width > 8192 || height > 8192)
    throw new Error("Image exceeds the 4 megapixel preview limit");
  return data;
}

export async function loadMailImage(
  source: MailImageSource,
  options: {
    messageId?: string;
    allowRemote?: boolean;
    signal?: AbortSignal;
    getAttachment: (
      id: string,
      index: number,
      opts: { maxBytes: number },
    ) => Promise<AttachmentContent>;
    fetch?: typeof fetch;
  },
): Promise<Uint8Array> {
  if (source.kind === "unavailable") throw new Error(source.reason);
  if (source.kind === "attachment") {
    if (!options.messageId)
      throw new Error("Open the original message to preview this attachment");
    const content = await options.getAttachment(
      options.messageId,
      source.index,
      { maxBytes: MAX_MAIL_IMAGE_BYTES },
    );
    if (content.state !== "available")
      throw new Error(
        "Image content is not stored. Use the attachment action to check availability.",
      );
    if (!supported(content.content_type))
      throw new Error("Attachment is not a supported raster image");
    return validateMailImage(content.data);
  }
  if (source.kind === "embedded") {
    const encoded = source.data.slice(source.data.indexOf(",") + 1);
    if (
      encoded.length > Math.ceil(MAX_MAIL_IMAGE_BYTES / 3) * 4 ||
      !/^[A-Za-z0-9+/]*={0,2}$/.test(encoded)
    )
      throw new Error("Embedded image is invalid or too large");
    return validateMailImage(Buffer.from(encoded, "base64"));
  }
  if (!options.allowRemote)
    throw new Error(
      "External images are blocked until you choose Load external image",
    );
  const url = new URL(source.url);
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    /^(localhost|127\.|0\.|10\.|192\.168\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.|\[)/i.test(
      url.hostname,
    ) ||
    /\.(local|internal)$/i.test(url.hostname)
  )
    throw new Error("External previews require a public HTTPS image URL");
  const response = await (options.fetch ?? fetch)(url, {
    redirect: "error",
    credentials: "omit",
    referrerPolicy: "no-referrer",
    signal: options.signal ?? AbortSignal.timeout(10000),
  });
  if (!response.ok)
    throw new Error(`Image request failed (HTTP ${response.status})`);
  if (
    !supported(
      (response.headers.get("content-type") ?? "").split(";")[0]!.trim(),
    )
  )
    throw new Error("External URL did not return a supported image");
  if (Number(response.headers.get("content-length")) > MAX_MAIL_IMAGE_BYTES)
    throw new Error("Image exceeds the 5 MiB preview limit");
  const reader = response.body?.getReader();
  if (!reader) throw new Error("Image response is empty");
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > MAX_MAIL_IMAGE_BYTES)
        throw new Error("Image exceeds the 5 MiB preview limit");
      chunks.push(value);
    }
  } finally {
    await reader.cancel();
  }
  return validateMailImage(Buffer.concat(chunks));
}
