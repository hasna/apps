import type { ProviderEnvironment, ProviderId, ProviderOperationSupport } from "../core/providers.ts";
import { getProvider } from "./capabilities.ts";
import { preflightProviderEnv, preflightProviderScopes, type ProviderScopeArea } from "./security.ts";

export type ProviderOperationKind =
  | "accountCards.list"
  | "accountStatements.list"
  | "accountStatements.download"
  | "accountTransactions.list"
  | "accountTransactions.get"
  | "accountCheques.list"
  | "accounts.get"
  | "accounts.list"
  | "attachments.get"
  | "balances.get"
  | "bulkPartyVerification.create"
  | "bulkPartyVerification.get"
  | "bulkPartyVerification.status.get"
  | "bulkPayments.extendedStatus.get"
  | "cardAccounts.get"
  | "cardAccounts.list"
  | "cardBalances.get"
  | "cardTransactions.list"
  | "cards.cancel"
  | "cards.get"
  | "cards.createVirtual"
  | "cards.freeze"
  | "cards.list"
  | "cards.updateSettings"
  | "cards.unfreeze"
  | "cards.terminate"
  | "cards.revealSensitiveData"
  | "categories.create"
  | "categories.delete"
  | "categories.list"
  | "categories.update"
  | "consents.authorisations.create"
  | "consents.authorisations.get"
  | "consents.authorisations.list"
  | "consents.authorisations.update"
  | "consents.create"
  | "consents.delete"
  | "consents.get"
  | "consents.status.get"
  | "counterparties.list"
  | "credit.list"
  | "customers.create"
  | "customers.delete"
  | "customers.get"
  | "customers.list"
  | "customers.update"
  | "events.get"
  | "events.list"
  | "fundsConfirmations.create"
  | "internalTransfers.create"
  | "invoices.attachments.list"
  | "invoices.cancel"
  | "invoices.create"
  | "invoices.download"
  | "invoices.get"
  | "invoices.list"
  | "invoices.update"
  | "oauth.obtainToken"
  | "oauth.startFlow"
  | "onboarding.submit"
  | "organization.get"
  | "partyVerification.create"
  | "paymentAuthorisations.create"
  | "paymentAuthorisations.get"
  | "paymentAuthorisations.list"
  | "paymentAuthorisations.update"
  | "paymentCancellationAuthorisations.create"
  | "paymentCancellationAuthorisations.get"
  | "paymentCancellationAuthorisations.list"
  | "paymentCancellationAuthorisations.update"
  | "payments.cancel"
  | "payments.create"
  | "payments.creditorConfirmation.update"
  | "payments.get"
  | "payments.requestSendMoney"
  | "payments.status"
  | "recipients.attachments.list"
  | "recipients.attachments.upload"
  | "recipients.create"
  | "recipients.get"
  | "recipients.list"
  | "recipients.update"
  | "safes.download"
  | "safes.get"
  | "safes.list"
  | "sendMoneyApprovalRequests.get"
  | "sendMoneyApprovalRequests.list"
  | "signingBaskets.authorisations.create"
  | "signingBaskets.authorisations.get"
  | "signingBaskets.authorisations.list"
  | "signingBaskets.authorisations.update"
  | "signingBaskets.create"
  | "signingBaskets.delete"
  | "signingBaskets.get"
  | "signingBaskets.status.get"
  | "statements.download"
  | "transactions.attachments.upload"
  | "transactions.get"
  | "transactions.list"
  | "transactions.update"
  | "treasury.accounts.list"
  | "treasury.statements.list"
  | "treasury.transactions.list"
  | "users.get"
  | "users.list"
  | "webhooks.create"
  | "webhooks.delete"
  | "webhooks.get"
  | "webhooks.list"
  | "webhooks.subscribe"
  | "webhooks.update"
  | "webhooks.verify";

export type ProviderOperationEffect =
  | "read"
  | "metadata_write"
  | "money_movement"
  | "card_side_effect"
  | "sensitive_read"
  | "webhook"
  | "auth_flow";
export type ProviderOperationPlanStatus = "ready_for_conformance" | "blocked";

export interface ProviderEndpointContract {
  readonly method: "GET" | "POST" | "PATCH" | "PUT" | "DELETE";
  readonly path: string;
  readonly server?: "api" | "oauth2";
}

export interface ProviderDocSource {
  readonly title: string;
  readonly url: string;
  readonly checkedAt: string;
}

export interface ProviderOperationContract {
  readonly operation: ProviderOperationKind;
  readonly effect: ProviderOperationEffect;
  readonly support: ProviderOperationSupport;
  readonly environments: readonly ProviderEnvironment[];
  readonly scopeArea?: ProviderScopeArea;
  readonly requiredScopes: readonly string[];
  readonly requiredEnv: readonly string[];
  readonly requiresApproval: boolean;
  readonly requiresIdempotencyKey: boolean;
  readonly requiresRequestSigning: boolean;
  readonly requiresSCA: boolean;
  readonly endpoint?: ProviderEndpointContract;
  readonly releaseGates: readonly string[];
}

export interface ProviderConformanceContract {
  readonly providerId: ProviderId;
  readonly checkedAt: string;
  readonly docs: readonly ProviderDocSource[];
  readonly operations: readonly ProviderOperationContract[];
  readonly constraints: readonly string[];
}

export interface ProviderOperationPlan {
  readonly providerId: ProviderId;
  readonly operation: ProviderOperationKind;
  readonly environment: ProviderEnvironment;
  readonly status: ProviderOperationPlanStatus;
  readonly executable: false;
  readonly support: ProviderOperationSupport;
  readonly requiredScopes: readonly string[];
  readonly grantedScopes: readonly string[];
  readonly requiredEnv: readonly string[];
  readonly acceptedEnvKeys: readonly string[];
  readonly missingScopes: readonly string[];
  readonly missingEnvKeys: readonly string[];
  readonly reasons: readonly string[];
  readonly releaseGates: readonly string[];
}

export interface ProviderOperationPlanInput {
  readonly providerId: ProviderId;
  readonly operation: ProviderOperationKind;
  readonly environment: ProviderEnvironment;
  readonly grantedScopes?: readonly string[];
  readonly env?: Readonly<Record<string, string | undefined>>;
}

const checkedAt = "2026-06-29";
const MERCURY_ENV = ["MERCURY_API_KEY", "MERCURY_SANDBOX_API_KEY", "MERCURY_PRODUCTION_API_KEY"] as const;
const MERCURY_OAUTH_ENV = ["MERCURY_OAUTH_CLIENT_ID", "MERCURY_OAUTH_CLIENT_SECRET", "MERCURY_OAUTH_REDIRECT_URI"] as const;
const ERSTE_CLIENT_ID_ENV = ["ERSTE_CLIENT_ID", "ERSTE_SANDBOX_CLIENT_ID", "ERSTE_PRODUCTION_CLIENT_ID"] as const;
const ERSTE_CLIENT_SECRET_ENV = ["ERSTE_CLIENT_SECRET", "ERSTE_SANDBOX_CLIENT_SECRET", "ERSTE_PRODUCTION_CLIENT_SECRET"] as const;
const ERSTE_CERT_ENV = ["ERSTE_TPP_CERT_PATH", "ERSTE_QWAC_CERT_PATH"] as const;
const ERSTE_KEY_ENV = ["ERSTE_TPP_KEY_PATH", "ERSTE_QWAC_KEY_PATH"] as const;
const ERSTE_TPP_ENV = [...ERSTE_CLIENT_ID_ENV, ...ERSTE_CERT_ENV, ...ERSTE_KEY_ENV] as const;
const ERSTE_OAUTH_ENV = [...ERSTE_CLIENT_ID_ENV, ...ERSTE_CLIENT_SECRET_ENV, "ERSTE_REDIRECT_URI"] as const;

