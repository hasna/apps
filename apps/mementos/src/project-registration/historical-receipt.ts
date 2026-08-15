// Ported from iapp-mementos 49113a8. The source imported ROOT_TENANT_ID from
// ../db/tenancy.js (the iapp R1 tenancy layer, absent from the monorepo home);
// the constant value is inlined verbatim (adfd95c7-ee8b-52cb-ae47-4ae65dae3313).
const ROOT_TENANT_ID = "adfd95c7-ee8b-52cb-ae47-4ae65dae3313" as const;
import type {
  MementosProjectRegistrationCapability,
  MementosProjectRegistrationHistoricalLookupIdentity,
  MementosProjectRegistrationReceipt,
  MementosProjectRegistrationResponseControl,
} from "./types.js";

export const FLEET_RESOURCES_HISTORICAL_PROJECT_REGISTRATION = {
  authority: "mementos",
  authority_route: "mementos.project-registration.v1",
  package_version: "1.0.0-rc.3",
  authority_id: "mementos",
  tenant_id: "default",
  corpus_id: "default",
  operation_id: "op-cli-register-full",
  step_id: "mementos_project",
  resource_kind: "project",
  direction: "forward",
  target_selector: "wks_005285827590a93b70e5",
  target_id: "mm_project_f75606ef14e51fb577a15882ba0ab8ed333b2c29",
  idempotency_key: "prk_786cdc6babddeae1be8d5078d0f75322d1ea1010ac5d8a50",
  receipt_id: "mmpr_a647f9908a33bb64bf137f584202590f91b72a33",
  request_digest: "8eb0e3fee26fdb7edb8a444aeddaaedb79a84a5a36e742ae03616f62b19f5c22",
  precondition_digest: "0b6c22fcf75d835f9f27308b1a9d40e8902e48a97da370fd56df5acacfcd968e",
  result_revision: "2026-08-09T13:37:43.068Z",
  result_digest: "26fb0dd5c5e20909d3653ab0ddd8fa45e5142728e4e66d595e2419f7ed40b036",
  created_at: "2026-08-09T13:37:43.068Z",
  identity_digest: "1108dd972c90e4989036fb6ecec7dde10f54641a697bd53cfcd64017f589ace7",
  target_digest: "72789fcd60668eeb66ee068936d3afa96deadcb007228830c64b6de783b6dcef",
  operation_digest: "d7e37bfb2c0d28f8c4086c53224cd855d14694f32807b74c102b61a99963f3c0",
  idempotency_digest: "b56d8ec37efb818759cdd2ee3b58bc1401ac13384c8d64c1813bb5c198b1e376",
  receipt_digest: "52ce90c5de6817989f107d9d27e06156962a2b9c365e34e16a57aa37886501a2",
  response_digest: "2fa3ed508f5f192c18753b1205ced996340fdf02f735420d32db897fc239805c",
} as const;

export const FLEET_RESOURCES_HISTORICAL_RECEIPT:
MementosProjectRegistrationReceipt = {
  receipt_id: FLEET_RESOURCES_HISTORICAL_PROJECT_REGISTRATION.receipt_id,
  authority: FLEET_RESOURCES_HISTORICAL_PROJECT_REGISTRATION.authority,
  route: FLEET_RESOURCES_HISTORICAL_PROJECT_REGISTRATION.authority_route,
  package_version: FLEET_RESOURCES_HISTORICAL_PROJECT_REGISTRATION.package_version,
  authority_id: FLEET_RESOURCES_HISTORICAL_PROJECT_REGISTRATION.authority_id,
  tenant_id: FLEET_RESOURCES_HISTORICAL_PROJECT_REGISTRATION.tenant_id,
  corpus_id: FLEET_RESOURCES_HISTORICAL_PROJECT_REGISTRATION.corpus_id,
  operation_id: FLEET_RESOURCES_HISTORICAL_PROJECT_REGISTRATION.operation_id,
  step_id: FLEET_RESOURCES_HISTORICAL_PROJECT_REGISTRATION.step_id,
  resource_kind: FLEET_RESOURCES_HISTORICAL_PROJECT_REGISTRATION.resource_kind,
  direction: FLEET_RESOURCES_HISTORICAL_PROJECT_REGISTRATION.direction,
  idempotency_key: FLEET_RESOURCES_HISTORICAL_PROJECT_REGISTRATION.idempotency_key,
  request_digest: FLEET_RESOURCES_HISTORICAL_PROJECT_REGISTRATION.request_digest,
  precondition_digest: FLEET_RESOURCES_HISTORICAL_PROJECT_REGISTRATION.precondition_digest,
  outcome: "accepted",
  reason: null,
  target_id: FLEET_RESOURCES_HISTORICAL_PROJECT_REGISTRATION.target_id,
  result_revision: FLEET_RESOURCES_HISTORICAL_PROJECT_REGISTRATION.result_revision,
  result_digest: FLEET_RESOURCES_HISTORICAL_PROJECT_REGISTRATION.result_digest,
  duplicate_of_receipt_id: null,
  accepted_receipt_id: null,
  created_by_operation: true,
  created_at: FLEET_RESOURCES_HISTORICAL_PROJECT_REGISTRATION.created_at,
};

