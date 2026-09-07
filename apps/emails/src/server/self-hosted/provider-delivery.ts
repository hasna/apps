export interface ProviderDeliveryObservation {
  type: "sent" | "delivered" | "bounced" | "complained" | "opened" | "clicked" | "failed";
  recipient?: string;
  occurredAt?: string;
  /** True only when the provider supplies permanent-bounce evidence. */
  permanentBounce?: boolean;
}
export interface ProviderDeliveryRead {
  observations: ProviderDeliveryObservation[];
  evidence: "event_history" | "current_status";
}
