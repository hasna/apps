// The seam itself: what a store IS.
//
// The configured HTTP client is the sole implicit client transport. PostgreSQL is
// internal service storage, reached through the API, never a client transport.
// The explicit SQLite adapter remains for caller-supplied Database compatibility
// and fixtures; it is not selected by missing or invalid client configuration.
//
// Product repositories and library functions already consume this contract through
// src/store-resolution.ts; src/storage.ts also exposes its types and explicit
// adapters. Retained raw exports and implementation arms have not all disappeared.
// The shared conformance suite checks both concrete adapters against the same async
// outcomes, so an unavailable capability must refuse truthfully rather than return
// plausible wrong data. That consistency check is not full feature acceptance.

import type { StoreCapabilities } from "./capabilities.js";
import type { StoreDescriptor } from "./descriptor.js";
import type {
  AddressLifecycleRepository,
  AddressesRepository,
  AliasesRepository,
  AttachmentRepairRepository,
  ContactsRepository,
  DomainsRepository,
  EmailContentRepository,
  EmailDigestsRepository,
  EventsRepository,
  ForwardingRepository,
  GroupsRepository,
  InboundRepository,
  IngestionSourceInventoryRepository,
  MailboxFiltersRepository,
  MessagesRepository,
  OwnersRepository,
  ProvidersRepository,
  PrioritySenderRulesRepository,
  ProvisioningRepository,
  SandboxRepository,
  ScheduledRepository,
  SendIntentsRepository,
  SendKeysRepository,
  SequencesRepository,
  TemplatesRepository,
  ThreadsRepository,
  WarmingRepository,
  WebhookReceiptsRepository,
} from "./repositories.js";

export interface EmailStore {
  /**
   * DIAGNOSTICS ONLY. Branching on this is forbidden — see descriptor.ts for the
   * shape that makes it impractical and for what happened the last time a label like
   * this was allowed to narrow.
   */
  readonly descriptor: StoreDescriptor;

  /**
   * What this store can do. When a capability is false, every operation that needs it
   * has exactly ONE legal answer: the typed refusal from `capabilityRefusal()`. Never
   * an empty array, never a zero, never a silent no-op.
   */
  readonly capabilities: StoreCapabilities;

  // One repository per `src/db/*` family, named so the correspondence with today's
  // code is checkable by eye and by the seam guard.
  readonly domains: DomainsRepository;
  readonly addresses: AddressesRepository;
  readonly addressLifecycle: AddressLifecycleRepository;
  readonly provisioning: ProvisioningRepository;
  readonly messages: MessagesRepository;
  readonly mailboxFilters: MailboxFiltersRepository;
  readonly emailContent: EmailContentRepository;
  readonly inbound: InboundRepository;
  readonly threads: ThreadsRepository;
  readonly sandbox: SandboxRepository;
  /** Priority sender rules are persisted resources, scoped to this store's tenant/mailbox. */
  readonly prioritySenderRules?: PrioritySenderRulesRepository;
  /** Optional for older injected stores; absence is unsupported, never an empty inventory. */
  readonly sourceInventory?: IngestionSourceInventoryRepository;
  readonly emailDigests: EmailDigestsRepository;
  readonly scheduled: ScheduledRepository;
  readonly events: EventsRepository;
  readonly webhookReceipts: WebhookReceiptsRepository;
  readonly contacts: ContactsRepository;
  readonly groups: GroupsRepository;
  readonly sequences: SequencesRepository;
  readonly templates: TemplatesRepository;
  readonly owners: OwnersRepository;
  readonly providers: ProvidersRepository;
  readonly sendKeys: SendKeysRepository;
  readonly aliases: AliasesRepository;
  readonly forwarding: ForwardingRepository;
  readonly warming: WarmingRepository;

  // Families the STRONGEST arm has and `src/db/*` never did. They are declared here,
  // rather than deferred, because they are the reason the seam is shaped this way: the
  // send-intent ledger is what makes synchronous repositories impossible, and both are
  // the clearest cases of a capability that a store must refuse rather than fake.
  readonly sendIntents: SendIntentsRepository;
  readonly attachmentRepair: AttachmentRepairRepository;
}

/** Complete store surface used by the concrete SQLite and HTTP implementations. */
export interface PrioritySenderRulesStore {
  readonly prioritySenderRules: PrioritySenderRulesRepository;
}

/** Both concrete adapters implement the complete read-only inventory extension. */
export interface SourceInventoryStore {
  readonly sourceInventory: IngestionSourceInventoryRepository;
}
