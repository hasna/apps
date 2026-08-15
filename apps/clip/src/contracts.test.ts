import { describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SCHEMA_IDS } from "@hasna/contracts";
import { buildClipEvidenceRef, buildClipResourceRefs } from "./contracts.js";
import { ClipStore } from "./storage.js";

describe("clip contract builders", () => {
  it("maps screenshot clips to screenshot evidence and artifact/share resources", () => {
    const dir = mkdtempSync(join(tmpdir(), "clip-contracts-"));
    try {
      const image = join(dir, "screen.png");
      writeFileSync(image, "fake screenshot bytes");
      const store = new ClipStore({ homeDir: dir, baseUrl: "http://clip.test:3741" });
      try {
        const record = store.createFileClip({
          path: image,
          kind: "screenshot",
          mimeType: "image/png",
          title: "Focused window",
          source: "capture:test",
        });
        const evidence = buildClipEvidenceRef(record);
        const resources = buildClipResourceRefs(record);

        expect(evidence.schema).toBe(SCHEMA_IDS.evidenceRef);
        expect(evidence.kind).toBe("screenshot");
        expect(evidence.sha256).toBe(record.sha256);
        expect(evidence.contentType).toBe("image/png");
        expect(evidence.sizeBytes).toBe(record.sizeBytes);
        expect(evidence.resourceRefs).toHaveLength(2);
        expect(evidence.resourceRefs.map((ref) => ref.kind).sort()).toEqual(["artifact", "url"]);
        expect(resources.map((ref) => ref.schema)).toEqual([SCHEMA_IDS.resourceRef, SCHEMA_IDS.resourceRef]);
        expect(resources.find((ref) => ref.kind === "artifact")?.uri).toStartWith("artifact://@hasna/clip/clips/");
        expect(resources.find((ref) => ref.kind === "url")?.uri).toBe(record.shareUrl);
        expect(JSON.stringify({ evidence, resources })).not.toContain(image);
        expect(JSON.stringify({ evidence, resources })).not.toContain("artifactPath");
      } finally {
        store.close();
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