export const FLEET_RESOURCES_HISTORICAL_RESPONSE_CONTROL:
MementosProjectRegistrationResponseControl = {
  response_byte_limit: 131_072,
  time_budget_ms: 10_000,
  response_bytes: 1_101,
  elapsed_ms: 2,
  complete: true,
  truncated: false,
};

export const FLEET_RESOURCES_CURRENT_PROJECT_REGISTRATION_IDENTITY = {
  authority_id: "mementos",
  tenant_id: ROOT_TENANT_ID,
  corpus_id: "mementos:postgresql",
} as const;

export const FLEET_RESOURCES_HISTORICAL_LOOKUP_IDENTITY:
MementosProjectRegistrationHistoricalLookupIdentity = {
  source: {
    authority: FLEET_RESOURCES_HISTORICAL_PROJECT_REGISTRATION.authority,
    authority_route: FLEET_RESOURCES_HISTORICAL_PROJECT_REGISTRATION.authority_route,
    package_version: FLEET_RESOURCES_HISTORICAL_PROJECT_REGISTRATION.package_version,
    authority_id: FLEET_RESOURCES_HISTORICAL_PROJECT_REGISTRATION.authority_id,
    tenant_id: FLEET_RESOURCES_HISTORICAL_PROJECT_REGISTRATION.tenant_id,
    corpus_id: FLEET_RESOURCES_HISTORICAL_PROJECT_REGISTRATION.corpus_id,
    operation_id: FLEET_RESOURCES_HISTORICAL_PROJECT_REGISTRATION.operation_id,
    step_id: FLEET_RESOURCES_HISTORICAL_PROJECT_REGISTRATION.step_id,
    resource_kind: FLEET_RESOURCES_HISTORICAL_PROJECT_REGISTRATION.resource_kind,
    direction: FLEET_RESOURCES_HISTORICAL_PROJECT_REGISTRATION.direction,
    target_selector: FLEET_RESOURCES_HISTORICAL_PROJECT_REGISTRATION.target_selector,
    target_id: FLEET_RESOURCES_HISTORICAL_PROJECT_REGISTRATION.target_id,
    idempotency_key: FLEET_RESOURCES_HISTORICAL_PROJECT_REGISTRATION.idempotency_key,
    receipt_id: FLEET_RESOURCES_HISTORICAL_PROJECT_REGISTRATION.receipt_id,
  },
  destination: FLEET_RESOURCES_CURRENT_PROJECT_REGISTRATION_IDENTITY,
  lookup_only: true,
  immutable_receipt: true,
};

export function supportsFleetResourcesHistoricalReceiptLookup(
  capability: Pick<
    MementosProjectRegistrationCapability,
    "authority_id" | "tenant_id" | "corpus_id"
  >,
): boolean {
  return capability.authority_id
    === FLEET_RESOURCES_CURRENT_PROJECT_REGISTRATION_IDENTITY.authority_id
    && capability.tenant_id
      === FLEET_RESOURCES_CURRENT_PROJECT_REGISTRATION_IDENTITY.tenant_id
    && capability.corpus_id
      === FLEET_RESOURCES_CURRENT_PROJECT_REGISTRATION_IDENTITY.corpus_id;
}
