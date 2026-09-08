/** PostgreSQL intake evidence. accepted means sink durability, not downstream delivery. */
export interface EventsDrainReceipt {
  protocol: "conversations.events-delivery.v1";
  scanned: number;
  accepted: number;
  retryable: number;
  quarantined: number;
  lost_claim: number;
  transported: number;
  skipped: number;
  spooled: 0;
}

/** Value-free inspection of one frozen intent; never returns the event payload or credentials. */
export interface EventDeliveryStatus {
  outbox_id: string;
  tenant_id: string;
  corpus_id: string;
  authority_id: string;
  envelope_sha256: string;
  state: "pending" | "leased" | "retryable" | "accepted" | "quarantined";
  sink_id: string | null;
  producer_id: string | null;
  generation: string;
  attempts: number;
  external_may_exist: boolean;
  reconciliation_required: boolean;
  receipt_id: string | null;
  accepted_at: string | null;
  error_code: string | null;
}