export const PROVIDER_CONFORMANCE_CONTRACTS: readonly ProviderConformanceContract[] = [
  {
    providerId: "mercury",
    checkedAt,
    docs: [
      source("Mercury llms.txt index", "https://docs.mercury.com/llms.txt"),
      source("Mercury API changelog", "https://docs.mercury.com/changelog"),
      source("Mercury API token security policies", "https://docs.mercury.com/docs/api-token-security-policies"),
      source("Mercury MCP supported tools", "https://docs.mercury.com/docs/supported-tools-on-mercury-mcp"),
      source("Mercury get all accounts", "https://docs.mercury.com/reference/getaccounts"),
      source("Mercury list cards", "https://docs.mercury.com/reference/listcards"),
      source("Mercury list all transactions", "https://docs.mercury.com/reference/listtransactions"),
      source("Mercury create transaction", "https://docs.mercury.com/reference/createtransaction"),
      source("Mercury create internal transfer", "https://docs.mercury.com/reference/createinternaltransfer"),
      source("Mercury webhooks", "https://docs.mercury.com/reference/webhooks"),
      source("Mercury OAuth2", "https://docs.mercury.com/docs/integrations-with-oauth2"),
    ],
    constraints: [
      "Mercury send-money requires recipientId, idempotencyKey, amount >= 0.01, paymentMethod ach/check/domesticWire, and purpose when paymentMethod is domesticWire.",
      "Mercury request-send-money creates an approval request and is documented as usable without IP whitelisting, but still requires explicit approval/idempotency/audit gates before automation.",
      "Internal transfers can move funds between depository and treasury/investment accounts; treat them as money movement.",
      "Card lifecycle operations are documented but remain non-executable until sandbox/live conformance confirms scopes, amount units, limits, and idempotency behavior.",
      "Attachment, statement, invoice PDF, and SAFE document reads can return signed download URLs or binary documents and require redaction/download handling before agent-visible use.",
      "Webhook create/update/delete/verify operations mutate external delivery state and require approval/idempotency plus signature verification before trusting provider events.",
      "OAuth2 flow support is contract-only until client registration, redirect validation, PKCE, and token storage are implemented.",
      "Sensitive card data is unsupported until an exact official sensitive-card endpoint source is documented.",
      "All money movement, card lifecycle, metadata mutation, webhook mutation, onboarding, and OAuth token operations require maker-checker approval and idempotency reservation before provider submission.",
    ],
    operations: [
      mercuryRead("accounts.list", ["accounts:read"], api("GET", "/accounts")),
      mercuryRead("accounts.get", ["accounts:read"], api("GET", "/account/{accountId}")),
      mercuryRead("balances.get", ["accounts:read"], api("GET", "/account/{accountId}")),
      mercuryRead("accountCards.list", ["cards:write"], api("GET", "/account/{accountId}/cards")),
      mercuryRead("accountStatements.list", ["accounts:read"], api("GET", "/account/{accountId}/statements")),
      mercurySensitiveRead("accountStatements.download", api("GET", "/statements/{statementId}/pdf"), [
        "Statement PDF responses are binary downloads and must not be printed to agent chat or logs.",
      ]),
      mercuryRead("accountTransactions.list", ["transactions:read"], api("GET", "/account/{accountId}/transactions")),
      mercuryRead("accountTransactions.get", ["transactions:read"], api("GET", "/account/{accountId}/transaction/{transactionId}")),
      mercurySensitiveRead("attachments.get", api("GET", "/ar/attachments/{attachmentId}"), [
        "Attachment responses contain signed download URLs; redact URLs and refresh them only at point of use.",
      ]),
      card("cards.createVirtual", ["cards:write"], MERCURY_ENV, ["sandbox", "production"], api("POST", "/cards"), [
        "Confirm cardholder userId, debit/credit kind, spending-limit units, and sandbox lifecycle semantics before live execution.",
      ]),
      mercuryRead("cards.get", ["cards:write"], api("GET", "/cards/{cardId}")),
      mercuryRead("cards.list", ["cards:write"], api("GET", "/cards")),
      card("cards.updateSettings", ["cards:write"], MERCURY_ENV, ["sandbox", "production"], api("POST", "/cards/{cardId}")),
      card("cards.freeze", ["cards:write"], MERCURY_ENV, ["sandbox", "production"], api("POST", "/cards/{cardId}/freeze")),
      card("cards.unfreeze", ["cards:write"], MERCURY_ENV, ["sandbox", "production"], api("POST", "/cards/{cardId}/unfreeze")),
      card("cards.cancel", ["cards:write"], MERCURY_ENV, ["sandbox", "production"], api("POST", "/cards/{cardId}/cancel"), [
        "Mercury names this operation cancel; it permanently closes the card and cannot be undone.",
      ]),
      card("cards.terminate", ["cards:write"], MERCURY_ENV, ["sandbox", "production"], api("POST", "/cards/{cardId}/cancel"), [
        "Hasna compatibility alias for Mercury card cancel; provider execution must submit the official cancel operation.",
      ]),
      unsupported("cards.revealSensitiveData", "sensitive_read"),
      mercuryMetadata("categories.create", api("POST", "/categories")),
      mercuryMetadata("categories.delete", api("DELETE", "/categories/{expenseCategoryId}"), [
        "Confirm category deletion impact on historical transaction metadata before execution.",
      ]),
      mercuryRead("categories.list", ["transactions:read"], api("GET", "/categories")),
      mercuryMetadata("categories.update", api("POST", "/categories/{expenseCategoryId}")),
      mercuryRead("credit.list", ["accounts:read"], api("GET", "/credit")),
      mercuryMetadata("customers.create", api("POST", "/ar/customers")),
      mercuryMetadata("customers.delete", api("DELETE", "/ar/customers/{customerId}"), [
        "Customer deletion is irreversible in Mercury; require explicit human approval.",
      ]),
      mercuryRead("customers.get", ["accounts:read"], api("GET", "/ar/customers/{customerId}")),
      mercuryRead("customers.list", ["accounts:read"], api("GET", "/ar/customers")),
      mercuryMetadata("customers.update", api("POST", "/ar/customers/{customerId}")),
      mercuryRead("events.get", ["accounts:read"], api("GET", "/events/{eventId}")),
      mercuryRead("events.list", ["accounts:read"], api("GET", "/events")),
      write("internalTransfers.create", "money_movement", ["transactions:write"], MERCURY_ENV, ["sandbox", "production"], api("POST", "/transfer"), [
        "Confirm source/destination account type matrix, paired debit/credit transaction mapping, and treasury transfer semantics before execution.",
      ]),
      mercurySensitiveRead("invoices.attachments.list", api("GET", "/ar/invoices/{invoiceId}/attachments")),
      mercuryMetadata("invoices.cancel", api("POST", "/ar/invoices/{invoiceId}/cancel"), [
        "Invoice cancellation is irreversible and must be approved by a human.",
      ]),
      mercuryMetadata("invoices.create", api("POST", "/ar/invoices"), [
        "Confirm destination account eligibility and whether invoice payment instructions expose real or virtual account numbers before execution.",
      ]),
      mercurySensitiveRead("invoices.download", api("GET", "/ar/invoices/{invoiceId}/pdf"), [
        "Invoice PDF responses are binary downloads and must not be printed to agent chat or logs.",
      ]),
      mercuryRead("invoices.get", ["accounts:read"], api("GET", "/ar/invoices/{invoiceId}")),
      mercuryRead("invoices.list", ["accounts:read"], api("GET", "/ar/invoices")),
      mercuryMetadata("invoices.update", api("POST", "/ar/invoices/{invoiceId}")),
      authOperation("oauth.startFlow", oauth("GET", "/oauth2/auth"), ["MERCURY_OAUTH_CLIENT_ID", "MERCURY_OAUTH_REDIRECT_URI"], [
        "Require state, redirect URI allowlist validation, and PKCE where configured before redirect generation.",
      ]),
      authOperation("oauth.obtainToken", oauth("POST", "/oauth2/token"), MERCURY_OAUTH_ENV, [
        "Token exchange must store tokens only in the secrets vault and never print access or refresh tokens.",
      ]),
      mercuryMetadata("onboarding.submit", api("POST", "/submit-onboarding-data"), [
        "Onboarding payloads contain applicant data and require a dedicated schema/redaction review before execution.",
      ]),
      mercuryRead("organization.get", ["accounts:read"], api("GET", "/organization")),
      write("payments.create", "money_movement", ["transactions:write"], MERCURY_ENV, ["sandbox", "production"], api("POST", "/account/{accountId}/transactions"), [
        "Require provider recipientId before provider submission.",
        "Map provider-agnostic rail to Mercury paymentMethod ach, check, or domesticWire only.",
        "Reject Mercury payment amounts below 0.01 before provider submission.",
        "Require purpose when mapped Mercury paymentMethod is domesticWire.",
        "Verify amount units and recipient requirements against Mercury sandbox before enabling.",
      ]),
      write("payments.requestSendMoney", "money_movement", ["RequestSendMoney"], MERCURY_ENV, ["sandbox", "production"], api("POST", "/account/{accountId}/request-send-money"), [
        "This creates an approval request rather than immediately sending funds; still require local approval/idempotency/audit before provider submission.",
        "Use a Mercury custom token with the RequestSendMoney scope for approval-queue payment creation.",
      ]),
      mercuryRead("payments.status", ["transactions:read"], api("GET", "/transaction/{transactionId}")),
      mercurySensitiveRead("recipients.attachments.list", api("GET", "/recipients/attachments"), [
        "Recipient attachment records include presigned tax-form download URLs; redact URLs and never print them to agent-visible output.",
      ]),
      mercurySensitiveWrite("recipients.attachments.upload", api("POST", "/recipient/{recipientId}/attachments"), [
        "Recipient tax form uploads use multipart/form-data and must avoid logging file names, contents, or signed upload metadata.",
      ]),
      mercuryMetadata("recipients.create", api("POST", "/recipients"), [
        "Confirm recipient rail/account data validation and tax-form requirements before execution.",
      ]),
      mercuryRead("recipients.get", ["transactions:read"], api("GET", "/recipient/{recipientId}")),
      mercuryRead("recipients.list", ["transactions:read"], api("GET", "/recipients")),
      mercuryMetadata("recipients.update", api("POST", "/recipient/{recipientId}")),
      mercurySensitiveRead("safes.download", api("GET", "/safes/{safeRequestId}/document"), [
        "SAFE document responses are binary downloads and must not be printed to agent chat or logs.",
      ]),
      mercuryRead("safes.get", ["accounts:read"], api("GET", "/safes/{safeRequestId}")),
      mercuryRead("safes.list", ["accounts:read"], api("GET", "/safes")),
      mercuryRead("sendMoneyApprovalRequests.get", ["transactions:read"], api("GET", "/request-send-money/{requestId}")),
      mercuryRead("sendMoneyApprovalRequests.list", ["transactions:read"], api("GET", "/request-send-money")),
      mercurySensitiveRead("statements.download", api("GET", "/statements/{statementId}/pdf"), [
        "Statement PDF responses are binary downloads and must not be printed to agent chat or logs.",
      ]),
      mercurySensitiveWrite("transactions.attachments.upload", api("POST", "/transaction/{transactionId}/attachments"), [
        "Transaction attachment uploads use multipart/form-data and must avoid logging file names, contents, or signed upload metadata.",
      ]),
      mercuryRead("transactions.get", ["transactions:read"], api("GET", "/transaction/{transactionId}")),
      mercuryRead("transactions.list", ["transactions:read"], api("GET", "/transactions")),
      mercuryMetadata("transactions.update", api("PATCH", "/transaction/{transactionId}")),
      mercuryRead("treasury.accounts.list", ["accounts:read"], api("GET", "/treasury")),
      mercurySensitiveRead("treasury.statements.list", api("GET", "/treasury/{treasuryId}/statements"), [
        "Treasury statements include monthly statements, trade confirmations, and tax documents; redact document URLs and binary content.",
      ]),
      mercuryRead("treasury.transactions.list", ["transactions:read"], api("GET", "/treasury/{treasuryId}/transactions")),
      mercuryRead("users.get", ["accounts:read"], api("GET", "/users/{userId}")),
      mercuryRead("users.list", ["accounts:read"], api("GET", "/users")),
      webhook("webhooks.create", MERCURY_ENV, ["sandbox", "production"], [
        "Verify Mercury webhook payload signatures and event replay behavior before trusting provider state.",
      ], api("POST", "/webhooks")),
      webhook("webhooks.delete", MERCURY_ENV, ["sandbox", "production"], [
        "Webhook deletion mutates external event delivery state and must be approved by a human.",
      ], api("DELETE", "/webhooks/{webhookEndpointId}")),
      mercuryRead("webhooks.get", ["accounts:read"], api("GET", "/webhooks/{webhookEndpointId}")),
      mercuryRead("webhooks.list", ["accounts:read"], api("GET", "/webhooks")),
      webhook("webhooks.subscribe", MERCURY_ENV, ["sandbox", "production"], [
        "Compatibility alias for creating webhook subscriptions; prefer webhooks.create for official Mercury API parity.",
      ], api("POST", "/webhooks")),
      webhook("webhooks.update", MERCURY_ENV, ["sandbox", "production"], [
        "Webhook updates can reactivate failed endpoints; verify status semantics before execution.",
      ], api("POST", "/webhooks/{webhookEndpointId}")),
      webhook("webhooks.verify", MERCURY_ENV, ["sandbox", "production"], [
        "Webhook verification sends a test event and should be routed through an explicit operator approval.",
      ], api("POST", "/webhooks/{webhookEndpointId}/verify")),
    ],
  },
  {
    providerId: "bunq",
    checkedAt,
    docs: [
      source("bunq API docs", "https://doc.bunq.com/"),
      source("bunq payment object", "https://doc.bunq.com/basics/bunq-api-objects/payment"),
      source("bunq ordering a card", "https://doc.bunq.com/tutorials/how-to-manage-your-cards/ordering-a-card"),
    ],
    constraints: [
      "Write operations require bunq API context, device/session-server setup, X-Bunq-Client-Authentication, X-Bunq-Client-Request-Id, geolocation headers, and request signing with a private key.",
      "Card management is contract-only until direct API fixtures verify card create/update/freeze semantics in sandbox.",
      "Sensitive card/CVC data is unsupported until an exact official endpoint source is documented.",
    ],
    operations: [
      read("accounts.list", ["monetary-account:read"], ["BUNQ_API_KEY", "BUNQ_PRIVATE_KEY"], { method: "GET", path: "/user/{userID}/monetary-account" }, true),
      read("balances.get", ["monetary-account:read"], ["BUNQ_API_KEY", "BUNQ_PRIVATE_KEY"], { method: "GET", path: "/user/{userID}/monetary-account/{monetary-accountID}" }, true),
      read("transactions.list", ["payment:read"], ["BUNQ_API_KEY", "BUNQ_PRIVATE_KEY"], { method: "GET", path: "/user/{userID}/monetary-account/{monetary-accountID}/payment" }, true),
      write("payments.create", "money_movement", ["payment:write"], ["BUNQ_API_KEY", "BUNQ_PRIVATE_KEY"], ["sandbox", "production"], {
        method: "POST",
        path: "/user/{userID}/monetary-account/{monetary-accountID}/payment",
      }, ["Verify session-server persistence, request signing, and draft-vs-direct payment semantics."], true),
      read("payments.status", ["payment:read"], ["BUNQ_API_KEY", "BUNQ_PRIVATE_KEY"], { method: "GET", path: "/user/{userID}/monetary-account/{monetary-accountID}/payment/{paymentID}" }, true),
      card("cards.createVirtual", ["card:write"], ["BUNQ_API_KEY", "BUNQ_PRIVATE_KEY"], ["sandbox", "production"], {
        method: "POST",
        path: "/user/{userID}/card-credit",
      }, ["Verify accepted card type/status values and spending controls in bunq sandbox."], true),
      card("cards.updateSettings", ["card:write"], ["BUNQ_API_KEY", "BUNQ_PRIVATE_KEY"], ["sandbox", "production"], {
        method: "PUT",
        path: "/user/{userID}/card-credit/{cardID}",
      }, undefined, true),
      card("cards.freeze", ["card:write"], ["BUNQ_API_KEY", "BUNQ_PRIVATE_KEY"], ["sandbox", "production"], undefined, undefined, true),
      card("cards.unfreeze", ["card:write"], ["BUNQ_API_KEY", "BUNQ_PRIVATE_KEY"], ["sandbox", "production"], undefined, undefined, true),
      unsupported("cards.terminate", "card_side_effect"),
      unsupported("cards.revealSensitiveData", "sensitive_read"),
      webhook("webhooks.subscribe", ["BUNQ_API_KEY", "BUNQ_PRIVATE_KEY"], ["sandbox", "production"], [
        "Verify callback category filters and signature behavior before trusting webhook state.",
      ], true),
    ],
  },
  {
    providerId: "revolut-business",
    checkedAt,
    docs: [
      source("Revolut Business API", "https://developer.revolut.com/docs/business/business-api"),
      source("Revolut manage cards guide", "https://developer.revolut.com/docs/guides/manage-accounts/cards/manage-cards"),
      source("Revolut create card", "https://developer.revolut.com/docs/business/create-card"),
    ],
    constraints: [
      "Business card management is documented as unavailable in Sandbox; card plans must block sandbox execution.",
      "Business API integrations require scope checks and JWT/certificate-backed authentication before provider calls.",
      "Card creation requires request_id idempotency, virtual-only creation, and spending-limit conformance before provider submission.",
    ],
    operations: [
      read("accounts.list", ["READ"], ["REVOLUT_CLIENT_ID", "REVOLUT_PRIVATE_KEY"], { method: "GET", path: "/1.0/accounts" }),
      read("balances.get", ["READ"], ["REVOLUT_CLIENT_ID", "REVOLUT_PRIVATE_KEY"], { method: "GET", path: "/1.0/accounts/{account_id}" }),
      read("transactions.list", ["READ"], ["REVOLUT_CLIENT_ID", "REVOLUT_PRIVATE_KEY"], { method: "GET", path: "/1.0/transactions" }),
      read("counterparties.list", ["READ"], ["REVOLUT_CLIENT_ID", "REVOLUT_PRIVATE_KEY"], { method: "GET", path: "/1.0/counterparties" }),
      write("payments.create", "money_movement", ["PAY"], ["REVOLUT_CLIENT_ID", "REVOLUT_PRIVATE_KEY"], ["sandbox", "production"], {
        method: "POST",
        path: "/1.0/pay",
      }, ["Verify payment draft/payment flow, transfer limits, and idempotency header mapping."]),
      read("payments.status", ["READ"], ["REVOLUT_CLIENT_ID", "REVOLUT_PRIVATE_KEY"], { method: "GET", path: "/1.0/transactions/{transaction_id}" }),
      {
        operation: "cards.list",
        effect: "read",
        support: "documented_unverified",
        environments: ["production"],
        scopeArea: "read",
        requiredScopes: ["READ"],
        requiredEnv: ["REVOLUT_CLIENT_ID", "REVOLUT_PRIVATE_KEY"],
        requiresApproval: false,
        requiresIdempotencyKey: false,
        requiresRequestSigning: false,
        requiresSCA: false,
        endpoint: { method: "GET", path: "/1.0/cards" },
        releaseGates: ["Blocked in Sandbox by Revolut docs; verify response schema and redaction in production-like review before enabling."],
      },
      card("cards.createVirtual", ["WRITE"], ["REVOLUT_CLIENT_ID", "REVOLUT_PRIVATE_KEY"], ["production"], {
        method: "POST",
        path: "/1.0/cards",
      }, [
        "Blocked in Sandbox by Revolut docs; production requires manual API Support and card-limit confirmation.",
        "Map the intent idempotency key to Revolut request_id before provider submission.",
        "Create-card plans are virtual-only until physical-card contract evidence exists.",
        "Verify spending-limit constraints and period semantics before provider submission.",
      ]),
      card("cards.updateSettings", ["WRITE"], ["REVOLUT_CLIENT_ID", "REVOLUT_PRIVATE_KEY"], ["production"], { method: "PATCH", path: "/1.0/cards/{card_id}" }),
      card("cards.freeze", ["WRITE"], ["REVOLUT_CLIENT_ID", "REVOLUT_PRIVATE_KEY"], ["production"], { method: "POST", path: "/1.0/cards/{card_id}/freeze" }),
      card("cards.unfreeze", ["WRITE"], ["REVOLUT_CLIENT_ID", "REVOLUT_PRIVATE_KEY"], ["production"], { method: "POST", path: "/1.0/cards/{card_id}/unfreeze" }),
      card("cards.terminate", ["WRITE"], ["REVOLUT_CLIENT_ID", "REVOLUT_PRIVATE_KEY"], ["production"], { method: "POST", path: "/1.0/cards/{card_id}/terminate" }),
      sensitive("cards.revealSensitiveData", ["READ_SENSITIVE_CARD_DATA"], ["REVOLUT_CLIENT_ID", "REVOLUT_PRIVATE_KEY"], ["production"]),
      webhook("webhooks.subscribe", ["REVOLUT_CLIENT_ID", "REVOLUT_PRIVATE_KEY"], ["sandbox", "production"], [
        "Verify Business API webhook event types and signature verification before automated reconciliation.",
      ]),
    ],
  },
  {
    providerId: "erste-bcr",
    checkedAt,
    docs: [
      source("BCR Open Banking", "https://www.bcr.ro/en/open-banking"),
      source("Erste Developer Portal", "https://developers.erstegroup.com/"),
      source("Erste Open Banking", "https://www.erstegroup.com/en/erste-open-banking"),
      source("Berlin Group NextGenPSD2 downloads", "https://www.berlin-group.org/nextgenpsd2-downloads"),
      source("Berlin Group NextGenPSD2 OpenAPI", "https://gitlab.com/the-berlin-group/nextgenpsd2"),
    ],
    constraints: [
      "Treat BCR as PSD2 Account Information and Payment Initiation only until a separate commercial API grants broader control.",
      "BCR public docs require Developer Portal registration for Sandbox and Production and name PSD2 Account Information plus Payment Initiation APIs.",
      "Use Berlin Group NextGenPSD2 core v1.3.16 as the public conformance shape until the BCR portal publishes bank-specific YAML to the registered TPP.",
      "All production use requires registered TPP status, valid client credentials, certificate-backed transport/signing setup, consent, SCA, and redirect/session handling.",
      "Consent ids, authorisation ids, PSU redirect state, certificates, private keys, and tokens must never be stored in provider-visible logs or task comments.",
      "BCR-specific base paths, bank id slugs, PSU headers, OAuth endpoints, payment products, and optional operations must be verified against the portal before live execution.",
      "No direct card lifecycle, sensitive card data, Mercury-style webhook, recipient book, treasury, SAFE, customer, invoice, or category contract is exposed.",
    ],
    operations: [
      ersteAuth("oauth.startFlow", undefined, ERSTE_OAUTH_ENV, [
        "Verify Erste Developer Portal OAuth/redirect endpoints, registered redirect URI, state, and PKCE requirements before enabling.",
      ]),
      ersteAuth("oauth.obtainToken", undefined, ERSTE_OAUTH_ENV, [
        "Verify token exchange and refresh semantics; never print access, refresh, or PSU-facing tokens.",
      ]),
      ersteAuth("consents.create", psd2("POST", "/consents"), ERSTE_TPP_ENV, [
        "Create account-information consent only after validating recurrence, combined-service flag, access object, PSU redirect state, and certificate posture.",
      ], ["AIS"], "read"),
      ersteRead("consents.get", psd2("GET", "/consents/{consentId}"), true),
      ersteAuth("consents.delete", psd2("DELETE", "/consents/{consentId}"), ERSTE_TPP_ENV, [
        "Consent deletion revokes access and must be recorded as an irreversible external state change.",
      ], ["AIS"], "read"),
      ersteRead("consents.status.get", psd2("GET", "/consents/{consentId}/status"), true),
      ersteAuth("consents.authorisations.create", psd2("POST", "/consents/{consentId}/authorisations"), ERSTE_TPP_ENV, [
        "Start consent SCA authorisation only with a valid PSU redirect/session state envelope.",
      ], ["AIS"], "read"),
      ersteRead("consents.authorisations.list", psd2("GET", "/consents/{consentId}/authorisations"), true),
      ersteRead("consents.authorisations.get", psd2("GET", "/consents/{consentId}/authorisations/{authorisationId}"), true),
      ersteAuth("consents.authorisations.update", psd2("PUT", "/consents/{consentId}/authorisations/{authorisationId}"), ERSTE_TPP_ENV, [
        "Only use for embedded/decoupled SCA variants after the portal confirms BCR supports them.",
      ], ["AIS"], "read"),
      ersteRead("accounts.list", psd2("GET", "/accounts"), true),
      ersteRead("accounts.get", psd2("GET", "/accounts/{account-id}"), true),
      ersteRead("balances.get", psd2("GET", "/accounts/{account-id}/balances"), true),
      ersteRead("transactions.list", psd2("GET", "/accounts/{account-id}/transactions"), true),
      ersteRead("transactions.get", psd2("GET", "/accounts/{account-id}/transactions/{transactionId}"), true),
      ersteRead("accountCheques.list", psd2("GET", "/accounts/{account-id}/cheques"), true, [
        "Treat cheques as optional AIS; keep conformance-only until BCR YAML confirms support.",
      ]),
      erstePayment("payments.create", psd2("POST", "/{payment-service}/{payment-product}"), [
        "Verify BCR payment-service and payment-product matrix before using; public portal examples mention sepa-credit-transfers but BCR-specific products are portal-gated.",
        "Map local idempotency to Berlin Group X-Request-ID and persist redirect/SCA status without storing PSU credentials.",
      ]),
      erstePaymentRead("payments.get", psd2("GET", "/{payment-service}/{payment-product}/{paymentId}"), true),
      erstePaymentRead("payments.status", psd2("GET", "/{payment-service}/{payment-product}/{paymentId}/status"), true),
      erstePayment("payments.cancel", psd2("DELETE", "/{payment-service}/{payment-product}/{paymentId}"), [
        "Cancellation availability is payment-product and bank specific; require portal confirmation and explicit approval.",
      ]),
      erstePaymentRead("bulkPayments.extendedStatus.get", psd2("GET", "/bulk-payments/{payment-product}/{paymentId}/extended-status"), true, [
        "Only use for bulk payment products after BCR portal product matrix confirms support.",
      ]),
      ersteAuth("paymentAuthorisations.create", psd2("POST", "/{payment-service}/{payment-product}/{paymentId}/authorisations"), ERSTE_TPP_ENV, [
        "Start payment SCA only after the payment resource and redirect state are persisted.",
      ], ["PIS"], "payments"),
      erstePaymentRead("paymentAuthorisations.list", psd2("GET", "/{payment-service}/{payment-product}/{paymentId}/authorisations"), true),
      erstePaymentRead("paymentAuthorisations.get", psd2("GET", "/{payment-service}/{payment-product}/{paymentId}/authorisations/{authorisationId}"), true),
      ersteAuth("paymentAuthorisations.update", psd2("PUT", "/{payment-service}/{payment-product}/{paymentId}/authorisations/{authorisationId}"), ERSTE_TPP_ENV, [
        "Only use embedded/decoupled SCA updates after BCR confirms the SCA approach for the payment product.",
      ], ["PIS"], "payments"),
      ersteAuth("paymentCancellationAuthorisations.create", psd2("POST", "/{payment-service}/{payment-product}/{paymentId}/cancellation-authorisations"), ERSTE_TPP_ENV, [
        "Start cancellation SCA only after cancellation intent approval and provider status verification.",
      ], ["PIS"], "payments"),
      erstePaymentRead("paymentCancellationAuthorisations.list", psd2("GET", "/{payment-service}/{payment-product}/{paymentId}/cancellation-authorisations"), true),
      erstePaymentRead("paymentCancellationAuthorisations.get", psd2("GET", "/{payment-service}/{payment-product}/{paymentId}/cancellation-authorisations/{authorisationId}"), true),
      ersteAuth("paymentCancellationAuthorisations.update", psd2("PUT", "/{payment-service}/{payment-product}/{paymentId}/cancellation-authorisations/{authorisationId}"), ERSTE_TPP_ENV, [
        "Only use embedded/decoupled cancellation SCA after BCR confirms support.",
      ], ["PIS"], "payments"),
      erstePayment("payments.creditorConfirmation.update", psd2("PUT", "/{payment-service}/{payment-product}/{paymentId}/creditor-confirmation"), [
        "Creditor confirmation is a late-stage payment mutation and must remain conformance-only until BCR confirms support.",
      ]),
      unsupported("cardAccounts.list", "read"),
      unsupported("cardAccounts.get", "read"),
      unsupported("cardBalances.get", "read"),
      unsupported("cardTransactions.list", "read"),
      unsupported("fundsConfirmations.create", "money_movement"),
      unsupported("signingBaskets.create", "money_movement"),
      unsupported("signingBaskets.get", "read"),
      unsupported("signingBaskets.delete", "metadata_write"),
      unsupported("signingBaskets.status.get", "read"),
      unsupported("signingBaskets.authorisations.create", "auth_flow"),
      unsupported("signingBaskets.authorisations.list", "read"),
      unsupported("signingBaskets.authorisations.get", "read"),
      unsupported("signingBaskets.authorisations.update", "auth_flow"),
      unsupported("partyVerification.create", "metadata_write"),
      unsupported("bulkPartyVerification.create", "metadata_write"),
      unsupported("bulkPartyVerification.get", "read"),
      unsupported("bulkPartyVerification.status.get", "read"),
      unsupported("counterparties.list", "read"),
      unsupported("categories.list", "read"),
      unsupported("transactions.update", "metadata_write"),
      unsupported("cards.list", "read"),
      unsupported("cards.createVirtual", "card_side_effect"),
      unsupported("cards.updateSettings", "card_side_effect"),
      unsupported("cards.freeze", "card_side_effect"),
      unsupported("cards.unfreeze", "card_side_effect"),
      unsupported("cards.terminate", "card_side_effect"),
      unsupported("cards.revealSensitiveData", "sensitive_read"),
      unsupported("webhooks.subscribe", "webhook"),
    ],
  },
] as const;

