import { describe, expect, test } from "bun:test";
import { doctorKnowledgeSourcesViaApi } from "./knowledge-resolver-api.js";
import type { ApiStore } from "../store/api-store.js";
import type { ExtractedTextResult, FileWithTags } from "../types/index.js";

const file: FileWithTags = {
  id: "f_empty", source_id: "src_1", machine_id: "m_1", path: "empty.txt", name: "empty.txt",
  ext: ".txt", size: 0, mime: "text/plain", status: "active", indexed_at: "2026-09-17T00:00:00.000Z",
  created_at: "2026-09-17T00:00:00.000Z", tags: [],
};
const emptyExtraction: ExtractedTextResult = {
  source_ref: "open-files://file/f_empty/revision/rev_empty", file_id: "f_empty", revision_id: "rev_empty",
  status: "empty", mime: "text/plain", bytes_read: 0, total_size: 0, truncated: false, redacted: false,
  segments: [], metadata: { extractor: "hosted-test", max_bytes: 262144, max_segment_chars: 4000, supported_mime: true },
};

describe("hosted knowledge resolver truthfulness", () => {
  test("an actual empty extraction is successful rather than diagnosed as missing", async () => {
    const api = {
      listFiles: async () => [file],
      getFile: async () => file,
      extractFileText: async () => emptyExtraction,
    } as unknown as ApiStore;
    const report = await doctorKnowledgeSourcesViaApi(api);
    expect(report.check_extracted_text).toBe(true);
    expect(report.checks[0]?.status).toBe("ready");
    expect(report.checks[0]?.content.text_available).toBe(true);
    expect(report.checks[0]?.content.extraction_status).toBe("empty");
    expect(report.checks[0]?.issue_codes).toEqual([]);
  });
});
