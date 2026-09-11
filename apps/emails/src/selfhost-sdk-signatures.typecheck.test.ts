import type {
  AttachmentBatchMeta,
  AttachmentMeta,
  EmailsSelfHostClient,
  Message,
  MessageListItem,
  SendKey,
  Tenant,
} from "./selfhost.js";

type Equal<Left, Right> =
  (<Type>() => Type extends Left ? 1 : 2) extends
  (<Type>() => Type extends Right ? 1 : 2)
    ? true
    : false;
type Assert<Value extends true> = Value;
type Result<Method extends keyof EmailsSelfHostClient> =
  EmailsSelfHostClient[Method] extends (...args: never[]) => infer Return
    ? Awaited<Return>
    : never;

type BootstrapResult = Result<"bootstrapPrimarySuperAdmin">;
type PrincipalResult = Result<"getCurrentPrincipal">;
type UserPrincipal = Extract<PrincipalResult, { principal_type: "user" }>;
type VerifiedEmailResult = Result<"verifyEmailToken">;
type VerifySendKeyResult = Result<"verifySendKey">;
type SendResult = Result<"sendMessage">;
type BatchAttachmentsResult = Result<"batchAttachments">;

export type NullableTenantRegression =
  Assert<Equal<BootstrapResult["tenant"], Tenant | null>>;
export type NullableUserRegression =
  Assert<Equal<UserPrincipal["user"], VerifiedEmailResult["user"] | null>>;
export type NullableKeyRegression =
  Assert<Equal<VerifySendKeyResult["key"], SendKey | null>>;
export type ReplaySendRegression =
  Assert<Equal<
    Extract<SendResult, { idempotent_replay: true }>["provider_message_id"],
    string
  >>;
export type InProgressSendRegression =
  Assert<Equal<Extract<SendResult, { in_progress: true }>["in_progress"], true>>;
export type AcceptedSendRegression =
  Assert<Equal<
    Extract<SendResult, { sent: true; idempotent_replay?: never }>["provider_message_id"],
    string
  >>;
export type HistoricalAttachmentSlotRegression =
  Assert<Equal<Message["attachments"], Array<AttachmentMeta | null>>>;
export type BatchAttachmentMetadataRegression =
  Assert<Equal<
    BatchAttachmentsResult["by_message_id"],
    Record<string, Array<AttachmentBatchMeta>>
  >>;

type ApplyMethod = EmailsSelfHostClient["applyMailboxFilter"];
type ApplyResult = Result<"applyMailboxFilter">;

// FR-0001: the legacy 3-arg invocation (id + optional query/init, no body)
// remains valid — its params keep their old shapes at positions 1 and 2, and
// the body is an OPTIONAL 4th parameter, not a merged-in query field.
export type ApplyLegacyQueryParamRegression =
  Assert<Equal<
    Parameters<ApplyMethod>[1],
    { "limit"?: number; "offset"?: number } | undefined
  >>;
export type ApplyMutateBodyIsOptionalParamRegression =
  Assert<Equal<Parameters<ApplyMethod>[3], { "mutate"?: boolean } | undefined>>;

// FR-0001: the list-only apply response keeps the pre-existing required shape…
export type ApplyListOnlyResponseShapeRegression =
  Assert<Equal<
    Pick<ApplyResult, "filter" | "items" | "limit" | "offset" | "truncated">,
    {
      filter: Record<string, unknown>;
      items: Array<MessageListItem>;
      limit: number;
      offset: number;
      truncated: boolean;
    }
  >>;
// …and the mutate response widens it with mutate:true plus integer counters.
export type ApplyMutateResponseShapeRegression =
  Assert<Equal<
    {
      mutate: NonNullable<ApplyResult["mutate"]>;
      matched: NonNullable<ApplyResult["matched"]>;
      updated: NonNullable<ApplyResult["updated"]>;
      unchanged: NonNullable<ApplyResult["unchanged"]>;
    },
    { mutate: true; matched: number; updated: number; unchanged: number }
  >>;
