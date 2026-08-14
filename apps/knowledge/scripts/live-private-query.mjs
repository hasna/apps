#!/usr/bin/env bun
import { randomUUID } from 'node:crypto';
import {
  createKnowledgeGuardedWriter,
  createKnowledgePrivateQueryDescriptor,
  inspectKnowledgePrivateResult,
} from '../dist/index.js';

const PASS = 'PRIVATE_QUERY_ACCEPTANCE PASS bounded=true private=true requests=1 limit=2';
const FAIL = 'PRIVATE_QUERY_ACCEPTANCE FAIL';

function required(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error('missing live private-query configuration');
  return value;
}

async function main() {
  const binding = {
    authority: {
      classification: required('HASNA_KNOWLEDGE_AUTHORITY_CLASSIFICATION'),
      authority_id: required('HASNA_KNOWLEDGE_AUTHORITY_ID'),
    },
    tenant_id: required('HASNA_KNOWLEDGE_PRIVATE_QUERY_TENANT_ID'),
    scope: process.env.HASNA_KNOWLEDGE_PRIVATE_QUERY_SCOPE?.trim() || 'global',
    parent_id: process.env.HASNA_KNOWLEDGE_PRIVATE_QUERY_PARENT_ID?.trim() || 'global:global',
  };

  // The selector is created only in process memory. It is not accepted through
  // argv, environment, stdin, or a file, and no serialized or error surface
  // contains it. A guaranteed-absent random exact title is a live negative
  // control for the authenticated producer route.
  const privateSelector = `knowledge-private-query-live-${randomUUID()}`;
  const descriptor = createKnowledgePrivateQueryDescriptor({
    operation_id: `live-private-query-${randomUUID()}`,
    step_id: 'bounded-private-query',
    binding,
    selector: { kind: 'exact_title', title: privateSelector },
    archive: 'all',
    limit: 2,
    offset: 0,
  });

  const originalFetch = globalThis.fetch;
  let requests = 0;
  globalThis.fetch = async (input, init) => {
    const url = new URL(
      typeof input === 'string' || input instanceof URL ? input : input.url,
    );
    if (url.pathname === '/v1/guarded-writes/queries') requests += 1;
    return originalFetch(input, init);
  };

  try {
    const result = await createKnowledgeGuardedWriter({ binding }).query(descriptor, {
      max_calls: 1,
      max_items: 2,
      max_bytes: 1_048_576,
      wall_time_ms: 10_000,
    });
    const proof = inspectKnowledgePrivateResult(result);
    const serialized = [
      JSON.stringify(descriptor),
      JSON.stringify(result),
      JSON.stringify(proof),
    ].join('\n');
    if (
      requests !== 1
      || proof.kind !== 'query'
      || proof.query_kind !== 'exact_title'
      || proof.item_count !== 0
      || proof.total !== 0
      || proof.page?.limit !== 2
      || proof.page?.offset !== 0
      || proof.page?.returned !== 0
      || proof.page?.has_more !== false
      || serialized.includes(privateSelector)
      || serialized.includes(descriptor.descriptor_id)
    ) {
      throw new Error('live private-query acceptance mismatch');
    }
    console.log(PASS);
  } finally {
    globalThis.fetch = originalFetch;
  }
}

main().catch(() => {
  console.error(FAIL);
  process.exitCode = 1;
});
