import { describe, expect, it } from "bun:test";
import { createShareQrCode, encodedQrPayloads, renderShareQrCode } from "./qr.js";

describe("share QR codes", () => {
  it("encodes the exact share URL payload", async () => {
    const shareUrl = "http://phone.lan:3741/s/exact-slug";
    const qr = createShareQrCode(shareUrl);

    expect(encodedQrPayloads(qr)).toEqual([shareUrl]);
    expect(qr.modules.size).toBeGreaterThan(0);

    const rendered = await renderShareQrCode(shareUrl);
    expect(rendered.payload).toBe(shareUrl);
    expect(rendered.terminal).toContain("\u001b[40m");
    expect(rendered.terminal).toContain("\u001b[47m");
    expect(rendered.size).toBe(qr.modules.size);
  });
});