for (const contract of PROVIDER_CONFORMANCE_CONTRACTS) {
  assertProviderConformanceContract(contract);
}

export function listProviderConformanceContracts(): readonly ProviderConformanceContract[] {
  return PROVIDER_CONFORMANCE_CONTRACTS;
}

export function getProviderConformanceContract(providerId: ProviderId): ProviderConformanceContract | undefined {
  return PROVIDER_CONFORMANCE_CONTRACTS.find((contract) => contract.providerId === providerId);
}

export function getProviderOperationContract(providerId: ProviderId, operation: ProviderOperationKind): ProviderOperationContract | undefined {
  return getProviderConformanceContract(providerId)?.operations.find((candidate) => candidate.operation === operation);
}

export function planProviderOperation(input: ProviderOperationPlanInput): ProviderOperationPlan {
  const provider = getProvider(input.providerId);
  if (!provider) throw new Error(`Unknown provider: ${input.providerId}`);
  const operation = getProviderOperationContract(input.providerId, input.operation);
  if (!operation) throw new Error(`Unknown provider operation: ${input.providerId}:${input.operation}`);

  const env = preflightProviderEnv(input.providerId, input.env ?? {});
  const grantedScopes = input.grantedScopes ?? [];
  const missingScopes = operation.requiredScopes.filter((scope) => !grantedScopes.includes(scope));
  const acceptedEnvKeys = acceptedEnvKeysForOperation(operation, env.allowedKeys, input.environment);
  const missingEnvKeys = missingRequiredEnvKeysForOperation(operation, env.allowedKeys, input.environment);
  const scopeSupport = operation.scopeArea
    ? preflightProviderScopes(provider, operation.scopeArea, provider.scopes[operation.scopeArea])
    : undefined;
  const reasons: string[] = [];

  if (operation.support === "unsupported") reasons.push("Provider contract marks operation unsupported.");
  if (!operation.environments.includes(input.environment)) reasons.push(`Provider contract does not support ${input.environment} for ${operation.operation}.`);
  if (scopeSupport?.unsupportedReason) {
    reasons.push(scopeSupport.unsupportedReason);
  }
  if (missingScopes.length > 0) {
    reasons.push("Missing required provider scopes.");
  }
  if (missingEnvKeys.length > 0) {
    reasons.push("Missing required provider environment keys.");
  }
  if (operation.support !== "verified") {
    reasons.push("Provider operation is not verified for live execution; only conformance planning is allowed.");
  }

  return {
    providerId: input.providerId,
    operation: input.operation,
    environment: input.environment,
    status: reasons.length === 1 && reasons[0] === "Provider operation is not verified for live execution; only conformance planning is allowed."
      ? "ready_for_conformance"
      : reasons.length === 0 ? "ready_for_conformance" : "blocked",
    executable: false,
    support: operation.support,
    requiredScopes: operation.requiredScopes,
    grantedScopes,
    requiredEnv: operation.requiredEnv,
    acceptedEnvKeys,
    missingScopes,
    missingEnvKeys,
    reasons,
    releaseGates: operation.releaseGates,
  };
}

