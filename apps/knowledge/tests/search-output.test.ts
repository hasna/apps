import { describe, expect, test } from 'bun:test';
import {
  KNOWLEDGE_COMPACT_RESPONSE_MAX_BYTES,
  projectKnowledgeContextResult,
  projectKnowledgeSearchResult,
  stringifyKnowledgeCompactResponse,
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
  test('adversarial search output is deterministically row-trimmed under the whole-response ceiling', () => {
    const result = searchFixture('x'.repeat(100_000));
    result.query = 'query '.repeat(20_000);
    result.warnings = Array.from({ length: 100 }, (_, index) => `warning-${index}-${'w'.repeat(2_000)}`);
    result.results = Array.from({ length: 300 }, (_, index) => ({
      ...result.results[0]!,
      id: `chunk_${String(index).padStart(4, '0')}_${'i'.repeat(1_000)}`,
      title: `title-${index}-${'t'.repeat(2_000)}`,
      text: `${index}:${'body '.repeat(30_000)}SEARCH_RAW_TAIL_${index}`,
      reasons: Array.from({ length: 40 }, (_, reason) => `reason-${reason}-${'r'.repeat(500)}`),
      source: { ...result.results[0]!.source!, uri: `open-files://file/${index}/${'u'.repeat(2_000)}` },
    }));

    const first = projectKnowledgeSearchResult(result, { detail: 'compact' }) as any;
    const second = projectKnowledgeSearchResult(result, { detail: 'compact' }) as any;
    const firstText = stringifyKnowledgeCompactResponse({ ok: true, ...first, message: `${result.results.length} search result(s)` });
    const secondText = stringifyKnowledgeCompactResponse({ ok: true, ...second, message: `${result.results.length} search result(s)` });

    expect(firstText).toBe(secondText);
    expect(Buffer.byteLength(firstText)).toBeLessThanOrEqual(KNOWLEDGE_COMPACT_RESPONSE_MAX_BYTES);
    expect(first.response_budget.complete).toBe(false);
    expect(first.response_budget.omitted_results).toBeGreaterThan(0);
    expect(first.results.length).toBeGreaterThan(0);
    expect(firstText).not.toContain('SEARCH_RAW_TAIL_0');
  });

  test('adversarial context output trims duplicate evidence under the same whole-response ceiling', () => {
    const search = searchFixture('context '.repeat(20_000));
    search.results = Array.from({ length: 160 }, (_, index) => ({
      ...search.results[0]!,
      id: `context_${index}`,
      text: `${index}:${'context body '.repeat(10_000)}CONTEXT_RAW_TAIL_${index}`,
      title: `context title ${index}`,
    }));
    const context = retrieveKnowledgeContextFromSearch(search, { contextChars: 8_000 });
    context.graph.backlinks = Array.from({ length: 400 }, (_, index) => ({
      from_page_id: `from-${index}-${'f'.repeat(1_000)}`,
      to_page_id: `to-${index}-${'t'.repeat(1_000)}`,
      label: `label-${index}-${'l'.repeat(1_000)}`,
    }));

    const compact = projectKnowledgeContextResult(context, { detail: 'compact' }) as any;
    const text = stringifyKnowledgeCompactResponse({ ok: true, ...compact, message: `${context.excerpts.length} context excerpt(s)` });

    expect(Buffer.byteLength(text)).toBeLessThanOrEqual(KNOWLEDGE_COMPACT_RESPONSE_MAX_BYTES);
    expect(compact.response_budget.complete).toBe(false);
    expect(compact.response_budget.omitted.backlinks).toBeGreaterThan(0);
    expect(text).not.toContain('CONTEXT_RAW_TAIL_0');
  });

});
