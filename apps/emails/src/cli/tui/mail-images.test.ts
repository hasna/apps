import { expect, test } from "bun:test";
import {
  loadMailImage,
  mailImages,
  validateMailImage,
  MAX_MAIL_IMAGE_BYTES,
} from "./mail-images.js";
const png = () =>
  Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAFElEQVQImWP4z8DwH4QZGBgYGMAAAEMGBf3cKZcAAAAASUVORK5CYII=",
    "base64",
  );
test("extracts GitHub-style images inside table cells and linked badges without fetching them", () => {
  const images = mailImages(
    null,
    '<table><tr><td><a href="https://github.com"><img alt="publish guard" src="https://images.example/guard.png"></a></td><td><img alt="test-suites" src="https://images.example/tests.png"></td></tr></table><img src="https://images.example/pixel" width="1"><div style="display:none"><img src="https://images.example/hidden"></div>',
  );
  expect(images).toHaveLength(2);
  expect(images[0]).toMatchObject({ kind: "remote", label: "publish guard" });
});
test("CID identity maps exact metadata while preserving attachment indexes and safe fallback", () => {
  const attachments = [
    { filename: "doc.pdf", content_type: "application/pdf", size: 1 },
    {
      filename: "badge.png",
      content_type: "image/png",
      size: 1,
      content_id: "badge",
    },
  ];
  expect(
    mailImages(null, '<img src="cid:badge" alt="Badge">', attachments),
  ).toEqual([{ kind: "attachment", index: 1, inline: true, label: "Badge" }]);
  expect(
    mailImages(null, '<img src="cid:unknown" alt="Missing">', attachments)[0]
      ?.kind,
  ).toBe("unavailable");
  expect(
    mailImages("![Chart](https://images.example/chart.png)", null)[0]?.kind,
  ).toBe("remote");
});
test("images are capped, hidden pixels excluded, and local-file URLs never become image sources", () => {
  expect(mailImages(null, '<img src="file:///etc/passwd">')).toHaveLength(0);
  expect(
    mailImages(
      null,
      Array.from(
        { length: 30 },
        (_, i) => `<img src="https://images.example/${i}.png">`,
      ).join(""),
    ),
  ).toHaveLength(12);
});
test("native decoder input is bounded by encoded size and declared dimensions", () => {
  expect(validateMailImage(png()).byteLength).toBeGreaterThan(0);
  const huge = png();
  huge.writeUInt32BE(100000, 16);
  expect(() => validateMailImage(huge)).toThrow("megapixel");
  expect(() => validateMailImage(Buffer.from("<svg/>"))).toThrow("valid PNG");
  expect(() =>
    validateMailImage(new Uint8Array(MAX_MAIL_IMAGE_BYTES + 1)),
  ).toThrow("5 MiB");
});
test("authenticated attachments use explicit message/index/limit and never public URL credentials", async () => {
  const calls: unknown[] = [];
  const bytes = await loadMailImage(
    { kind: "attachment", index: 2, label: "Fixture", inline: false },
    {
      messageId: "message-fixture",
      getAttachment: async (...args) => {
        calls.push(args);
        return {
          state: "available",
          index: 2,
          filename: "fixture.png",
          content_type: "image/png",
          data: png(),
          bytes: png().length,
          sha256: "fixture",
        };
      },
    },
  );
  expect(bytes).toEqual(png());
  expect(calls).toEqual([
    ["message-fixture", 2, { maxBytes: MAX_MAIL_IMAGE_BYTES }],
  ]);
});
test("remote images require per-image opt-in and omit credentials/referrer/redirects", async () => {
  let calls = 0;
  const source = {
    kind: "remote" as const,
    url: "https://images.example/fixture.png",
    label: "Fixture",
    inline: true,
  };
  const options = {
    getAttachment: async () => {
      throw new Error("Unexpected API call");
    },
    fetch: async (_url: unknown, init?: RequestInit) => {
      calls++;
      expect(init).toMatchObject({
        credentials: "omit",
        redirect: "error",
        referrerPolicy: "no-referrer",
      });
      expect(init?.headers).toBeUndefined();
      return new Response(png(), { headers: { "content-type": "image/png" } });
    },
  };
  await expect(loadMailImage(source, options as never)).rejects.toThrow(
    "blocked",
  );
  expect(calls).toBe(0);
  expect(
    await loadMailImage(source, { ...options, allowRemote: true } as never),
  ).toEqual(png());
  expect(calls).toBe(1);
  await expect(
    loadMailImage({ ...source, url: "https://127.0.0.1/secret" }, {
      ...options,
      allowRemote: true,
    } as never),
  ).rejects.toThrow("public HTTPS");
  expect(calls).toBe(1);
});

test("streamed remote responses cannot bypass preview size limits with missing headers", async () => {
  let cancelled = false;
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new Uint8Array(MAX_MAIL_IMAGE_BYTES + 1));
    },
    cancel() {
      cancelled = true;
    },
  });
  await expect(
    loadMailImage(
      {
        kind: "remote",
        url: "https://images.example/large.png",
        label: "Large",
        inline: true,
      },
      {
        allowRemote: true,
        getAttachment: async () => {
          throw new Error("Unexpected");
        },
        fetch: async () =>
          new Response(body, { headers: { "content-type": "image/png" } }),
      },
    ),
  ).rejects.toThrow("5 MiB");
  expect(cancelled).toBe(true);
});