function missingRequiredEnvKeysForOperation(
  operation: ProviderOperationContract,
  allowedKeys: readonly string[],
  environment: ProviderEnvironment,
): readonly string[] {
  const required = operation.requiredEnv;
  const missing: string[] = [];
  const mercuryApiAliases = new Set<string>(MERCURY_ENV);
  const usesMercuryApiKeyGroup = required.some((key) => mercuryApiAliases.has(key));
  const scopedEnvGroups = [
    envScopedGroup(ERSTE_CLIENT_ID_ENV, "ERSTE_SANDBOX_CLIENT_ID", "ERSTE_PRODUCTION_CLIENT_ID"),
    envScopedGroup(ERSTE_CLIENT_SECRET_ENV, "ERSTE_SANDBOX_CLIENT_SECRET", "ERSTE_PRODUCTION_CLIENT_SECRET"),
  ];
  const plainEnvGroups = [
    plainEnvGroup(ERSTE_CERT_ENV, "ERSTE_TPP_CERT_PATH"),
    plainEnvGroup(ERSTE_KEY_ENV, "ERSTE_TPP_KEY_PATH"),
  ];

  if (usesMercuryApiKeyGroup) {
    const accepted = acceptedMercuryApiKeys(allowedKeys, environment);
    if (accepted.length === 0) {
      missing.push(environment === "sandbox" ? "MERCURY_SANDBOX_API_KEY" : "MERCURY_PRODUCTION_API_KEY");
    }
  }
  for (const group of scopedEnvGroups) {
    if (!required.some((key) => group.keys.has(key))) continue;
    if (acceptedScopedEnvKeys(allowedKeys, group, environment).length === 0) {
      missing.push(environment === "sandbox" ? group.sandboxKey : group.productionKey);
    }
  }
  for (const group of plainEnvGroups) {
    if (!required.some((key) => group.keys.has(key))) continue;
    if (acceptedPlainEnvKeys(allowedKeys, group).length === 0) missing.push(group.preferredKey);
  }

  const allowed = new Set(allowedKeys);
  const groupedKeys = new Set<string>([
    ...MERCURY_ENV,
    ...scopedEnvGroups.flatMap((group) => [...group.keys]),
    ...plainEnvGroups.flatMap((group) => [...group.keys]),
  ]);
  for (const key of required) {
    if (groupedKeys.has(key)) continue;
    if (!allowed.has(key)) missing.push(key);
  }

  return missing;
}

