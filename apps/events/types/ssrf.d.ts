/**
 * Webhook-target SSRF guard for the durable delivery transport.
 *
 * The durable webhook transport must default-deny private and special-use
 * targets (IPv4/IPv6), refuse redirects that would reach a private target,
 * and prevent a DNS-rebinding window between validation and connection. The
 * connection is pinned to the validated address, and the original hostname is
 * carried in the `Host` header so TLS hostname verification keeps working.
 *
 * A narrow, admin-controlled allowlist (`allowPrivateHosts`) permits
 * intentional private ingress such as a loopback receiver on the same machine.
 */
export interface LookupAddress {
    address: string;
    family: number;
}
export type TargetLookup = (hostname: string) => Promise<LookupAddress[]>;
export interface WebhookTargetPolicy {
    /**
     * Admin-controlled allowlist of private hostnames or IP addresses that
     * intentional private webhook ingress may target (for example a loopback
     * receiver on the same machine). Exact match only, case-insensitive for
     * hostnames. Defaults to none.
     */
    allowPrivateHosts?: string[];
    /**
     * Maximum redirect hops followed. Every hop is revalidated against the same
     * policy. Defaults to 5.
     */
    maxRedirects?: number;
    /** Injectable hostname resolver, used by tests. Defaults to dns.promises.lookup. */
    lookup?: TargetLookup;
}
export declare const DEFAULT_MAX_REDIRECTS = 5;
export interface ResolvedWebhookTarget {
    hostname: string;
    /** Validated public addresses the connection may be pinned to. */
    addresses: string[];
}
/**
 * True when the address is a private, loopback, link-local, multicast, or
 * otherwise special-use address that a webhook must not reach by default.
 * Unparsable or non-IP input fails closed (treated as private).
 */
export declare function isPrivateAddress(address: string): boolean;
/**
 * Resolves and validates a webhook target. Returns the validated public
 * addresses (which the caller pins the connection to), or throws with a
 * bounded reason when the target is private, unresolvable, empty, or mixed
 * with a private answer. The narrow admin allowlist admits exact private
 * hostnames and addresses.
 */
export declare function resolveWebhookTarget(url: URL, policy?: WebhookTargetPolicy): Promise<ResolvedWebhookTarget>;
/** Validates a webhook target URL against the SSRF policy, throwing on rejection. */
export declare function assertWebhookTargetAllowed(url: URL, policy?: WebhookTargetPolicy): Promise<void>;
export declare function normalizeMaxRedirects(value: number | undefined): number;
