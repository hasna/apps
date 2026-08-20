import { type CompatibilityCommandRunner, type MachineCompatibilityReport } from "./compatibility.js";
import { STATIONS_CONSUMER_CONTRACT_VERSION, getStationsConsumerCapabilities, type MachineRouteConfidence, type MachineRouteKind, type MachineTopology, type StationsContractPackage } from "./topology.js";
export declare const BROWSERPLAN_FLEET_KIND = "browserplan_fleet";
/**
 * BrowserPlan distribution source of truth. The `hasna/chrome` git repository is being
 * retired under owner authorisation, so npm becomes the only distribution artifact: the
 * package ships raw TypeScript (no `dist/`) and provides the `browserplan` bin.
 */
export declare const BROWSERPLAN_PACKAGE_NAME = "@hasna/open-chrome";
export declare const BROWSERPLAN_CLI_COMMAND = "browserplan";
/**
 * Contract owner id for every BrowserPlan-owned surface (`target.owner`,
 * `operation_contract.command_owner`, `operation_hooks[].owner`, safe-runner ownership)
 * and the workspace/project key machine manifests use. Must stay equal to
 * `defaultAppIdForPackage(BROWSERPLAN_PACKAGE_NAME)`; test/browserplan.test.ts pins that.
 */
export declare const BROWSERPLAN_APP_ID = "open-chrome";
/** Route owner id for this package, i.e. `defaultAppIdForPackage(STATIONS_PACKAGE_NAME)`. */
export declare const BROWSERPLAN_ROUTE_OWNER = "stations";
export declare const BROWSERPLAN_SECRETS_OWNER = "open-identities/open-attachments/open-mailery";
/**
 * Command prefix every accepted `app_install_update` template must start with. Kept as a
 * prefix rather than a whole command so a caller may pin a concrete version
 * (`…@0.1.0`) instead of tracking the dist-tag and still validate.
 */
export declare const BROWSERPLAN_INSTALL_UPDATE_COMMAND_PREFIX = "bun install -g @hasna/open-chrome@";
/**
 * What may follow that prefix: either an EXACT semver, or a DOT-FREE dist-tag of two or
 * more characters. Nothing else.
 *
 * End-anchored, so no shell suffix can be appended after an otherwise valid install
 * (`&& rm -rf /`, `; curl … | sh`, `; cd d && git pull`, `` `id` ``, `$(id)`), and an
 * empty version is rejected.
 *
 * The tag arm forbids `.` on purpose, and that single restriction is what rejects the
 * whole wildcard-range class rather than an enumeration of its members. Bun's resolver
 * coerces far more than an `x`-character class into "any version": `bun add
 * @hasna/open-chrome@<spec>` exits 0 and installs 0.1.0 for `x.x`, `x.y`, `X.Y`, `x.`,
 * `x..x`, `x.x.`, `x.x-`, `x.-` and `x.x_1` — note `x.y` contains no wildcard character
 * at all. Enumerating those forms was tried twice and leaked twice; the resolver, not a
 * character class, is the oracle. Any range makes the installed version unpredictable,
 * which defeats both the pin below and the `<bin> --version` assertion
 * src/commands/reconcile.ts uses to verify a rollout.
 *
 * Also note bun and npm DISAGREE here: `npm view @hasna/open-chrome@x.y version` returns
 * E404 while bun installs it. The hook command is `bun install -g`, so bun is the oracle
 * that matters.
 *
 * Residual, accepted knowingly: a real dist-tag containing a dot would be rejected. npm
 * dist-tags conventionally do not contain dots (a tag may not be a valid semver), and this
 * rule governs exactly one package whose tags are `{"latest":"0.1.0"}`.
 *
 * MUST STAY UNFLAGGED. It is a shared module-level object, so adding `/g` (or `/y`) would
 * make `.test()` advance `lastIndex` between calls — which is not hypothetical: it turns
 * ordinary multi-machine tests red, because successive stations in one payload get
 * alternating results.
 *
 * This constrains command *shape*, not registry trust: a legitimate but hostile-looking
 * dist-tag such as `latest-evil` is accepted.
 */