function acceptedEnvKeysForOperation(
  operation: ProviderOperationContract,
  allowedKeys: readonly string[],
  environment: ProviderEnvironment,
): readonly string[] {
  const accepted = new Set<string>();
  const required = operation.requiredEnv;
  const mercuryApiAliases = new Set<string>(MERCURY_ENV);
  const scopedEnvGroups = [
    envScopedGroup(ERSTE_CLIENT_ID_ENV, "ERSTE_SANDBOX_CLIENT_ID", "ERSTE_PRODUCTION_CLIENT_ID"),
    envScopedGroup(ERSTE_CLIENT_SECRET_ENV, "ERSTE_SANDBOX_CLIENT_SECRET", "ERSTE_PRODUCTION_CLIENT_SECRET"),
  ];
  const plainEnvGroups = [
    plainEnvGroup(ERSTE_CERT_ENV, "ERSTE_TPP_CERT_PATH"),
    plainEnvGroup(ERSTE_KEY_ENV, "ERSTE_TPP_KEY_PATH"),
  ];
  if (required.some((key) => mercuryApiAliases.has(key))) {
    for (const key of acceptedMercuryApiKeys(allowedKeys, environment)) accepted.add(key);
  }
  for (const group of scopedEnvGroups) {
    if (!required.some((key) => group.keys.has(key))) continue;
    for (const key of acceptedScopedEnvKeys(allowedKeys, group, environment)) accepted.add(key);
  }
  for (const group of plainEnvGroups) {
    if (!required.some((key) => group.keys.has(key))) continue;
    for (const key of acceptedPlainEnvKeys(allowedKeys, group)) accepted.add(key);
  }
  const groupedKeys = new Set<string>([
    ...MERCURY_ENV,
    ...scopedEnvGroups.flatMap((group) => [...group.keys]),
    ...plainEnvGroups.flatMap((group) => [...group.keys]),
  ]);
  for (const key of allowedKeys) {
    if (groupedKeys.has(key)) continue;
    if (required.includes(key)) accepted.add(key);
  }
  return [...accepted];
}

