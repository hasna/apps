import { type EffectiveTemplate } from "./schema.js";
export interface CloudInitOptions {
    /** Station identity, e.g. station17 — becomes hostname and tailscale name. */
    station?: string;
    /** Login user provisioned on the instance. */
    user?: string;
}
/**
 * Render the effective station template as cloud-init user-data for an EC2
 * station. Same source data as the physical render — the whole point of the
 * template is one source, two serializations (station contract §8.3).
 *
 * Secret NAMES are rendered; values are pulled at boot from AWS Secrets
 * Manager via the instance role and passed by file:, never argv.
 */
export declare function renderCloudInit(effective: EffectiveTemplate, options?: CloudInitOptions): string;
