import type { CapsuleReceipt } from "../capsule.js";
import type { Entry } from "./domain.js";

/** Short-lived transfer grants stay inside clients; normal list/get never return them. */
export type TransferGrant = { url: string; method: "PUT" | "GET"; headers: Record<string, string>; expiresAt: string };
export interface TrashObjects {
  ready(): Promise<void>;
  upload(entry: Entry): Promise<TransferGrant>;
  /** Independently checks complete artifact bytes and manifest from immutable storage. */
  verify(entry: Entry): Promise<{ version: string; receipt: CapsuleReceipt }>;
  download(entry: Entry): Promise<TransferGrant>;
  /** Exact-version deletion only; retrying an already absent version succeeds. */
  remove(entry: Entry): Promise<void>;
}