function acceptedMercuryApiKeys(allowedKeys: readonly string[], environment: ProviderEnvironment): readonly string[] {
  const allowed = new Set(allowedKeys);
  const envSpecific = environment === "sandbox" ? "MERCURY_SANDBOX_API_KEY" : "MERCURY_PRODUCTION_API_KEY";
  return ["MERCURY_API_KEY", envSpecific].filter((key) => allowed.has(key));
}

interface EnvScopedGroup {
  readonly keys: ReadonlySet<string>;
  readonly genericKey: string;
  readonly sandboxKey: string;
  readonly productionKey: string;
}

interface PlainEnvGroup {
  readonly keys: ReadonlySet<string>;
  readonly preferredKey: string;
}

function envScopedGroup(keys: readonly string[], sandboxKey: string, productionKey: string): EnvScopedGroup {
  const genericKey = keys[0];
  if (!genericKey) throw new Error("Environment-scoped group must include a generic key.");
  return { keys: new Set(keys), genericKey, sandboxKey, productionKey };
}

function plainEnvGroup(keys: readonly string[], preferredKey: string): PlainEnvGroup {
  return { keys: new Set(keys), preferredKey };
}

function acceptedScopedEnvKeys(
  allowedKeys: readonly string[],
  group: EnvScopedGroup,
  environment: ProviderEnvironment,
): readonly string[] {
  const allowed = new Set(allowedKeys);
  const envSpecific = environment === "sandbox" ? group.sandboxKey : group.productionKey;
  return [group.genericKey, envSpecific].filter((key) => allowed.has(key));
}

