/**
 * Response marker proving that the server applied the bounded Knowledge query
 * contract. New clients require it whenever an older server could otherwise
 * ignore a query field and return a plausible, but semantically wrong, page.
 */
export const KNOWLEDGE_BOUNDED_QUERY_CAPABILITY = 'hasna.knowledge.bounded-query.v1' as const;

export interface KnowledgeBoundedQueryEnvelope {
  query_capability: typeof KNOWLEDGE_BOUNDED_QUERY_CAPABILITY;
}

export function hasKnowledgeBoundedQueryCapability(value: unknown): value is KnowledgeBoundedQueryEnvelope {
  return Boolean(
    value
    && typeof value === 'object'
    && (value as { query_capability?: unknown }).query_capability === KNOWLEDGE_BOUNDED_QUERY_CAPABILITY,
  );
}