export declare const BROWSERPLAN_INSTALL_VERSION_PATTERN: RegExp;
/**
 * Exact version the install hook pins.
 *
 * DELIBERATELY PINNED, NOT `latest` — do not "improve" this to a floating tag.
 *
 * The decisive reason is AUDITABILITY, not supply-chain risk. The published metadata for
 * this package carries `gitHead: f49b5c42…`, which resolves to nothing once the BrowserPlan
 * source repository is retired. If a floating tag ever moved after that point there would
 * be no diff, no history and no provenance to inspect — and this hook installs it silently.
 * A pin also gives src/commands/reconcile.ts something to verify: it asserts
 * `<bin> --version` equals the target, which only works against an exact version.
 *
 * Secondary: npm becomes the sole artifact for the package (one version, raw TypeScript,
 * no build output, no maintainer watching the name), so a moved dist-tag would reach every
 * fleet machine through a `bun install -g`. The usual argument for a floating tag — that a
 * pin cannot deliver a future fix — costs nothing here, because republishing requires
 * someone to deliberately hold the source mirror, and that same change can bump this
 * constant. `dist-tags` is `{"latest":"0.1.0"}` today, so the pin currently costs nothing
 * at all.
 */
export declare const BROWSERPLAN_PINNED_VERSION = "0.1.0";
/**
 * `app_install_update` installs/updates BrowserPlan from npm rather than from a checkout,
 * because the source repository is being retired under owner authorisation.
 *
 * No version placeholder is exposed: nothing in this package could resolve one
 * (`getPackageVersion()` returns *stations*' own version), unlike
 * src/commands/reconcile.ts which pins versions from the fleet manifest. The template is
 * therefore directly runnable as emitted.
 */
export declare const BROWSERPLAN_INSTALL_UPDATE_COMMAND_TEMPLATE = "bun install -g @hasna/open-chrome@0.1.0";
/**
 * The pre-retirement template. Still ACCEPTED by validation so that a consumer holding a
 * cached payload from `@hasna/stations` <= 0.2.2 does not start failing; it is simply no
 * longer emitted. See the compatibility note in CHANGELOG.md.
 */
