import { describe, expect, test } from 'bun:test';
import {
  projectKnowledgeContextResult,
  projectKnowledgeSearchResult,
} from '../src/search-output';
import { retrieveKnowledgeContextFromSearch } from '../src/retrieval';
import type { HybridSearchResult } from '../src/search';

function searchFixture(text: string): HybridSearchResult {
  return {
    query: 'bounded output',
    limit: 1,
    offset: 0,
    mode: { keyword: true, catalog: true, semantic: false },
    semantic_provider: null,
    semantic_model: null,
    semantic_dimensions: null,
    counts: { keyword_results: 1, catalog_results: 0, semantic_results: 0, merged_results: 1 },
    warnings: [],
    results: [{
      kind: 'source_chunk',
      id: 'chunk_bounded',
      title: 'Bounded output evidence',
      text,
      score: 0.9,
      scores: { keyword: 0.9 },
      source: {
        uri: 'open-files://file/bounded',
        ref: 'open-files://file/bounded',
        kind: 'file',
        revision: 'rev_1',
        hash: 'sha256:bounded',
      },
      citation: { chunk_id: 'chunk_bounded', start_offset: 0, end_offset: text.length },
      artifact: null,
      provenance: null,
      reasons: ['keyword_match'],
    }],
  };
}

describe('knowledge compact search projections', () => {
  test('bounds search rows by preview while explicit full and legacy retain complete text', () => {
    const rawTail = 'RAW_TAIL_MUST_REQUIRE_FULL_DETAIL';
    const result = searchFixture(`${'bounded evidence '.repeat(2_000)}${rawTail}`);
    const legacy = projectKnowledgeSearchResult(result, { detail: 'legacy' }) as HybridSearchResult;
    const full = projectKnowledgeSearchResult(result, { detail: 'full' }) as any;
    const compact = projectKnowledgeSearchResult(result, { detail: 'compact' }) as any;

    expect(legacy).toBe(result);
    expect(full.results[0].text).toEndWith(rawTail);
    expect(compact.detail).toBe('compact');
    expect(compact.results[0].text).toBeUndefined();
    expect(compact.results[0].text_preview.length).toBeLessThanOrEqual(320);
    expect(compact.results[0].text_length).toBe(result.results[0]!.text!.length);
    expect(JSON.stringify(compact)).not.toContain(rawTail);
    expect(Buffer.byteLength(JSON.stringify(compact))).toBeLessThan(4_096);
    expect(Buffer.byteLength(JSON.stringify(compact))).toBeLessThan(Buffer.byteLength(JSON.stringify(full)) * 0.2);
  });

  test('context compact mode keeps one bounded excerpt and removes duplicate raw result/graph bodies', () => {
    const rawTail = 'DUPLICATE_RAW_CONTEXT_TAIL';
    const search = searchFixture(`${'context evidence '.repeat(1_000)}${rawTail}`);
    const context = retrieveKnowledgeContextFromSearch(search, { contextChars: 4_000 });
    context.graph.citations.push({
      id: 'graph_citation',
      chunk_id: 'chunk_bounded',
      wiki_page_id: null,
      source_uri: 'open-files://file/bounded',
      quote: `${'graph duplicate '.repeat(500)}${rawTail}`,
      start_offset: 0,
      end_offset: 100,
    });

    const compact = projectKnowledgeContextResult(context, { detail: 'compact' }) as any;
    const full = projectKnowledgeContextResult(context, { detail: 'full' }) as any;

    expect(compact.results[0].text).toBeUndefined();
    expect(compact.results[0].text_preview).toBeUndefined();
    expect(compact.excerpts[0].text).toBeUndefined();
    expect(compact.excerpts[0].text_preview.length).toBeLessThanOrEqual(520);
    expect(compact.citations[0].quote).toBeUndefined();
    expect(compact.graph.citations[0].quote).toBeUndefined();
    expect(JSON.stringify(compact)).not.toContain(rawTail);
    expect(full.results[0].text).toEndWith(rawTail);
    expect(Buffer.byteLength(JSON.stringify(compact))).toBeLessThan(8_192);
    expect(Buffer.byteLength(JSON.stringify(compact))).toBeLessThan(Buffer.byteLength(JSON.stringify(full)) * 0.25);
  });
});