function acceptedPlainEnvKeys(allowedKeys: readonly string[], group: PlainEnvGroup): readonly string[] {
  const allowed = new Set(allowedKeys);
  return [...group.keys].filter((key) => allowed.has(key));
}

export function assertProviderConformanceContract(contract: ProviderConformanceContract): void {
  const provider = getProvider(contract.providerId);
  if (!provider) throw new Error(`Missing provider capability card for ${contract.providerId}`);
  const operations = new Set<ProviderOperationKind>();
  for (const operation of contract.operations) {
    if (operations.has(operation.operation)) throw new Error(`Duplicate operation ${contract.providerId}:${operation.operation}`);
    operations.add(operation.operation);
    if (operation.operation.startsWith("cards.") && !provider.capabilities.cards && operation.support !== "unsupported") {
      throw new Error(`${contract.providerId} cannot support card operation ${operation.operation}`);
    }
    if (operation.operation === "cards.revealSensitiveData" && !provider.capabilities.sensitiveCardData && operation.support !== "unsupported") {
      throw new Error(`${contract.providerId} cannot support sensitive card data without capability evidence`);
    }
    if (operation.operation.startsWith("cards.") && provider.cardOperations.productionOnly && operation.environments.includes("sandbox")) {
      throw new Error(`${contract.providerId} cannot expose sandbox card operation ${operation.operation}`);
    }
    if (operation.effect === "money_movement" && !operation.requiresApproval) {
      throw new Error(`${contract.providerId}:${operation.operation} must require approval`);
    }
  }
}

function source(title: string, url: string): ProviderDocSource {
  return { title, url, checkedAt };
}

function api(method: ProviderEndpointContract["method"], path: string): ProviderEndpointContract {
  return { method, path: `/api/v1${path}` };
}

function oauth(method: ProviderEndpointContract["method"], path: string): ProviderEndpointContract {
  return { method, path, server: "oauth2" };
}

function psd2(method: ProviderEndpointContract["method"], path: string): ProviderEndpointContract {
  return { method, path: `/v1${path}` };
}

function mercuryRead(
  operation: ProviderOperationKind,
  requiredScopes: readonly string[],
  endpoint: ProviderEndpointContract,
  releaseGates: readonly string[] = [],
): ProviderOperationContract {
  const contract = read(operation, requiredScopes, MERCURY_ENV, endpoint);
  return {
    ...contract,
    releaseGates: releaseGates.length > 0 ? [...contract.releaseGates, ...releaseGates] : contract.releaseGates,
  };
}

function mercuryMetadata(
  operation: ProviderOperationKind,
  endpoint: ProviderEndpointContract,
  releaseGates: readonly string[] = [],
): ProviderOperationContract {
  return metadataWrite(operation, [], MERCURY_ENV, ["sandbox", "production"], endpoint, [
    "Confirm Mercury custom-token scope requirements for this endpoint before execution.",
    ...releaseGates,
  ]);
}

function mercurySensitiveRead(
  operation: ProviderOperationKind,
  endpoint: ProviderEndpointContract,
  releaseGates: readonly string[] = [],
): ProviderOperationContract {
  return {
    operation,
    effect: "sensitive_read",
    support: "documented_unverified",
    environments: ["sandbox", "production"],
    scopeArea: "read",
    requiredScopes: ["accounts:read"],
    requiredEnv: MERCURY_ENV,
    requiresApproval: true,
    requiresIdempotencyKey: false,
    requiresRequestSigning: false,
    requiresSCA: false,
    endpoint,
    releaseGates: [
      "Verify document/download response handling, signed URL redaction, and binary artifact storage before enabling.",
      ...releaseGates,
    ],
  };
}

function mercurySensitiveWrite(
  operation: ProviderOperationKind,
  endpoint: ProviderEndpointContract,
  releaseGates: readonly string[] = [],
): ProviderOperationContract {
  return metadataWrite(operation, [], MERCURY_ENV, ["sandbox", "production"], endpoint, [
    "Confirm multipart upload behavior and redact local filenames, file contents, and provider storage URLs.",
    ...releaseGates,
  ]);
}

function ersteRead(
  operation: ProviderOperationKind,
  endpoint: ProviderEndpointContract,
  requiresSCA: boolean,
  releaseGates: readonly string[] = [],
): ProviderOperationContract {
  const contract = read(operation, ["AIS"], ERSTE_TPP_ENV, endpoint, true, requiresSCA, "read");
  return {
    ...contract,
    releaseGates: [
      ...contract.releaseGates,
      "Verify BCR bank id, base path, PSU headers, consent scope, SCA status handling, and response redaction before live reads.",
      ...releaseGates,
    ],
  };
}

function erstePaymentRead(
  operation: ProviderOperationKind,
  endpoint: ProviderEndpointContract,
  requiresSCA: boolean,
  releaseGates: readonly string[] = [],
): ProviderOperationContract {
  const contract = read(operation, ["PIS"], ERSTE_TPP_ENV, endpoint, true, requiresSCA, "payments");
  return {
    ...contract,
    releaseGates: [
      ...contract.releaseGates,
      "Verify BCR payment product, PSU headers, SCA status handling, and provider status redaction before trusting payment-backed reads.",
      ...releaseGates,
    ],
  };
}

