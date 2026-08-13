// Service-layer barrel. CLI, MCP, and /v1 all import from here (never from db/*).
export * as identityService from "./identities.js";
export * as credentialService from "./credentials.js";
export * as scopeService from "./scopes.js";
export * as elevationService from "./elevations.js";
export * as accessRequestService from "./access-requests.js";
export * as reviewService from "./reviews.js";
export * as requestService from "./access-requests.js";
export * as revocationService from "./revocations.js";
export * as tokenService from "./tokens.js";
export * from "./authorization.js";
export { scopeAllows, hasStorageAdmin, type AuthorizationContext as ScopedAuthorizationContext } from "./authorization-scopes.js";
export * from "./registry.js";
