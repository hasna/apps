import { extractTextFromBuffer, extractTextFromFile, type ExtractTextFromBufferInput, type ExtractTextOptions } from "./extraction.js";
import { buildExtractionSnapshot } from "./extraction-snapshot-core.js";
import type { ExtractionSnapshot } from "../types/index.js";

export { buildExtractionSnapshot } from "./extraction-snapshot-core.js";

export type ExtractionSnapshotOptions = ExtractTextOptions;

export async function extractTextSnapshotFromFile(fileId: string, opts: ExtractionSnapshotOptions = {}): Promise<ExtractionSnapshot> {
  return buildExtractionSnapshot(await extractTextFromFile(fileId, opts));
}

export function extractTextSnapshotFromBuffer(input: ExtractTextFromBufferInput): ExtractionSnapshot {
  return buildExtractionSnapshot(extractTextFromBuffer(input));
}