function ersteAuth(
  operation: ProviderOperationKind,
  endpoint: ProviderEndpointContract | undefined,
  requiredEnv: readonly string[],
  releaseGates: readonly string[] = [],
  requiredScopes: readonly string[] = [],
  scopeArea?: ProviderScopeArea,
): ProviderOperationContract {
  return authOperation(operation, endpoint, requiredEnv, [
    "Verify Erste/BCR portal registration, redirect allowlisting, certificate posture, SCA approach, and token storage before enabling.",
    ...releaseGates,
  ], true, requiredScopes, scopeArea);
}

function erstePayment(
  operation: ProviderOperationKind,
  endpoint: ProviderEndpointContract,
  releaseGates: readonly string[] = [],
): ProviderOperationContract {
  return write(operation, "money_movement", ["PIS"], ERSTE_TPP_ENV, ["sandbox", "production"], endpoint, [
    "Verify BCR payment product support, PSU headers, SCA redirect/decoupled handling, X-Request-ID idempotency, and status mapping before execution.",
    ...releaseGates,
  ], true, true);
}

function authOperation(
  operation: ProviderOperationKind,
  endpoint: ProviderEndpointContract | undefined,
  requiredEnv: readonly string[],
  releaseGates: readonly string[] = [],
  requiresRequestSigning = false,
  requiredScopes: readonly string[] = [],
  scopeArea?: ProviderScopeArea,
): ProviderOperationContract {
  return {
    operation,
    effect: "auth_flow",
    support: "documented_unverified",
    environments: ["sandbox", "production"],
    ...(scopeArea ? { scopeArea } : {}),
    requiredScopes,
    requiredEnv,
    requiresApproval: true,
    requiresIdempotencyKey: true,
    requiresRequestSigning,
    requiresSCA: false,
    ...(endpoint ? { endpoint } : {}),
    releaseGates: [
      "Verify OAuth client registration, redirect URI allowlisting, PKCE/state handling, and token storage before enabling.",
      ...releaseGates,
    ],
  };
}

function read(
  operation: ProviderOperationKind,
  requiredScopes: readonly string[],
  requiredEnv: readonly string[],
  endpoint?: ProviderEndpointContract,
  requiresRequestSigning = false,
  requiresSCA = false,
  scopeArea: ProviderScopeArea = "read",
): ProviderOperationContract {
  return {
    operation,
    effect: "read",
    support: "documented_unverified",
    environments: ["sandbox", "production"],
    scopeArea,
    requiredScopes,
    requiredEnv,
    requiresApproval: false,
    requiresIdempotencyKey: false,
    requiresRequestSigning,
    requiresSCA,
    ...(endpoint ? { endpoint } : {}),
    releaseGates: ["Verify response schema, pagination, account scoping, and redaction before trusting provider-backed reads."],
  };
}

function metadataWrite(
  operation: ProviderOperationKind,
  requiredScopes: readonly string[],
  requiredEnv: readonly string[],
  environments: readonly ProviderEnvironment[],
  endpoint?: ProviderEndpointContract,
  releaseGates: readonly string[] = [],
  requiresRequestSigning = false,
): ProviderOperationContract {
  return {
    operation,
    effect: "metadata_write",
    support: "documented_unverified",
    environments,
    requiredScopes,
    requiredEnv,
    requiresApproval: true,
    requiresIdempotencyKey: true,
    requiresRequestSigning,
    requiresSCA: false,
    ...(endpoint ? { endpoint } : {}),
    releaseGates: releaseGates.length > 0 ? releaseGates : ["Verify request schema, irreversible side effects, and provider status mapping before execution."],
  };
}

function write(
  operation: ProviderOperationKind,
  effect: ProviderOperationEffect,
  requiredScopes: readonly string[],
  requiredEnv: readonly string[],
  environments: readonly ProviderEnvironment[],
  endpoint?: ProviderEndpointContract,
  releaseGates: readonly string[] = [],
  requiresRequestSigning = false,
  requiresSCA = false,
): ProviderOperationContract {
  return {
    operation,
    effect,
    support: "documented_unverified",
    environments,
    scopeArea: "payments",
    requiredScopes,
    requiredEnv,
    requiresApproval: true,
    requiresIdempotencyKey: true,
    requiresRequestSigning,
    requiresSCA,
    ...(endpoint ? { endpoint } : {}),
    releaseGates: releaseGates.length > 0 ? releaseGates : ["Verify request schema, idempotency behavior, limits, and provider status mapping before execution."],
  };
}

function card(
  operation: ProviderOperationKind,
  requiredScopes: readonly string[],
  requiredEnv: readonly string[],
  environments: readonly ProviderEnvironment[],
  endpoint?: ProviderEndpointContract,
  releaseGates: readonly string[] = [],
  requiresRequestSigning = false,
): ProviderOperationContract {
  return {
    operation,
    effect: "card_side_effect",
    support: "documented_unverified",
    environments,
    scopeArea: "cards",
    requiredScopes,
    requiredEnv,
    requiresApproval: true,
    requiresIdempotencyKey: true,
    requiresRequestSigning,
    requiresSCA: false,
    ...(endpoint ? { endpoint } : {}),
    releaseGates: releaseGates.length > 0 ? releaseGates : ["Verify card lifecycle endpoint, state transition, and spending-control semantics before execution."],
  };
}

function sensitive(
  operation: ProviderOperationKind,
  requiredScopes: readonly string[],
  requiredEnv: readonly string[],
  environments: readonly ProviderEnvironment[],
  requiresRequestSigning = false,
): ProviderOperationContract {
  return {
    operation,
    effect: "sensitive_read",
    support: "documented_unverified",
    environments,
    scopeArea: "sensitiveCardData",
    requiredScopes,
    requiredEnv,
    requiresApproval: true,
    requiresIdempotencyKey: false,
    requiresRequestSigning,
    requiresSCA: false,
    releaseGates: ["Verify no PAN/CVC is logged or returned through agent-visible surfaces before enabling."],
  };
}

function webhook(
  operation: ProviderOperationKind,
  requiredEnv: readonly string[],
  environments: readonly ProviderEnvironment[],
  releaseGates: readonly string[],
  endpointOrRequiresRequestSigning?: ProviderEndpointContract | boolean,
  requiresRequestSigning = false,
): ProviderOperationContract {
  const endpoint = typeof endpointOrRequiresRequestSigning === "object" ? endpointOrRequiresRequestSigning : undefined;
  const requestSigning = typeof endpointOrRequiresRequestSigning === "boolean" ? endpointOrRequiresRequestSigning : requiresRequestSigning;
  return {
    operation,
    effect: "webhook",
    support: "documented_unverified",
    environments,
    requiredScopes: [],
    requiredEnv,
    requiresApproval: true,
    requiresIdempotencyKey: true,
    requiresRequestSigning: requestSigning,
    requiresSCA: false,
    ...(endpoint ? { endpoint } : {}),
    releaseGates,
  };
}

function unsupported(operation: ProviderOperationKind, effect: ProviderOperationEffect): ProviderOperationContract {
  return {
    operation,
    effect,
    support: "unsupported",
    environments: [],
    requiredScopes: [],
    requiredEnv: [],
    requiresApproval: true,
    requiresIdempotencyKey: true,
    requiresRequestSigning: false,
    requiresSCA: false,
    releaseGates: ["Unsupported by the current public provider contract."],
  };
}
