import { expect, test } from "bun:test";
import { mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { attachmentDownloadValidation } from "./attachment-download.js";
import { reserveDarwinControlledReceipt } from "./controlled-send-darwin.js";

for (const stage of ["before", "after"] as const) {
  test.skipIf(process.platform !== "darwin")(`Darwin receipt rejects same-size mutation ${stage} publication`, async () => {
    const parent = mkdtempSync(join(realpathSync(tmpdir()), "controlled-integrity-"));
    const path = join(parent, "receipt.json");
    const original = attachmentDownloadValidation.assertTrustedOutputPath;
    let mutated = false;
    try {
      const reservation = await reserveDarwinControlledReceipt(path);
      attachmentDownloadValidation.assertTrustedOutputPath = async (...args) => {
        await original(...args);
        const pending = readdirSync(parent).find(name => name.endsWith(".pending"));
        if (!mutated && pending && existsSync(path) === (stage === "after")) {
          const target = join(parent, pending);
          const body = readFileSync(target, "utf8");
          if (body.includes('"sent"')) {
            writeFileSync(target, body.replace('"sent"', '"fake"'));
            mutated = true;
          }
        }
      };
      await expect(reservation.finalize({ terminal_state: "sent" })).rejects.toThrow("receipt bytes changed");
      expect(mutated).toBe(true);
      expect(readdirSync(parent).some(name => name.endsWith(".pending"))).toBe(true);
      expect(existsSync(path)).toBe(false);
      await expect(reserveDarwinControlledReceipt(path)).rejects.toThrow();
    } finally {
      attachmentDownloadValidation.assertTrustedOutputPath = original;
      rmSync(parent, { recursive: true, force: true });
    }
  });
}
