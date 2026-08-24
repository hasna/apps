import type { ChannelConfig, DeliveryAttempt, DeliveryResult, EventEnvelope } from "./types.js";
import { type WebhookTargetPolicy } from "./ssrf.js";
export interface TransportTlsOptions {
    /**
     * Override the certificate authorities used by the pinned native transport
     * (for example a private PKI or a self-signed test certificate). Ignored on
     * an injected `fetchImpl` path, where the operator owns TLS. Defaults to the
     * runtime's standard CA store.
     */
    ca?: string | Buffer | Array<string | Buffer>;
}
export interface TransportDispatchOptions {
    fetchImpl?: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
    secretResolver?: WebhookSecretResolver;
    now?: () => Date;
    /**
     * TLS options for the pinned native transport (the default, non-injected
     * fetch path). `ca` overrides the trusted certificate authorities.
     */
    tls?: TransportTlsOptions;
    /**
     * Webhook-target SSRF policy. When provided, the durable webhook transport
     * validates every target (and every redirect hop) against it. When omitted,
     * the guard still applies on the default `fetch` path and is deferred to an
     * injected `fetchImpl` (the operator who injects a fetch implementation owns
     * the network boundary).
     */
    webhookTargetPolicy?: WebhookTargetPolicy;
}
export type WebhookSecretResolver = (reference: string) => string | undefined | Promise<string | undefined>;
export interface BuildWebhookRequestOptions {
    secret?: string;
    timestamp?: string;
}
export declare function buildWebhookRequest(event: EventEnvelope, channel: ChannelConfig, options?: BuildWebhookRequestOptions): {
    body: string;
    headers: Record<string, string>;
};
export declare function dispatchWebhook(event: EventEnvelope, channel: ChannelConfig, options?: TransportDispatchOptions): Promise<DeliveryAttempt>;
export declare function dispatchCommand(event: EventEnvelope, channel: ChannelConfig): Promise<DeliveryAttempt>;
export declare function dispatchChannel(event: EventEnvelope, channel: ChannelConfig, options?: TransportDispatchOptions): Promise<DeliveryAttempt>;
export declare function createDeliveryResult(event: EventEnvelope, channel: ChannelConfig, attempts: DeliveryAttempt[]): DeliveryResult;
