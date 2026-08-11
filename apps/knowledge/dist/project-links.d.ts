import type { ItemStore } from './item-store.js';
import type { KnowledgeItem } from './store.js';
import type { PoolQueryClient } from './generated/storage-kit/index.js';
export declare const KNOWLEDGE_PROJECT_REGISTRATION_ROUTE: "knowledge.project-registration.v1";
export declare const KNOWLEDGE_PROJECT_RESOURCES_ROUTE: "knowledge.project-resources.v1";
export declare const KNOWLEDGE_PROJECT_REGISTRATION_SCHEMA_VERSION: 1;
export declare const KNOWLEDGE_PROJECT_MEMBERSHIP_RULE: "explicit_collection_binding";
/**
 * Keyset pages fetch exactly one extra producer row to decide whether a
 * continuation cursor is required. Scalar snapshot/count queries are separate
 * and never materialize the resource population.
 */
export declare const KNOWLEDGE_PROJECT_RESOURCE_PAGE_LOOKAHEAD: 1;
export type KnowledgeProjectResourceKind = 'project' | 'collection' | 'item' | 'taxonomy';
export type KnowledgeProjectRegistrationDirection = 'forward' | 'inverse';
export type KnowledgeProjectReceiptAction = 'register_collection' | 'bind_item';
export type KnowledgeProjectReceiptOutcome = 'accepted' | 'terminal_nonacceptance';
export interface KnowledgeProjectAuthorityIdentity {
    authority_id: string;
    tenant_id: string;
    corpus_id: string;
}
export interface KnowledgeProjectRegistrationCapability extends KnowledgeProjectAuthorityIdentity {
    authority: 'knowledge';
    route: typeof KNOWLEDGE_PROJECT_REGISTRATION_ROUTE;
    resource_route: typeof KNOWLEDGE_PROJECT_RESOURCES_ROUTE;
    package_version: string;
    schema_version: typeof KNOWLEDGE_PROJECT_REGISTRATION_SCHEMA_VERSION;
    registration_resource: 'collection';
    supported_resources: ['project', 'collection', 'item', 'taxonomy'];
    stable_project_ids: true;
    stable_collection_ids: true;
    explicit_membership: true;
    membership_rule: typeof KNOWLEDGE_PROJECT_MEMBERSHIP_RULE;
    later_child_binding_required: true;
    bind_existing_items: true;
    immutable_receipts: true;
    exact_terminal_lookup: true;
    exact_readback: true;
    conditional_inverse: true;
    complete_keyset_pagination: true;
    revision_bound_cursors: true;
}
export interface KnowledgeProjectRegistrationRequest extends KnowledgeProjectAuthorityIdentity {
    operation_id: string;
    step_id: string;
    resource_kind: 'collection';
    direction: KnowledgeProjectRegistrationDirection;
    authority_route: string;
    package_version: string;
    target_selector: string;
    idempotency_key: string;
    request_digest: string;
    precondition_digest: string;
    project_id: string;
    project_slug: string;
    project_name: string;
    desired: {
        collection_slug?: string;
        collection_name?: string;
    };
}
export interface KnowledgeProjectItemBindingRequest extends KnowledgeProjectAuthorityIdentity {
    operation_id: string;
    step_id: string;
    direction: KnowledgeProjectRegistrationDirection;
    authority_route: string;
    package_version: string;
    idempotency_key: string;
    request_digest: string;
    precondition_digest: string;
    collection_id: string;
    item_id: string;
}
export interface KnowledgeProjectInverseRequest extends KnowledgeProjectAuthorityIdentity {
    operation_id: string;
    step_id: string;
    authority_route: string;
    package_version: string;
    idempotency_key: string;
    accepted_receipt_id: string;
}
export interface KnowledgeProjectReceiptLookupRequest extends KnowledgeProjectAuthorityIdentity {
    operation_id: string;
    step_id: string;
    action: KnowledgeProjectReceiptAction;
    direction: KnowledgeProjectRegistrationDirection;
    idempotency_key: string;
    max_items: 1;
}
export interface KnowledgeProjectRegistrationReceipt extends KnowledgeProjectAuthorityIdentity {
    receipt_id: string;
    authority: 'knowledge';
    route: typeof KNOWLEDGE_PROJECT_REGISTRATION_ROUTE;
    package_version: string;
    operation_id: string;
    step_id: string;
    action: KnowledgeProjectReceiptAction;
    resource_kind: 'collection' | 'item';
    direction: KnowledgeProjectRegistrationDirection;
    idempotency_key: string;
    request_digest: string;
    precondition_digest: string;
    outcome: KnowledgeProjectReceiptOutcome;
    reason: string | null;
    source_project_id: string | null;
    project_id: string | null;
    collection_id: string | null;
    item_id: string | null;
    result_revision: string | null;
    result_digest: string | null;
    accepted_receipt_id: string | null;
    created_by_operation: boolean;
    created_at: string;
}
export interface KnowledgeProjectCollectionRecord {
    source_project_id: string;
    project_id: string;
    project_slug: string;
    project_name: string;
    collection_id: string;
    collection_slug: string;
    collection_name: string;
    membership_rule: typeof KNOWLEDGE_PROJECT_MEMBERSHIP_RULE;
    revision: string;
    digest: string;
    created_at: string;
    updated_at: string;
}
export interface KnowledgeProjectItemBindingRecord {
    collection_id: string;
    item_id: string;
    revision: string;
    digest: string;
    bound_at: string;
}
export interface KnowledgeProjectInverseVerification {
    accepted_receipt_id: string;
    target_id: string;
    absent: true;
    digest: string;
}
export interface KnowledgeProjectResource {
    key: string;
    kind: KnowledgeProjectResourceKind;
    id: string;
    project_id: string;
    source_project_id: string;
    collection_id: string;
    revision: string;
    digest: string;
    title: string;
    locator: {
        kind: 'external_uuid' | 'canonical_uri';
        value: string;
    };
    metadata: Record<string, unknown>;
}
export interface KnowledgeProjectResourcePage {
    schema: 'knowledge.project-resources.page.v1';
    authority: 'knowledge';
    route: typeof KNOWLEDGE_PROJECT_RESOURCES_ROUTE;
    authority_id: string;
    tenant_id: string;
    corpus_id: string;
    project_id: string;
    source_project_id: string;
    collection_id: string;
    collection_revision: string;
    population_digest: string;
    resource_kinds: KnowledgeProjectResourceKind[];
    resources: KnowledgeProjectResource[];
    count: number;
    total: number;
    limit: number;
    cursor: string | null;
    next_cursor: string | null;
    has_more: boolean;
    complete: boolean;
    truncated: false;
}
export interface KnowledgeProjectResourceListOptions {
    limit?: number;
    cursor?: string | null;
    kinds?: KnowledgeProjectResourceKind[];
}
export interface KnowledgeProjectLinksAuthority {
    close(): Promise<void>;
    capability(): Promise<KnowledgeProjectRegistrationCapability>;
    registerCollection(request: KnowledgeProjectRegistrationRequest): Promise<KnowledgeProjectRegistrationReceipt>;
    readCollection(collectionId: string): Promise<KnowledgeProjectCollectionRecord>;
    lookupReceipt(request: KnowledgeProjectReceiptLookupRequest): Promise<KnowledgeProjectRegistrationReceipt>;
    compensateRegistration(request: KnowledgeProjectInverseRequest): Promise<KnowledgeProjectRegistrationReceipt>;
    verifyRegistrationInverse(request: KnowledgeProjectInverseRequest): Promise<KnowledgeProjectInverseVerification>;
    bindItem(request: KnowledgeProjectItemBindingRequest): Promise<KnowledgeProjectRegistrationReceipt>;
    readItemBinding(collectionId: string, itemId: string): Promise<KnowledgeProjectItemBindingRecord>;
    compensateItemBinding(request: KnowledgeProjectInverseRequest): Promise<KnowledgeProjectRegistrationReceipt>;
    verifyItemBindingInverse(request: KnowledgeProjectInverseRequest): Promise<KnowledgeProjectInverseVerification>;
    listProjectResources(projectId: string, options?: KnowledgeProjectResourceListOptions): Promise<KnowledgeProjectResourcePage>;
    readProjectResource(projectId: string, kind: KnowledgeProjectResourceKind, resourceId: string): Promise<KnowledgeProjectResource>;
    readAllProjectResources(projectId: string, options?: Omit<KnowledgeProjectResourceListOptions, 'cursor'>): Promise<KnowledgeProjectResource[]>;
}
export type KnowledgeProjectLinksErrorCode = 'KNOWLEDGE_PROJECT_LINKS_INVALID_INPUT' | 'KNOWLEDGE_PROJECT_LINKS_CAPABILITY_MISMATCH' | 'KNOWLEDGE_PROJECT_LINKS_DIGEST_MISMATCH' | 'KNOWLEDGE_PROJECT_LINKS_IDEMPOTENCY_MISMATCH' | 'KNOWLEDGE_PROJECT_LINKS_CONFLICT' | 'KNOWLEDGE_PROJECT_LINKS_NOT_FOUND' | 'KNOWLEDGE_PROJECT_LINKS_CURSOR_STALE' | 'KNOWLEDGE_PROJECT_LINKS_INCOMPLETE_POPULATION' | 'KNOWLEDGE_PROJECT_LINKS_INVALID_RESPONSE';
export declare class KnowledgeProjectLinksError extends Error {
    readonly code: KnowledgeProjectLinksErrorCode;
    readonly details: Record<string, unknown>;
    constructor(code: KnowledgeProjectLinksErrorCode, message: string, details?: Record<string, unknown>);
}
export interface KnowledgeProjectLinksAuthorityOptions {
    authorityId: string;
    tenantId: string;
    corpusId: string;
    packageVersion: string;
    now?: () => string;
}
export declare function sqliteKnowledgeProjectLinksSchemaSql(): string;
export declare function postgresKnowledgeProjectLinksSchemaStatements(): string[];
export declare function canonicalKnowledgeProjectLinksJson(value: unknown): string;
export declare function digestKnowledgeProjectLinksValue(value: unknown): string;
export declare function createLocalKnowledgeProjectLinksAuthority(input: {
    databasePath: string;
    itemStore: ItemStore;
    options: KnowledgeProjectLinksAuthorityOptions;
}): KnowledgeProjectLinksAuthority;
export declare function createPostgresKnowledgeProjectLinksAuthority(input: {
    client: PoolQueryClient;
    itemResolver: (id: string) => Promise<KnowledgeItem | null>;
    options: KnowledgeProjectLinksAuthorityOptions;
}): KnowledgeProjectLinksAuthority;
export declare function knowledgeProjectLinksErrorResponse(error: unknown): Response;
export interface KnowledgeProjectLinksHttpClientOptions {
    baseUrl: string;
    apiKey?: string;
    fetch?: (input: string | URL | Request, init?: RequestInit) => Promise<Response>;
    headers?: Record<string, string>;
}
export declare class KnowledgeProjectLinksHttpClient implements KnowledgeProjectLinksAuthority {
    private readonly options;
    private readonly fetchImpl;
    private readonly root;
    constructor(options: KnowledgeProjectLinksHttpClientOptions);
    close(): Promise<void>;
    private headers;
    private request;
    capability(): Promise<KnowledgeProjectRegistrationCapability>;
    registerCollection(request: KnowledgeProjectRegistrationRequest): Promise<KnowledgeProjectRegistrationReceipt>;
    readCollection(collectionId: string): Promise<KnowledgeProjectCollectionRecord>;
    lookupReceipt(request: KnowledgeProjectReceiptLookupRequest): Promise<KnowledgeProjectRegistrationReceipt>;
    compensateRegistration(request: KnowledgeProjectInverseRequest): Promise<KnowledgeProjectRegistrationReceipt>;
    verifyRegistrationInverse(request: KnowledgeProjectInverseRequest): Promise<KnowledgeProjectInverseVerification>;
    bindItem(request: KnowledgeProjectItemBindingRequest): Promise<KnowledgeProjectRegistrationReceipt>;
    readItemBinding(collectionId: string, itemId: string): Promise<KnowledgeProjectItemBindingRecord>;
    compensateItemBinding(request: KnowledgeProjectInverseRequest): Promise<KnowledgeProjectRegistrationReceipt>;
    verifyItemBindingInverse(request: KnowledgeProjectInverseRequest): Promise<KnowledgeProjectInverseVerification>;
    listProjectResources(projectId: string, options?: KnowledgeProjectResourceListOptions): Promise<KnowledgeProjectResourcePage>;
    readProjectResource(projectId: string, kind: KnowledgeProjectResourceKind, resourceId: string): Promise<KnowledgeProjectResource>;
    readAllProjectResources(projectId: string, options?: Omit<KnowledgeProjectResourceListOptions, 'cursor'>): Promise<KnowledgeProjectResource[]>;
}
export declare function createKnowledgeProjectLinksHttpClient(options: KnowledgeProjectLinksHttpClientOptions): KnowledgeProjectLinksAuthority;
