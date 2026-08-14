export interface SyncResult {
  pushed: number;
  pulled: number;
  errors: string[];
}

export type SyncPrefer = "local" | "remote";

export interface SyncConflict {
  agent: string;
  direction: "push" | "pull";
  prefer: SyncPrefer;
  local_updated_at?: string;
  remote_updated_at?: string;
  detected_at: string;
  notes?: string;
}
