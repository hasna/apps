import type { SetupStep } from "../types.js";
import { type EffectiveTemplate } from "./schema.js";
/**
 * Render the effective station template into idempotent setup steps for a
 * PHYSICAL box (stations setup --template ...). The cloud render shares the
 * same source data — see render-cloud-init.ts.
 */
export declare function buildStationTemplateSteps(effective: EffectiveTemplate, options?: {
    station?: string;
}): SetupStep[];
