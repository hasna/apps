/**
 * Response marker proving that the server applied the bounded Knowledge query
 * contract. New clients require it whenever an older server could otherwise
 * ignore a query field and return a plausible, but semantically wrong, page.
 */
export declare const KNOWLEDGE_BOUNDED_QUERY_CAPABILITY: 'hasna.knowledge.bounded-query.v1';
export interface KnowledgeBoundedQueryEnvelope {
    query_capability: typeof KNOWLEDGE_BOUNDED_QUERY_CAPABILITY;
}
export declare function hasKnowledgeBoundedQueryCapability(value: unknown): value is KnowledgeBoundedQueryEnvelope;
