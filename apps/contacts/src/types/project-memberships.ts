export type ContactProjectMembershipMutationDirection = "attach" | "detach";

export interface ContactProjectMembershipSnapshot {
  contact_id: string;
  project_id: string;
  linked: boolean;
  version: string;
}

export interface ContactProjectMembershipMutationInput {
  contact_id: string;
  project_id: string;
  operation_id: string;
  step_id: string;
  expected_version: string;
}

export interface ContactProjectMembershipMutationResult {
  outcome: "accepted" | "duplicate_of_accepted";
  operation_id: string;
  step_id: string;
  before: ContactProjectMembershipSnapshot;
  after: ContactProjectMembershipSnapshot;
  receipt_id: string;
}

export interface ContactProjectMembershipListResult {
  project_id: string;
  contact_ids: string[];
  complete: true;
  membership_revision: string;
}

export class ContactProjectMembershipConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ContactProjectMembershipConflictError";
  }
}