export declare const BROWSERPLAN_LEGACY_INSTALL_UPDATE_COMMAND_TEMPLATE = "cd <open-chrome-project-root> && git pull --ff-only origin main && bun install --frozen-lockfile";
export declare const BROWSERPLAN_TARGET_NAME = "browserplan-machine001-machine011";
export declare const BROWSERPLAN_MACHINE_IDS: readonly ["machine001", "machine002", "machine003", "machine004", "machine005", "machine006", "machine007", "machine008", "machine009", "machine010", "machine011"];
export declare const BROWSERPLAN_EXCLUDED_MACHINE_IDS: readonly ["spark01", "spark02"];
export type BrowserPlanMachineId = typeof BROWSERPLAN_MACHINE_IDS[number];
export type BrowserPlanExcludedMachineId = typeof BROWSERPLAN_EXCLUDED_MACHINE_IDS[number];
export type BrowserPlanCapabilityState = "available" | "missing" | "unknown" | "failed";
export type BrowserPlanOperationId = "profile_setup" | "headed_launch" | "headless_launch" | "daemon_status" | "supervisor_status" | "tab_inventory" | "session_inventory" | "app_install_update";
export interface BrowserPlanFleetOptions {
    machineIds?: string[];
    topology?: MachineTopology;
    includeTailscale?: boolean;
    includeInstallState?: boolean;
    runner?: CompatibilityCommandRunner;
    now?: Date;
}
export interface BrowserPlanMachineStatus {
    state: "online" | "offline" | "unknown";
    label: "Online" | "Offline" | "Unknown";
    online: boolean | null;
    last_seen_at?: string;
    last_heartbeat_at?: string;
}
export interface BrowserPlanMachineReachability {
    ok: boolean;
    route: MachineRouteKind;
    source: MachineRouteKind;
    confidence: MachineRouteConfidence;
    local: boolean;
    tailscale_online: boolean | null;
    cacheable: boolean;
    warnings: string[];
}
export interface BrowserPlanCapability {
    state: BrowserPlanCapabilityState;
    command: string;
    version: string | null;
    detail: string | null;
}
export interface BrowserPlanInstallState {
    checked: boolean;
    source: "compatibility" | "not_checked" | "failed";
    browserplan_cli: BrowserPlanCapability;
    stations_cli: BrowserPlanCapability;
    bun: BrowserPlanCapability;
    git: BrowserPlanCapability;
    node: BrowserPlanCapability;
    chrome: BrowserPlanCapability;
    compatibility_summary?: MachineCompatibilityReport["summary"];
    warnings: string[];
}
export interface BrowserPlanWorkspaceSummary {
    workspace_path: string | null;
    project_root: string | null;
    project_root_source: string;
    open_files_root: string | null;
    open_files_root_source: string;
    trust_status: string;
    auth_status: string;
}
export interface BrowserPlanSafeRunnerContract {
    sdk: {
        function: "runMachineCommand";
        machine_id: string;
        command_argument: "<browserplan-owned command>";
        timeout_ms: number;
    };
    cli: {
        command: string[];
        private_metadata_note: string;
    };
    mcp: {
        tool: "stations_ssh_resolve";
        args: {
            machine_id: string;
            remote_command: "<browserplan-owned command>";
            private_metadata: false;
        };
        private_metadata_note: string;
    };
    ownership: {
        command_owner: typeof BROWSERPLAN_APP_ID;
        route_owner: typeof BROWSERPLAN_ROUTE_OWNER;
        secrets_owner: typeof BROWSERPLAN_SECRETS_OWNER;
    };
}
export interface BrowserPlanOperationHook {
    id: BrowserPlanOperationId;
    label: string;
    description: string;
    owner: typeof BROWSERPLAN_APP_ID;
    available: boolean;
    readiness: "ready" | "blocked" | "unknown";
    launch_mode?: "headed" | "headless";
    required_capabilities: string[];
    blocked_by: string[];
    command_template: string;
    command_placeholders: string[];
    safe_runner: BrowserPlanSafeRunnerContract;
}
export interface BrowserPlanMachine {
    machine_id: BrowserPlanMachineId;
    slug: BrowserPlanMachineId;
    display_name: string;
    displayName: string;
    friendly_name: string | null;
    friendlyName: string | null;
    target_group: typeof BROWSERPLAN_TARGET_NAME;
    known: boolean;
    eligible: boolean;
    eligibility_reasons: string[];
    platform: string | null;
    os: string | null;
    user: string | null;
    workspace: BrowserPlanWorkspaceSummary;
    tags: string[];
    updated_at: string | null;
    status: BrowserPlanMachineStatus;
    reachability: BrowserPlanMachineReachability;
    daemon: {
        mode: string | null;
        version: string | null;
        storage_sync_status: string | null;
        heartbeat_status: string;
    };
    install_state: BrowserPlanInstallState;
    operation_hooks: BrowserPlanOperationHook[];
    warnings: string[];
}
export interface BrowserPlanFleet {
    schema_version: typeof STATIONS_CONSUMER_CONTRACT_VERSION;
    package: StationsContractPackage;
    capabilities: ReturnType<typeof getStationsConsumerCapabilities>;
    generated_at: string;
    kind: typeof BROWSERPLAN_FLEET_KIND;
    target: {
        name: typeof BROWSERPLAN_TARGET_NAME;
        owner: typeof BROWSERPLAN_APP_ID;
        machine_ids: BrowserPlanMachineId[];
        excluded_machine_ids: BrowserPlanExcludedMachineId[];
        install_target_excludes: BrowserPlanExcludedMachineId[];
    };
    coverage: {
        expected: number;
        returned: number;
        known: number;
        missing: BrowserPlanMachineId[];
        unreachable: BrowserPlanMachineId[];
        excluded_requested: BrowserPlanExcludedMachineId[];
    };
    operation_contract: {
        command_owner: typeof BROWSERPLAN_APP_ID;
        route_owner: typeof BROWSERPLAN_ROUTE_OWNER;
        default_timeout_ms: number;
        private_route_policy: "private targets are omitted unless caller explicitly requests private metadata on a trusted local operator surface";
        supported_operations: BrowserPlanOperationId[];
        stable_surfaces: {
            sdk: "getBrowserPlanFleet";
            cli: "stations browserplan fleet --json";
            api: "/api/browserplan/fleet";
            mcp: "stations_browserplan_fleet";
        };
    };
    stations: BrowserPlanMachine[];
    warnings: string[];
}
export declare function normalizeBrowserPlanMachineId(value: string): BrowserPlanMachineId | null;
export declare function getBrowserPlanFleet(options?: BrowserPlanFleetOptions): BrowserPlanFleet;
