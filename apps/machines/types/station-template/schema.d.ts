import { z } from "zod";
/**
 * hasna.station_template.v1 — versioned station template (station contract §8).
 *
 * Every item in the shipped template traces to a measured 2026-07-28 failure on
 * station01; the `lesson` field carries that trace so the template stays
 * evidence-first instead of accreting cargo cult.
 */
export declare const STATION_TEMPLATE_SCHEMA_ID = "hasna.station_template.v1";
/** Files that participate in lexicographic-ordering directories must sort last. */
export declare const ORDERING_SENSITIVE_KINDS: readonly ["sysctl", "tmpfiles", "journald-dropin"];
export declare const ORDERING_PREFIX = "99-zz-";
export declare const templateFileSchema: z.ZodObject<{
    id: z.ZodString;
    /** Path relative to the template directory. */
    source: z.ZodString;
    /**
     * Absolute target path, or `~/`-prefixed for a home-relative target
     * (e.g. systemd user units).
     */
    target: z.ZodString;
    mode: z.ZodDefault<z.ZodString>;
    kind: z.ZodDefault<z.ZodEnum<["sysctl", "tmpfiles", "systemd-dropin", "systemd-user-unit", "journald-dropin", "plain", "bashrc-block"]>>;
    /** Which measured failure this file exists to prevent. */
    lesson: z.ZodString;
}, "strip", z.ZodTypeAny, {
    id: string;
    mode: string;
    source: string;
    target: string;
    kind: "sysctl" | "tmpfiles" | "journald-dropin" | "systemd-dropin" | "systemd-user-unit" | "plain" | "bashrc-block";
    lesson: string;
}, {
    id: string;
    source: string;
    target: string;
    lesson: string;
    mode?: string | undefined;
    kind?: "sysctl" | "tmpfiles" | "journald-dropin" | "systemd-dropin" | "systemd-user-unit" | "plain" | "bashrc-block" | undefined;
}>;
/**
 * A bun global the station must carry, and the MINIMUM version it must be at.
 *
 * Presence alone was the contract until 2026-07-30, and it made 12 of the 42
 * drift items version-blind: a station carrying a year-old `@hasna/todos`
 * reported `ok` on the same axis as a station updated an hour ago. The defect
 * was pinned by a test that asserted a 9.9.9 fixture read `ok`
 * (station-template.test.ts, now inverted), so the blindness was load-bearing
 * rather than accidental.
 *
 * `minVersion` is a FLOOR, never a pin: the fleet updates continuously and a
 * template that pinned exact versions would report drift on every publish.
 * The floor is the version published when the template version shipped, so
 * "clean" means "not running an older CLI than the one we shipped with".
 *
 * The bare-string form stays valid so an out-of-tree template keeps loading,
 * but it carries no floor and the check says so in the item detail. The
 * shipped template must never use it — pinned by
 * `test("every bun global in the shipped template declares a minVersion floor")`.
 */
export declare const bunPackageSchema: z.ZodUnion<[z.ZodEffects<z.ZodString, {
    name: string;
    minVersion: string | undefined;
    lesson: string | undefined;
}, string>, z.ZodObject<{
    name: z.ZodString;
    /** Minimum acceptable installed version (semver x.y.z). Floor, not pin. */
    minVersion: z.ZodOptional<z.ZodString>;
    lesson: z.ZodOptional<z.ZodString>;
}, "strip", z.ZodTypeAny, {
    name: string;
    lesson?: string | undefined;
    minVersion?: string | undefined;
}, {
    name: string;
    lesson?: string | undefined;
    minVersion?: string | undefined;
}>]>;
export declare const templatePackagesSchema: z.ZodObject<{
    apt: z.ZodDefault<z.ZodArray<z.ZodString, "many">>;
    bun: z.ZodDefault<z.ZodArray<z.ZodUnion<[z.ZodEffects<z.ZodString, {
        name: string;
        minVersion: string | undefined;
        lesson: string | undefined;
    }, string>, z.ZodObject<{
        name: z.ZodString;
        /** Minimum acceptable installed version (semver x.y.z). Floor, not pin. */
        minVersion: z.ZodOptional<z.ZodString>;
        lesson: z.ZodOptional<z.ZodString>;
    }, "strip", z.ZodTypeAny, {
        name: string;
        lesson?: string | undefined;
        minVersion?: string | undefined;
    }, {
        name: string;
        lesson?: string | undefined;
        minVersion?: string | undefined;
    }>]>, "many">>;
}, "strip", z.ZodTypeAny, {
    bun: ({
        name: string;
        minVersion: string | undefined;
        lesson: string | undefined;
    } | {
        name: string;
        lesson?: string | undefined;
        minVersion?: string | undefined;
    })[];
    apt: string[];
}, {
    bun?: (string | {
        name: string;
        lesson?: string | undefined;
        minVersion?: string | undefined;
    })[] | undefined;
    apt?: string[] | undefined;
}>;
export type BunPackage = z.infer<typeof bunPackageSchema>;
/**
 * A binary the station must be able to resolve on PATH, plus the idempotent
 * shell that provides it.
 *
 * This exists because "apt package" is NOT a general way to say "this command
 * must be present": the ec2 overlay declared apt `awscli`, which has no
 * installation candidate on Ubuntu 24.04 (noble dropped the deb), so the
 * requirement could never be satisfied and could never be converged away.
 * Express the requirement as the command, and carry the install alongside it.
 */
export declare const templateCommandSchema: z.ZodObject<{
    id: z.ZodString;
    /** Binary that must resolve on PATH. */
    command: z.ZodString;
    /** Idempotent shell that installs it. Runs only when the command is absent. */
    install: z.ZodString;
    /** Which measured failure this command exists to prevent. */
    lesson: z.ZodString;
}, "strip", z.ZodTypeAny, {
    command: string;
    id: string;
    install: string;
    lesson: string;
}, {
    command: string;
    id: string;
    install: string;
    lesson: string;
}>;
export declare const templateServiceSchema: z.ZodObject<{
    name: z.ZodString;
    scope: z.ZodDefault<z.ZodEnum<["system", "user"]>>;
    expectEnabled: z.ZodDefault<z.ZodBoolean>;
    expectActive: z.ZodDefault<z.ZodBoolean>;
}, "strip", z.ZodTypeAny, {
    name: string;
    scope: "user" | "system";
    expectEnabled: boolean;
    expectActive: boolean;
}, {
    name: string;
    scope?: "user" | "system" | undefined;
    expectEnabled?: boolean | undefined;
    expectActive?: boolean | undefined;
}>;
export declare const runtimeValueSchema: z.ZodObject<{
    /** Absolute path of the runtime file to compare (e.g. /sys/kernel/mm/lru_gen/min_ttl_ms). */
    path: z.ZodString;
    value: z.ZodString;
    lesson: z.ZodString;
}, "strip", z.ZodTypeAny, {
    value: string;
    path: string;
    lesson: string;
}, {
    value: string;
    path: string;
    lesson: string;
}>;
export declare const unitConventionsSchema: z.ZodObject<{
    /** Unit-name glob the conventions apply to. */
    match: z.ZodDefault<z.ZodString>;
    startLimitIntervalSec: z.ZodDefault<z.ZodNumber>;
    startLimitBurst: z.ZodDefault<z.ZodNumber>;
    onFailureUnit: z.ZodDefault<z.ZodString>;
    requireAbsoluteExecStart: z.ZodDefault<z.ZodBoolean>;
    lesson: z.ZodString;
}, "strip", z.ZodTypeAny, {
    match: string;
    lesson: string;
    startLimitIntervalSec: number;
    startLimitBurst: number;
    onFailureUnit: string;
    requireAbsoluteExecStart: boolean;
}, {
    lesson: string;
    match?: string | undefined;
    startLimitIntervalSec?: number | undefined;
    startLimitBurst?: number | undefined;
    onFailureUnit?: string | undefined;
    requireAbsoluteExecStart?: boolean | undefined;
}>;
/**
 * The guaranteed access path for a station class — a service that depends only
 * on identity the platform already grants (EC2: the SSM agent via the instance
 * profile), NEVER on a credential fetched at boot.
 *
 * Owner ruling 2026-07-29 (station17): nothing that requires fetching a secret
 * at boot may sit on the critical path to a machine's reachability. Tailscale
 * is an access path, not a boot dependency; the floor is what makes its
 * failure survivable. Physical station classes declare no floor service here —
 * their floor is an out-of-band path (console, physical port).
 */
export declare const accessFloorSchema: z.ZodObject<{
    /** systemd unit that provides the floor access path. */
    service: z.ZodString;
    /** Idempotent shell that installs/enables the floor. Must need no secret. */
    ensure: z.ZodString;
    /** Which measured failure this floor exists to prevent. */
    lesson: z.ZodString;
}, "strip", z.ZodTypeAny, {
    lesson: string;
    service: string;
    ensure: string;
}, {
    lesson: string;
    service: string;
    ensure: string;
}>;
/**
 * Tailscale membership — PHYSICAL station classes only.
 *
 * Owner ruling 2026-07-30 (supersedes the 2026-07-29 "never boot-critical"
 * ruling): AWS stations do not run tailscale at all, and the cloud fleet is
 * not connected to the physical fleet — joining EC2 hosts to the tailnet that
 * carries the operator's own machines makes every cloud instance a peer of
 * every physical station, a blast radius nobody chose. SSM (the ec2
 * accessFloor) is the whole access path for cloud stations, not a floor
 * beneath a mesh. This block therefore lives only in physical overlays; the
 * base layer must not carry it, so no cloud render can ever reach an auth-key
 * secret name. Enforced by the absence assertions in station-template.test.ts
 * (which carry their own positive control). A single AWS box MAY later be
 * granted tailscale as a deliberate, argued-for exception via its own overlay
 * — never the default, never base.
 */
export declare const tailscaleSchema: z.ZodObject<{
    join: z.ZodDefault<z.ZodBoolean>;
    /** Secret NAME only — the value is pulled at runtime, never rendered. */
    authKeySecretName: z.ZodString;
    hostnameFromStation: z.ZodDefault<z.ZodBoolean>;
    /** Enable Tailscale SSH so the tailnet is the whole access plane. */
    ssh: z.ZodDefault<z.ZodBoolean>;
}, "strip", z.ZodTypeAny, {
    ssh: boolean;
    join: boolean;
    authKeySecretName: string;
    hostnameFromStation: boolean;
}, {
    authKeySecretName: string;
    ssh?: boolean | undefined;
    join?: boolean | undefined;
    hostnameFromStation?: boolean | undefined;
}>;
/**
 * A DECLARED ABSENCE — something this station class must NOT have, asserted so
 * that its presence can go red.
 *
 * Owner ruling 2026-07-30 removed tailscale from AWS stations. The first
 * implementation of that ruling deleted the tailscale check from the EC2 path
 * and stopped there, which is how the ruling became UNASSERTED: `check.ts`
 * guarded the whole tailscale block on `effective.tailscale?.join`, so an EC2
 * render emitted no tailscale item at all (`tailscale_items=[]`, station17,
 * 2026-07-30 22:02Z) and a station18 running a LIVE tailscale
 * (`BackendState=Running`) still read clean 42/42. An absence that nothing
 * checks is a claim, not a control.
 *
 * This is deliberately NOT a `tailscale:join` check. Asking "is the tailnet
 * healthy" on a box that must not be on a tailnet is noise, and noise is how
 * real drift gets ignored. The item asks one question — "is it here?" — and
 * the only acceptable answer is no.
 *
 * At least one probe (command / service / paths) must be declared, or the
 * item would be vacuously ok: exactly the shape being fixed.
 */
export declare const absenceSchema: z.ZodEffects<z.ZodObject<{
    id: z.ZodString;
    /** Binary that must NOT resolve on PATH. */
    command: z.ZodOptional<z.ZodString>;
    /** systemd unit that must NOT be known to systemd (LoadState=not-found). */
    service: z.ZodOptional<z.ZodString>;
    /** Absolute paths (binaries, state dirs, config) none of which may exist. */
    paths: z.ZodDefault<z.ZodArray<z.ZodString, "many">>;
    /** Which measured failure this absence exists to prevent. */
    lesson: z.ZodString;
}, "strip", z.ZodTypeAny, {
    id: string;
    paths: string[];
    lesson: string;
    command?: string | undefined;
    service?: string | undefined;
}, {
    id: string;
    lesson: string;
    command?: string | undefined;
    paths?: string[] | undefined;
    service?: string | undefined;
}>, {
    id: string;
    paths: string[];
    lesson: string;
    command?: string | undefined;
    service?: string | undefined;
}, {
    id: string;
    lesson: string;
    command?: string | undefined;
    paths?: string[] | undefined;
    service?: string | undefined;
}>;
export declare const secretsBootstrapSchema: z.ZodObject<{
    /** Secret NAME only. */
    envSecretName: z.ZodString;
    optional: z.ZodDefault<z.ZodBoolean>;
}, "strip", z.ZodTypeAny, {
    optional: boolean;
    envSecretName: string;
}, {
    envSecretName: string;
    optional?: boolean | undefined;
}>;
export declare const swapSchema: z.ZodObject<{
    sizeGb: z.ZodDefault<z.ZodNumber>;
}, "strip", z.ZodTypeAny, {
    sizeGb: number;
}, {
    sizeGb?: number | undefined;
}>;
/**
 * Free disk (GiB) that must remain after the swapfile is allocated. station17
 * build 2 (2026-07-29) died of `fallocate -l 8G` on an 8G AMI-default root
 * volume: the partial 4.2G file filled the disk to 364K available, journald
 * could not create a journal, and cloud-final FAILED. Both renders refuse to
 * allocate swap unless (sizeGb + this margin) GiB are free, and warn
 * non-fatally instead.
 */
export declare const SWAP_HEADROOM_GB = 2;
/**
 * The one swapfile path both renders manage and /etc/fstab names. Centralized
 * (PR #46 review P3-C) so the renders, the fstab entry, and any future
 * per-path check all read the same value instead of four literals drifting.
 * Note the drift check's swap:size intentionally sums ALL of /proc/swaps —
 * total swap is the earlyoom-relevant quantity — so a box swapping on another
 * name still counts.
 */
export declare const SWAP_FILE_PATH = "/swapfile";
/**
 * Minimum root-volume size for a station class. The template cannot set the
 * volume at launch time — that lives in the launcher's BlockDeviceMappings —
 * but declaring the floor here makes the requirement config-driven for launch
 * tooling AND checkable after boot: an undersized root cannot be converged by
 * setup, so the drift check reports it as a violation demanding a relaunch.
 */
export declare const diskSchema: z.ZodObject<{
    /** Minimum root filesystem size in GiB (launcher must request at least this). */
    rootMinGb: z.ZodNumber;
    /**
     * Minimum FREE space in GiB before the drift check reports the box.
     * station17 build 2: at hard-0 free the SSM agent could not write its
     * orchestration files and commands returned EMPTY output rather than
     * errors — a full disk silently degrades the only access path, so it must
     * be reported while there is still room to act.
     */
    minFreeGb: z.ZodOptional<z.ZodNumber>;
    /** Which measured failure this floor exists to prevent. */
    lesson: z.ZodString;
}, "strip", z.ZodTypeAny, {
    lesson: string;
    rootMinGb: number;
    minFreeGb?: number | undefined;
}, {
    lesson: string;
    rootMinGb: number;
    minFreeGb?: number | undefined;
}>;
export declare const templateLayerSchema: z.ZodObject<{
    files: z.ZodDefault<z.ZodArray<z.ZodObject<{
        id: z.ZodString;
        /** Path relative to the template directory. */
        source: z.ZodString;
        /**
         * Absolute target path, or `~/`-prefixed for a home-relative target
         * (e.g. systemd user units).
         */
        target: z.ZodString;
        mode: z.ZodDefault<z.ZodString>;
        kind: z.ZodDefault<z.ZodEnum<["sysctl", "tmpfiles", "systemd-dropin", "systemd-user-unit", "journald-dropin", "plain", "bashrc-block"]>>;
        /** Which measured failure this file exists to prevent. */
        lesson: z.ZodString;
    }, "strip", z.ZodTypeAny, {
        id: string;
        mode: string;
        source: string;
        target: string;
        kind: "sysctl" | "tmpfiles" | "journald-dropin" | "systemd-dropin" | "systemd-user-unit" | "plain" | "bashrc-block";
        lesson: string;
    }, {
        id: string;
        source: string;
        target: string;
        lesson: string;
        mode?: string | undefined;
        kind?: "sysctl" | "tmpfiles" | "journald-dropin" | "systemd-dropin" | "systemd-user-unit" | "plain" | "bashrc-block" | undefined;
    }>, "many">>;
    packages: z.ZodDefault<z.ZodObject<{
        apt: z.ZodDefault<z.ZodArray<z.ZodString, "many">>;
        bun: z.ZodDefault<z.ZodArray<z.ZodUnion<[z.ZodEffects<z.ZodString, {
            name: string;
            minVersion: string | undefined;
            lesson: string | undefined;
        }, string>, z.ZodObject<{
            name: z.ZodString;
            /** Minimum acceptable installed version (semver x.y.z). Floor, not pin. */
            minVersion: z.ZodOptional<z.ZodString>;
            lesson: z.ZodOptional<z.ZodString>;
        }, "strip", z.ZodTypeAny, {
            name: string;
            lesson?: string | undefined;
            minVersion?: string | undefined;
        }, {
            name: string;
            lesson?: string | undefined;
            minVersion?: string | undefined;
        }>]>, "many">>;
    }, "strip", z.ZodTypeAny, {
        bun: ({
            name: string;
            minVersion: string | undefined;
            lesson: string | undefined;
        } | {
            name: string;
            lesson?: string | undefined;
            minVersion?: string | undefined;
        })[];
        apt: string[];
    }, {
        bun?: (string | {
            name: string;
            lesson?: string | undefined;
            minVersion?: string | undefined;
        })[] | undefined;
        apt?: string[] | undefined;
    }>>;
    /** Binaries that must resolve on PATH, with their idempotent installers. */
    commands: z.ZodDefault<z.ZodArray<z.ZodObject<{
        id: z.ZodString;
        /** Binary that must resolve on PATH. */
        command: z.ZodString;
        /** Idempotent shell that installs it. Runs only when the command is absent. */
        install: z.ZodString;
        /** Which measured failure this command exists to prevent. */
        lesson: z.ZodString;
    }, "strip", z.ZodTypeAny, {
        command: string;
        id: string;
        install: string;
        lesson: string;
    }, {
        command: string;
        id: string;
        install: string;
        lesson: string;
    }>, "many">>;
    services: z.ZodDefault<z.ZodArray<z.ZodObject<{
        name: z.ZodString;
        scope: z.ZodDefault<z.ZodEnum<["system", "user"]>>;
        expectEnabled: z.ZodDefault<z.ZodBoolean>;
        expectActive: z.ZodDefault<z.ZodBoolean>;
    }, "strip", z.ZodTypeAny, {
        name: string;
        scope: "user" | "system";
        expectEnabled: boolean;
        expectActive: boolean;
    }, {
        name: string;
        scope?: "user" | "system" | undefined;
        expectEnabled?: boolean | undefined;
        expectActive?: boolean | undefined;
    }>, "many">>;
    /** Install, activate, and semantically verify the package-owned aggregate test controller. */
    workstationTestProfile: z.ZodDefault<z.ZodBoolean>;
    /** Runtime sysctl expectations (key → value), checked via /proc/sys. */
    sysctls: z.ZodDefault<z.ZodRecord<z.ZodString, z.ZodString>>;
    runtimeValues: z.ZodDefault<z.ZodArray<z.ZodObject<{
        /** Absolute path of the runtime file to compare (e.g. /sys/kernel/mm/lru_gen/min_ttl_ms). */
        path: z.ZodString;
        value: z.ZodString;
        lesson: z.ZodString;
    }, "strip", z.ZodTypeAny, {
        value: string;
        path: string;
        lesson: string;
    }, {
        value: string;
        path: string;
        lesson: string;
    }>, "many">>;
    unitConventions: z.ZodOptional<z.ZodObject<{
        /** Unit-name glob the conventions apply to. */
        match: z.ZodDefault<z.ZodString>;
        startLimitIntervalSec: z.ZodDefault<z.ZodNumber>;
        startLimitBurst: z.ZodDefault<z.ZodNumber>;
        onFailureUnit: z.ZodDefault<z.ZodString>;
        requireAbsoluteExecStart: z.ZodDefault<z.ZodBoolean>;
        lesson: z.ZodString;
    }, "strip", z.ZodTypeAny, {
        match: string;
        lesson: string;
        startLimitIntervalSec: number;
        startLimitBurst: number;
        onFailureUnit: string;
        requireAbsoluteExecStart: boolean;
    }, {
        lesson: string;
        match?: string | undefined;
        startLimitIntervalSec?: number | undefined;
        startLimitBurst?: number | undefined;
        onFailureUnit?: string | undefined;
        requireAbsoluteExecStart?: boolean | undefined;
    }>>;
    accessFloor: z.ZodOptional<z.ZodObject<{
        /** systemd unit that provides the floor access path. */
        service: z.ZodString;
        /** Idempotent shell that installs/enables the floor. Must need no secret. */
        ensure: z.ZodString;
        /** Which measured failure this floor exists to prevent. */
        lesson: z.ZodString;
    }, "strip", z.ZodTypeAny, {
        lesson: string;
        service: string;
        ensure: string;
    }, {
        lesson: string;
        service: string;
        ensure: string;
    }>>;
    /** Things this station class must NOT have, asserted so presence goes red. */
    absences: z.ZodDefault<z.ZodArray<z.ZodEffects<z.ZodObject<{
        id: z.ZodString;
        /** Binary that must NOT resolve on PATH. */
        command: z.ZodOptional<z.ZodString>;
        /** systemd unit that must NOT be known to systemd (LoadState=not-found). */
        service: z.ZodOptional<z.ZodString>;
        /** Absolute paths (binaries, state dirs, config) none of which may exist. */
        paths: z.ZodDefault<z.ZodArray<z.ZodString, "many">>;
        /** Which measured failure this absence exists to prevent. */
        lesson: z.ZodString;
    }, "strip", z.ZodTypeAny, {
        id: string;
        paths: string[];
        lesson: string;
        command?: string | undefined;
        service?: string | undefined;
    }, {
        id: string;
        lesson: string;
        command?: string | undefined;
        paths?: string[] | undefined;
        service?: string | undefined;
    }>, {
        id: string;
        paths: string[];
        lesson: string;
        command?: string | undefined;
        service?: string | undefined;
    }, {
        id: string;
        lesson: string;
        command?: string | undefined;
        paths?: string[] | undefined;
        service?: string | undefined;
    }>, "many">>;
    tailscale: z.ZodOptional<z.ZodObject<{
        join: z.ZodDefault<z.ZodBoolean>;
        /** Secret NAME only — the value is pulled at runtime, never rendered. */
        authKeySecretName: z.ZodString;
        hostnameFromStation: z.ZodDefault<z.ZodBoolean>;
        /** Enable Tailscale SSH so the tailnet is the whole access plane. */
        ssh: z.ZodDefault<z.ZodBoolean>;
    }, "strip", z.ZodTypeAny, {
        ssh: boolean;
        join: boolean;
        authKeySecretName: string;
        hostnameFromStation: boolean;
    }, {
        authKeySecretName: string;
        ssh?: boolean | undefined;
        join?: boolean | undefined;
        hostnameFromStation?: boolean | undefined;
    }>>;
    secretsBootstrap: z.ZodOptional<z.ZodObject<{
        /** Secret NAME only. */
        envSecretName: z.ZodString;
        optional: z.ZodDefault<z.ZodBoolean>;
    }, "strip", z.ZodTypeAny, {
        optional: boolean;
        envSecretName: string;
    }, {
        envSecretName: string;
        optional?: boolean | undefined;
    }>>;
    swap: z.ZodOptional<z.ZodObject<{
        sizeGb: z.ZodDefault<z.ZodNumber>;
    }, "strip", z.ZodTypeAny, {
        sizeGb: number;
    }, {
        sizeGb?: number | undefined;
    }>>;
    disk: z.ZodOptional<z.ZodObject<{
        /** Minimum root filesystem size in GiB (launcher must request at least this). */
        rootMinGb: z.ZodNumber;
        /**
         * Minimum FREE space in GiB before the drift check reports the box.
         * station17 build 2: at hard-0 free the SSM agent could not write its
         * orchestration files and commands returned EMPTY output rather than
         * errors — a full disk silently degrades the only access path, so it must
         * be reported while there is still room to act.
         */
        minFreeGb: z.ZodOptional<z.ZodNumber>;
        /** Which measured failure this floor exists to prevent. */
        lesson: z.ZodString;
    }, "strip", z.ZodTypeAny, {
        lesson: string;
        rootMinGb: number;
        minFreeGb?: number | undefined;
    }, {
        lesson: string;
        rootMinGb: number;
        minFreeGb?: number | undefined;
    }>>;
}, "strip", z.ZodTypeAny, {
    files: {
        id: string;
        mode: string;
        source: string;
        target: string;
        kind: "sysctl" | "tmpfiles" | "journald-dropin" | "systemd-dropin" | "systemd-user-unit" | "plain" | "bashrc-block";
        lesson: string;
    }[];
    packages: {
        bun: ({
            name: string;
            minVersion: string | undefined;
            lesson: string | undefined;
        } | {
            name: string;
            lesson?: string | undefined;
            minVersion?: string | undefined;
        })[];
        apt: string[];
    };
    commands: {
        command: string;
        id: string;
        install: string;
        lesson: string;
    }[];
    services: {
        name: string;
        scope: "user" | "system";
        expectEnabled: boolean;
        expectActive: boolean;
    }[];
    workstationTestProfile: boolean;
    sysctls: Record<string, string>;
    runtimeValues: {
        value: string;
        path: string;
        lesson: string;
    }[];
    absences: {
        id: string;
        paths: string[];
        lesson: string;
        command?: string | undefined;
        service?: string | undefined;
    }[];
    tailscale?: {
        ssh: boolean;
        join: boolean;
        authKeySecretName: string;
        hostnameFromStation: boolean;
    } | undefined;
    unitConventions?: {
        match: string;
        lesson: string;
        startLimitIntervalSec: number;
        startLimitBurst: number;
        onFailureUnit: string;
        requireAbsoluteExecStart: boolean;
    } | undefined;
    accessFloor?: {
        lesson: string;
        service: string;
        ensure: string;
    } | undefined;
    secretsBootstrap?: {
        optional: boolean;
        envSecretName: string;
    } | undefined;
    swap?: {
        sizeGb: number;
    } | undefined;
    disk?: {
        lesson: string;
        rootMinGb: number;
        minFreeGb?: number | undefined;
    } | undefined;
}, {
    tailscale?: {
        authKeySecretName: string;
        ssh?: boolean | undefined;
        join?: boolean | undefined;
        hostnameFromStation?: boolean | undefined;
    } | undefined;
    files?: {
        id: string;
        source: string;
        target: string;
        lesson: string;
        mode?: string | undefined;
        kind?: "sysctl" | "tmpfiles" | "journald-dropin" | "systemd-dropin" | "systemd-user-unit" | "plain" | "bashrc-block" | undefined;
    }[] | undefined;
    packages?: {
        bun?: (string | {
            name: string;
            lesson?: string | undefined;
            minVersion?: string | undefined;
        })[] | undefined;
        apt?: string[] | undefined;
    } | undefined;
    commands?: {
        command: string;
        id: string;
        install: string;
        lesson: string;
    }[] | undefined;
    services?: {
        name: string;
        scope?: "user" | "system" | undefined;
        expectEnabled?: boolean | undefined;
        expectActive?: boolean | undefined;
    }[] | undefined;
    workstationTestProfile?: boolean | undefined;
    sysctls?: Record<string, string> | undefined;
    runtimeValues?: {
        value: string;
        path: string;
        lesson: string;
    }[] | undefined;
    unitConventions?: {
        lesson: string;
        match?: string | undefined;
        startLimitIntervalSec?: number | undefined;
        startLimitBurst?: number | undefined;
        onFailureUnit?: string | undefined;
        requireAbsoluteExecStart?: boolean | undefined;
    } | undefined;
    accessFloor?: {
        lesson: string;
        service: string;
        ensure: string;
    } | undefined;
    absences?: {
        id: string;
        lesson: string;
        command?: string | undefined;
        paths?: string[] | undefined;
        service?: string | undefined;
    }[] | undefined;
    secretsBootstrap?: {
        envSecretName: string;
        optional?: boolean | undefined;
    } | undefined;
    swap?: {
        sizeGb?: number | undefined;
    } | undefined;
    disk?: {
        lesson: string;
        rootMinGb: number;
        minFreeGb?: number | undefined;
    } | undefined;
}>;
export declare const stationTemplateSchema: z.ZodEffects<z.ZodObject<{
    $schema: z.ZodLiteral<"hasna.station_template.v1">;
    name: z.ZodString;
    version: z.ZodString;
    description: z.ZodString;
    base: z.ZodObject<{
        files: z.ZodDefault<z.ZodArray<z.ZodObject<{
            id: z.ZodString;
            /** Path relative to the template directory. */
            source: z.ZodString;
            /**
             * Absolute target path, or `~/`-prefixed for a home-relative target
             * (e.g. systemd user units).
             */
            target: z.ZodString;
            mode: z.ZodDefault<z.ZodString>;
            kind: z.ZodDefault<z.ZodEnum<["sysctl", "tmpfiles", "systemd-dropin", "systemd-user-unit", "journald-dropin", "plain", "bashrc-block"]>>;
            /** Which measured failure this file exists to prevent. */
            lesson: z.ZodString;
        }, "strip", z.ZodTypeAny, {
            id: string;
            mode: string;
            source: string;
            target: string;
            kind: "sysctl" | "tmpfiles" | "journald-dropin" | "systemd-dropin" | "systemd-user-unit" | "plain" | "bashrc-block";
            lesson: string;
        }, {
            id: string;
            source: string;
            target: string;
            lesson: string;
            mode?: string | undefined;
            kind?: "sysctl" | "tmpfiles" | "journald-dropin" | "systemd-dropin" | "systemd-user-unit" | "plain" | "bashrc-block" | undefined;
        }>, "many">>;
        packages: z.ZodDefault<z.ZodObject<{
            apt: z.ZodDefault<z.ZodArray<z.ZodString, "many">>;
            bun: z.ZodDefault<z.ZodArray<z.ZodUnion<[z.ZodEffects<z.ZodString, {
                name: string;
                minVersion: string | undefined;
                lesson: string | undefined;
            }, string>, z.ZodObject<{
                name: z.ZodString;
                /** Minimum acceptable installed version (semver x.y.z). Floor, not pin. */
                minVersion: z.ZodOptional<z.ZodString>;
                lesson: z.ZodOptional<z.ZodString>;
            }, "strip", z.ZodTypeAny, {
                name: string;
                lesson?: string | undefined;
                minVersion?: string | undefined;
            }, {
                name: string;
                lesson?: string | undefined;
                minVersion?: string | undefined;
            }>]>, "many">>;
        }, "strip", z.ZodTypeAny, {
            bun: ({
                name: string;
                minVersion: string | undefined;
                lesson: string | undefined;
            } | {
                name: string;
                lesson?: string | undefined;
                minVersion?: string | undefined;
            })[];
            apt: string[];
        }, {
            bun?: (string | {
                name: string;
                lesson?: string | undefined;
                minVersion?: string | undefined;
            })[] | undefined;
            apt?: string[] | undefined;
        }>>;
        /** Binaries that must resolve on PATH, with their idempotent installers. */
        commands: z.ZodDefault<z.ZodArray<z.ZodObject<{
            id: z.ZodString;
            /** Binary that must resolve on PATH. */
            command: z.ZodString;
            /** Idempotent shell that installs it. Runs only when the command is absent. */
            install: z.ZodString;
            /** Which measured failure this command exists to prevent. */
            lesson: z.ZodString;
        }, "strip", z.ZodTypeAny, {
            command: string;
            id: string;
            install: string;
            lesson: string;
        }, {
            command: string;
            id: string;
            install: string;
            lesson: string;
        }>, "many">>;
        services: z.ZodDefault<z.ZodArray<z.ZodObject<{
            name: z.ZodString;
            scope: z.ZodDefault<z.ZodEnum<["system", "user"]>>;
            expectEnabled: z.ZodDefault<z.ZodBoolean>;
            expectActive: z.ZodDefault<z.ZodBoolean>;
        }, "strip", z.ZodTypeAny, {
            name: string;
            scope: "user" | "system";
            expectEnabled: boolean;
            expectActive: boolean;
        }, {
            name: string;
            scope?: "user" | "system" | undefined;
            expectEnabled?: boolean | undefined;
            expectActive?: boolean | undefined;
        }>, "many">>;
        /** Install, activate, and semantically verify the package-owned aggregate test controller. */
        workstationTestProfile: z.ZodDefault<z.ZodBoolean>;
        /** Runtime sysctl expectations (key → value), checked via /proc/sys. */
        sysctls: z.ZodDefault<z.ZodRecord<z.ZodString, z.ZodString>>;
        runtimeValues: z.ZodDefault<z.ZodArray<z.ZodObject<{
            /** Absolute path of the runtime file to compare (e.g. /sys/kernel/mm/lru_gen/min_ttl_ms). */
            path: z.ZodString;
            value: z.ZodString;
            lesson: z.ZodString;
        }, "strip", z.ZodTypeAny, {
            value: string;
            path: string;
            lesson: string;
        }, {
            value: string;
            path: string;
            lesson: string;
        }>, "many">>;
        unitConventions: z.ZodOptional<z.ZodObject<{
            /** Unit-name glob the conventions apply to. */
            match: z.ZodDefault<z.ZodString>;
            startLimitIntervalSec: z.ZodDefault<z.ZodNumber>;
            startLimitBurst: z.ZodDefault<z.ZodNumber>;
            onFailureUnit: z.ZodDefault<z.ZodString>;
            requireAbsoluteExecStart: z.ZodDefault<z.ZodBoolean>;
            lesson: z.ZodString;
        }, "strip", z.ZodTypeAny, {
            match: string;
            lesson: string;
            startLimitIntervalSec: number;
            startLimitBurst: number;
            onFailureUnit: string;
            requireAbsoluteExecStart: boolean;
        }, {
            lesson: string;
            match?: string | undefined;
            startLimitIntervalSec?: number | undefined;
            startLimitBurst?: number | undefined;
            onFailureUnit?: string | undefined;
            requireAbsoluteExecStart?: boolean | undefined;
        }>>;
        accessFloor: z.ZodOptional<z.ZodObject<{
            /** systemd unit that provides the floor access path. */
            service: z.ZodString;
            /** Idempotent shell that installs/enables the floor. Must need no secret. */
            ensure: z.ZodString;
            /** Which measured failure this floor exists to prevent. */
            lesson: z.ZodString;
        }, "strip", z.ZodTypeAny, {
            lesson: string;
            service: string;
            ensure: string;
        }, {
            lesson: string;
            service: string;
            ensure: string;
        }>>;
        /** Things this station class must NOT have, asserted so presence goes red. */
        absences: z.ZodDefault<z.ZodArray<z.ZodEffects<z.ZodObject<{
            id: z.ZodString;
            /** Binary that must NOT resolve on PATH. */
            command: z.ZodOptional<z.ZodString>;
            /** systemd unit that must NOT be known to systemd (LoadState=not-found). */
            service: z.ZodOptional<z.ZodString>;
            /** Absolute paths (binaries, state dirs, config) none of which may exist. */
            paths: z.ZodDefault<z.ZodArray<z.ZodString, "many">>;
            /** Which measured failure this absence exists to prevent. */
            lesson: z.ZodString;
        }, "strip", z.ZodTypeAny, {
            id: string;
            paths: string[];
            lesson: string;
            command?: string | undefined;
            service?: string | undefined;
        }, {
            id: string;
            lesson: string;
            command?: string | undefined;
            paths?: string[] | undefined;
            service?: string | undefined;
        }>, {
            id: string;
            paths: string[];
            lesson: string;
            command?: string | undefined;
            service?: string | undefined;
        }, {
            id: string;
            lesson: string;
            command?: string | undefined;
            paths?: string[] | undefined;
            service?: string | undefined;
        }>, "many">>;
        tailscale: z.ZodOptional<z.ZodObject<{
            join: z.ZodDefault<z.ZodBoolean>;
            /** Secret NAME only — the value is pulled at runtime, never rendered. */
            authKeySecretName: z.ZodString;
            hostnameFromStation: z.ZodDefault<z.ZodBoolean>;
            /** Enable Tailscale SSH so the tailnet is the whole access plane. */
            ssh: z.ZodDefault<z.ZodBoolean>;
        }, "strip", z.ZodTypeAny, {
            ssh: boolean;
            join: boolean;
            authKeySecretName: string;
            hostnameFromStation: boolean;
        }, {
            authKeySecretName: string;
            ssh?: boolean | undefined;
            join?: boolean | undefined;
            hostnameFromStation?: boolean | undefined;
        }>>;
        secretsBootstrap: z.ZodOptional<z.ZodObject<{
            /** Secret NAME only. */
            envSecretName: z.ZodString;
            optional: z.ZodDefault<z.ZodBoolean>;
        }, "strip", z.ZodTypeAny, {
            optional: boolean;
            envSecretName: string;
        }, {
            envSecretName: string;
            optional?: boolean | undefined;
        }>>;
        swap: z.ZodOptional<z.ZodObject<{
            sizeGb: z.ZodDefault<z.ZodNumber>;
        }, "strip", z.ZodTypeAny, {
            sizeGb: number;
        }, {
            sizeGb?: number | undefined;
        }>>;
        disk: z.ZodOptional<z.ZodObject<{
            /** Minimum root filesystem size in GiB (launcher must request at least this). */
            rootMinGb: z.ZodNumber;
            /**
             * Minimum FREE space in GiB before the drift check reports the box.
             * station17 build 2: at hard-0 free the SSM agent could not write its
             * orchestration files and commands returned EMPTY output rather than
             * errors — a full disk silently degrades the only access path, so it must
             * be reported while there is still room to act.
             */
            minFreeGb: z.ZodOptional<z.ZodNumber>;
            /** Which measured failure this floor exists to prevent. */
            lesson: z.ZodString;
        }, "strip", z.ZodTypeAny, {
            lesson: string;
            rootMinGb: number;
            minFreeGb?: number | undefined;
        }, {
            lesson: string;
            rootMinGb: number;
            minFreeGb?: number | undefined;
        }>>;
    }, "strip", z.ZodTypeAny, {
        files: {
            id: string;
            mode: string;
            source: string;
            target: string;
            kind: "sysctl" | "tmpfiles" | "journald-dropin" | "systemd-dropin" | "systemd-user-unit" | "plain" | "bashrc-block";
            lesson: string;
        }[];
        packages: {
            bun: ({
                name: string;
                minVersion: string | undefined;
                lesson: string | undefined;
            } | {
                name: string;
                lesson?: string | undefined;
                minVersion?: string | undefined;
            })[];
            apt: string[];
        };
        commands: {
            command: string;
            id: string;
            install: string;
            lesson: string;
        }[];
        services: {
            name: string;
            scope: "user" | "system";
            expectEnabled: boolean;
            expectActive: boolean;
        }[];
        workstationTestProfile: boolean;
        sysctls: Record<string, string>;
        runtimeValues: {
            value: string;
            path: string;
            lesson: string;
        }[];
        absences: {
            id: string;
            paths: string[];
            lesson: string;
            command?: string | undefined;
            service?: string | undefined;
        }[];
        tailscale?: {
            ssh: boolean;
            join: boolean;
            authKeySecretName: string;
            hostnameFromStation: boolean;
        } | undefined;
        unitConventions?: {
            match: string;
            lesson: string;
            startLimitIntervalSec: number;
            startLimitBurst: number;
            onFailureUnit: string;
            requireAbsoluteExecStart: boolean;
        } | undefined;
        accessFloor?: {
            lesson: string;
            service: string;
            ensure: string;
        } | undefined;
        secretsBootstrap?: {
            optional: boolean;
            envSecretName: string;
        } | undefined;
        swap?: {
            sizeGb: number;
        } | undefined;
        disk?: {
            lesson: string;
            rootMinGb: number;
            minFreeGb?: number | undefined;
        } | undefined;
    }, {
        tailscale?: {
            authKeySecretName: string;
            ssh?: boolean | undefined;
            join?: boolean | undefined;
            hostnameFromStation?: boolean | undefined;
        } | undefined;
        files?: {
            id: string;
            source: string;
            target: string;
            lesson: string;
            mode?: string | undefined;
            kind?: "sysctl" | "tmpfiles" | "journald-dropin" | "systemd-dropin" | "systemd-user-unit" | "plain" | "bashrc-block" | undefined;
        }[] | undefined;
        packages?: {
            bun?: (string | {
                name: string;
                lesson?: string | undefined;
                minVersion?: string | undefined;
            })[] | undefined;
            apt?: string[] | undefined;
        } | undefined;
        commands?: {
            command: string;
            id: string;
            install: string;
            lesson: string;
        }[] | undefined;
        services?: {
            name: string;
            scope?: "user" | "system" | undefined;
            expectEnabled?: boolean | undefined;
            expectActive?: boolean | undefined;
        }[] | undefined;
        workstationTestProfile?: boolean | undefined;
        sysctls?: Record<string, string> | undefined;
        runtimeValues?: {
            value: string;
            path: string;
            lesson: string;
        }[] | undefined;
        unitConventions?: {
            lesson: string;
            match?: string | undefined;
            startLimitIntervalSec?: number | undefined;
            startLimitBurst?: number | undefined;
            onFailureUnit?: string | undefined;
            requireAbsoluteExecStart?: boolean | undefined;
        } | undefined;
        accessFloor?: {
            lesson: string;
            service: string;
            ensure: string;
        } | undefined;
        absences?: {
            id: string;
            lesson: string;
            command?: string | undefined;
            paths?: string[] | undefined;
            service?: string | undefined;
        }[] | undefined;
        secretsBootstrap?: {
            envSecretName: string;
            optional?: boolean | undefined;
        } | undefined;
        swap?: {
            sizeGb?: number | undefined;
        } | undefined;
        disk?: {
            lesson: string;
            rootMinGb: number;
            minFreeGb?: number | undefined;
        } | undefined;
    }>;
    overlays: z.ZodDefault<z.ZodRecord<z.ZodString, z.ZodObject<{
        files: z.ZodDefault<z.ZodArray<z.ZodObject<{
            id: z.ZodString;
            /** Path relative to the template directory. */
            source: z.ZodString;
            /**
             * Absolute target path, or `~/`-prefixed for a home-relative target
             * (e.g. systemd user units).
             */
            target: z.ZodString;
            mode: z.ZodDefault<z.ZodString>;
            kind: z.ZodDefault<z.ZodEnum<["sysctl", "tmpfiles", "systemd-dropin", "systemd-user-unit", "journald-dropin", "plain", "bashrc-block"]>>;
            /** Which measured failure this file exists to prevent. */
            lesson: z.ZodString;
        }, "strip", z.ZodTypeAny, {
            id: string;
            mode: string;
            source: string;
            target: string;
            kind: "sysctl" | "tmpfiles" | "journald-dropin" | "systemd-dropin" | "systemd-user-unit" | "plain" | "bashrc-block";
            lesson: string;
        }, {
            id: string;
            source: string;
            target: string;
            lesson: string;
            mode?: string | undefined;
            kind?: "sysctl" | "tmpfiles" | "journald-dropin" | "systemd-dropin" | "systemd-user-unit" | "plain" | "bashrc-block" | undefined;
        }>, "many">>;
        packages: z.ZodDefault<z.ZodObject<{
            apt: z.ZodDefault<z.ZodArray<z.ZodString, "many">>;
            bun: z.ZodDefault<z.ZodArray<z.ZodUnion<[z.ZodEffects<z.ZodString, {
                name: string;
                minVersion: string | undefined;
                lesson: string | undefined;
            }, string>, z.ZodObject<{
                name: z.ZodString;
                /** Minimum acceptable installed version (semver x.y.z). Floor, not pin. */
                minVersion: z.ZodOptional<z.ZodString>;
                lesson: z.ZodOptional<z.ZodString>;
            }, "strip", z.ZodTypeAny, {
                name: string;
                lesson?: string | undefined;
                minVersion?: string | undefined;
            }, {
                name: string;
                lesson?: string | undefined;
                minVersion?: string | undefined;
            }>]>, "many">>;
        }, "strip", z.ZodTypeAny, {
            bun: ({
                name: string;
                minVersion: string | undefined;
                lesson: string | undefined;
            } | {
                name: string;
                lesson?: string | undefined;
                minVersion?: string | undefined;
            })[];
            apt: string[];
        }, {
            bun?: (string | {
                name: string;
                lesson?: string | undefined;
                minVersion?: string | undefined;
            })[] | undefined;
            apt?: string[] | undefined;
        }>>;
        /** Binaries that must resolve on PATH, with their idempotent installers. */
        commands: z.ZodDefault<z.ZodArray<z.ZodObject<{
            id: z.ZodString;
            /** Binary that must resolve on PATH. */
            command: z.ZodString;
            /** Idempotent shell that installs it. Runs only when the command is absent. */
            install: z.ZodString;
            /** Which measured failure this command exists to prevent. */
            lesson: z.ZodString;
        }, "strip", z.ZodTypeAny, {
            command: string;
            id: string;
            install: string;
            lesson: string;
        }, {
            command: string;
            id: string;
            install: string;
            lesson: string;
        }>, "many">>;
        services: z.ZodDefault<z.ZodArray<z.ZodObject<{
            name: z.ZodString;
            scope: z.ZodDefault<z.ZodEnum<["system", "user"]>>;
            expectEnabled: z.ZodDefault<z.ZodBoolean>;
            expectActive: z.ZodDefault<z.ZodBoolean>;
        }, "strip", z.ZodTypeAny, {
            name: string;
            scope: "user" | "system";
            expectEnabled: boolean;
            expectActive: boolean;
        }, {
            name: string;
            scope?: "user" | "system" | undefined;
            expectEnabled?: boolean | undefined;
            expectActive?: boolean | undefined;
        }>, "many">>;
        /** Install, activate, and semantically verify the package-owned aggregate test controller. */
        workstationTestProfile: z.ZodDefault<z.ZodBoolean>;
        /** Runtime sysctl expectations (key → value), checked via /proc/sys. */
        sysctls: z.ZodDefault<z.ZodRecord<z.ZodString, z.ZodString>>;
        runtimeValues: z.ZodDefault<z.ZodArray<z.ZodObject<{
            /** Absolute path of the runtime file to compare (e.g. /sys/kernel/mm/lru_gen/min_ttl_ms). */
            path: z.ZodString;
            value: z.ZodString;
            lesson: z.ZodString;
        }, "strip", z.ZodTypeAny, {
            value: string;
            path: string;
            lesson: string;
        }, {
            value: string;
            path: string;
            lesson: string;
        }>, "many">>;
        unitConventions: z.ZodOptional<z.ZodObject<{
            /** Unit-name glob the conventions apply to. */
            match: z.ZodDefault<z.ZodString>;
            startLimitIntervalSec: z.ZodDefault<z.ZodNumber>;
            startLimitBurst: z.ZodDefault<z.ZodNumber>;
            onFailureUnit: z.ZodDefault<z.ZodString>;
            requireAbsoluteExecStart: z.ZodDefault<z.ZodBoolean>;
            lesson: z.ZodString;
        }, "strip", z.ZodTypeAny, {
            match: string;
            lesson: string;
            startLimitIntervalSec: number;
            startLimitBurst: number;
            onFailureUnit: string;
            requireAbsoluteExecStart: boolean;
        }, {
            lesson: string;
            match?: string | undefined;
            startLimitIntervalSec?: number | undefined;
            startLimitBurst?: number | undefined;
            onFailureUnit?: string | undefined;
            requireAbsoluteExecStart?: boolean | undefined;
        }>>;
        accessFloor: z.ZodOptional<z.ZodObject<{
            /** systemd unit that provides the floor access path. */
            service: z.ZodString;
            /** Idempotent shell that installs/enables the floor. Must need no secret. */
            ensure: z.ZodString;
            /** Which measured failure this floor exists to prevent. */
            lesson: z.ZodString;
        }, "strip", z.ZodTypeAny, {
            lesson: string;
            service: string;
            ensure: string;
        }, {
            lesson: string;
            service: string;
            ensure: string;
        }>>;
        /** Things this station class must NOT have, asserted so presence goes red. */
        absences: z.ZodDefault<z.ZodArray<z.ZodEffects<z.ZodObject<{
            id: z.ZodString;
            /** Binary that must NOT resolve on PATH. */
            command: z.ZodOptional<z.ZodString>;
            /** systemd unit that must NOT be known to systemd (LoadState=not-found). */
            service: z.ZodOptional<z.ZodString>;
            /** Absolute paths (binaries, state dirs, config) none of which may exist. */
            paths: z.ZodDefault<z.ZodArray<z.ZodString, "many">>;
            /** Which measured failure this absence exists to prevent. */
            lesson: z.ZodString;
        }, "strip", z.ZodTypeAny, {
            id: string;
            paths: string[];
            lesson: string;
            command?: string | undefined;
            service?: string | undefined;
        }, {
            id: string;
            lesson: string;
            command?: string | undefined;
            paths?: string[] | undefined;
            service?: string | undefined;
        }>, {
            id: string;
            paths: string[];
            lesson: string;
            command?: string | undefined;
            service?: string | undefined;
        }, {
            id: string;
            lesson: string;
            command?: string | undefined;
            paths?: string[] | undefined;
            service?: string | undefined;
        }>, "many">>;
        tailscale: z.ZodOptional<z.ZodObject<{
            join: z.ZodDefault<z.ZodBoolean>;
            /** Secret NAME only — the value is pulled at runtime, never rendered. */
            authKeySecretName: z.ZodString;
            hostnameFromStation: z.ZodDefault<z.ZodBoolean>;
            /** Enable Tailscale SSH so the tailnet is the whole access plane. */
            ssh: z.ZodDefault<z.ZodBoolean>;
        }, "strip", z.ZodTypeAny, {
            ssh: boolean;
            join: boolean;
            authKeySecretName: string;
            hostnameFromStation: boolean;
        }, {
            authKeySecretName: string;
            ssh?: boolean | undefined;
            join?: boolean | undefined;
            hostnameFromStation?: boolean | undefined;
        }>>;
        secretsBootstrap: z.ZodOptional<z.ZodObject<{
            /** Secret NAME only. */
            envSecretName: z.ZodString;
            optional: z.ZodDefault<z.ZodBoolean>;
        }, "strip", z.ZodTypeAny, {
            optional: boolean;
            envSecretName: string;
        }, {
            envSecretName: string;
            optional?: boolean | undefined;
        }>>;
        swap: z.ZodOptional<z.ZodObject<{
            sizeGb: z.ZodDefault<z.ZodNumber>;
        }, "strip", z.ZodTypeAny, {
            sizeGb: number;
        }, {
            sizeGb?: number | undefined;
        }>>;
        disk: z.ZodOptional<z.ZodObject<{
            /** Minimum root filesystem size in GiB (launcher must request at least this). */
            rootMinGb: z.ZodNumber;
            /**
             * Minimum FREE space in GiB before the drift check reports the box.
             * station17 build 2: at hard-0 free the SSM agent could not write its
             * orchestration files and commands returned EMPTY output rather than
             * errors — a full disk silently degrades the only access path, so it must
             * be reported while there is still room to act.
             */
            minFreeGb: z.ZodOptional<z.ZodNumber>;
            /** Which measured failure this floor exists to prevent. */
            lesson: z.ZodString;
        }, "strip", z.ZodTypeAny, {
            lesson: string;
            rootMinGb: number;
            minFreeGb?: number | undefined;
        }, {
            lesson: string;
            rootMinGb: number;
            minFreeGb?: number | undefined;
        }>>;
    }, "strip", z.ZodTypeAny, {
        files: {
            id: string;
            mode: string;
            source: string;
            target: string;
            kind: "sysctl" | "tmpfiles" | "journald-dropin" | "systemd-dropin" | "systemd-user-unit" | "plain" | "bashrc-block";
            lesson: string;
        }[];
        packages: {
            bun: ({
                name: string;
                minVersion: string | undefined;
                lesson: string | undefined;
            } | {
                name: string;
                lesson?: string | undefined;
                minVersion?: string | undefined;
            })[];
            apt: string[];
        };
        commands: {
            command: string;
            id: string;
            install: string;
            lesson: string;
        }[];
        services: {
            name: string;
            scope: "user" | "system";
            expectEnabled: boolean;
            expectActive: boolean;
        }[];
        workstationTestProfile: boolean;
        sysctls: Record<string, string>;
        runtimeValues: {
            value: string;
            path: string;
            lesson: string;
        }[];
        absences: {
            id: string;
            paths: string[];
            lesson: string;
            command?: string | undefined;
            service?: string | undefined;
        }[];
        tailscale?: {
            ssh: boolean;
            join: boolean;
            authKeySecretName: string;
            hostnameFromStation: boolean;
        } | undefined;
        unitConventions?: {
            match: string;
            lesson: string;
            startLimitIntervalSec: number;
            startLimitBurst: number;
            onFailureUnit: string;
            requireAbsoluteExecStart: boolean;
        } | undefined;
        accessFloor?: {
            lesson: string;
            service: string;
            ensure: string;
        } | undefined;
        secretsBootstrap?: {
            optional: boolean;
            envSecretName: string;
        } | undefined;
        swap?: {
            sizeGb: number;
        } | undefined;
        disk?: {
            lesson: string;
            rootMinGb: number;
            minFreeGb?: number | undefined;
        } | undefined;
    }, {
        tailscale?: {
            authKeySecretName: string;
            ssh?: boolean | undefined;
            join?: boolean | undefined;
            hostnameFromStation?: boolean | undefined;
        } | undefined;
        files?: {
            id: string;
            source: string;
            target: string;
            lesson: string;
            mode?: string | undefined;
            kind?: "sysctl" | "tmpfiles" | "journald-dropin" | "systemd-dropin" | "systemd-user-unit" | "plain" | "bashrc-block" | undefined;
        }[] | undefined;
        packages?: {
            bun?: (string | {
                name: string;
                lesson?: string | undefined;
                minVersion?: string | undefined;
            })[] | undefined;
            apt?: string[] | undefined;
        } | undefined;
        commands?: {
            command: string;
            id: string;
            install: string;
            lesson: string;
        }[] | undefined;
        services?: {
            name: string;
            scope?: "user" | "system" | undefined;
            expectEnabled?: boolean | undefined;
            expectActive?: boolean | undefined;
        }[] | undefined;
        workstationTestProfile?: boolean | undefined;
        sysctls?: Record<string, string> | undefined;
        runtimeValues?: {
            value: string;
            path: string;
            lesson: string;
        }[] | undefined;
        unitConventions?: {
            lesson: string;
            match?: string | undefined;
            startLimitIntervalSec?: number | undefined;
            startLimitBurst?: number | undefined;
            onFailureUnit?: string | undefined;
            requireAbsoluteExecStart?: boolean | undefined;
        } | undefined;
        accessFloor?: {
            lesson: string;
            service: string;
            ensure: string;
        } | undefined;
        absences?: {
            id: string;
            lesson: string;
            command?: string | undefined;
            paths?: string[] | undefined;
            service?: string | undefined;
        }[] | undefined;
        secretsBootstrap?: {
            envSecretName: string;
            optional?: boolean | undefined;
        } | undefined;
        swap?: {
            sizeGb?: number | undefined;
        } | undefined;
        disk?: {
            lesson: string;
            rootMinGb: number;
            minFreeGb?: number | undefined;
        } | undefined;
    }>>>;
}, "strip", z.ZodTypeAny, {
    name: string;
    version: string;
    description: string;
    $schema: "hasna.station_template.v1";
    base: {
        files: {
            id: string;
            mode: string;
            source: string;
            target: string;
            kind: "sysctl" | "tmpfiles" | "journald-dropin" | "systemd-dropin" | "systemd-user-unit" | "plain" | "bashrc-block";
            lesson: string;
        }[];
        packages: {
            bun: ({
                name: string;
                minVersion: string | undefined;
                lesson: string | undefined;
            } | {
                name: string;
                lesson?: string | undefined;
                minVersion?: string | undefined;
            })[];
            apt: string[];
        };
        commands: {
            command: string;
            id: string;
            install: string;
            lesson: string;
        }[];
        services: {
            name: string;
            scope: "user" | "system";
            expectEnabled: boolean;
            expectActive: boolean;
        }[];
        workstationTestProfile: boolean;
        sysctls: Record<string, string>;
        runtimeValues: {
            value: string;
            path: string;
            lesson: string;
        }[];
        absences: {
            id: string;
            paths: string[];
            lesson: string;
            command?: string | undefined;
            service?: string | undefined;
        }[];
        tailscale?: {
            ssh: boolean;
            join: boolean;
            authKeySecretName: string;
            hostnameFromStation: boolean;
        } | undefined;
        unitConventions?: {
            match: string;
            lesson: string;
            startLimitIntervalSec: number;
            startLimitBurst: number;
            onFailureUnit: string;
            requireAbsoluteExecStart: boolean;
        } | undefined;
        accessFloor?: {
            lesson: string;
            service: string;
            ensure: string;
        } | undefined;
        secretsBootstrap?: {
            optional: boolean;
            envSecretName: string;
        } | undefined;
        swap?: {
            sizeGb: number;
        } | undefined;
        disk?: {
            lesson: string;
            rootMinGb: number;
            minFreeGb?: number | undefined;
        } | undefined;
    };
    overlays: Record<string, {
        files: {
            id: string;
            mode: string;
            source: string;
            target: string;
            kind: "sysctl" | "tmpfiles" | "journald-dropin" | "systemd-dropin" | "systemd-user-unit" | "plain" | "bashrc-block";
            lesson: string;
        }[];
        packages: {
            bun: ({
                name: string;
                minVersion: string | undefined;
                lesson: string | undefined;
            } | {
                name: string;
                lesson?: string | undefined;
                minVersion?: string | undefined;
            })[];
            apt: string[];
        };
        commands: {
            command: string;
            id: string;
            install: string;
            lesson: string;
        }[];
        services: {
            name: string;
            scope: "user" | "system";
            expectEnabled: boolean;
            expectActive: boolean;
        }[];
        workstationTestProfile: boolean;
        sysctls: Record<string, string>;
        runtimeValues: {
            value: string;
            path: string;
            lesson: string;
        }[];
        absences: {
            id: string;
            paths: string[];
            lesson: string;
            command?: string | undefined;
            service?: string | undefined;
        }[];
        tailscale?: {
            ssh: boolean;
            join: boolean;
            authKeySecretName: string;
            hostnameFromStation: boolean;
        } | undefined;
        unitConventions?: {
            match: string;
            lesson: string;
            startLimitIntervalSec: number;
            startLimitBurst: number;
            onFailureUnit: string;
            requireAbsoluteExecStart: boolean;
        } | undefined;
        accessFloor?: {
            lesson: string;
            service: string;
            ensure: string;
        } | undefined;
        secretsBootstrap?: {
            optional: boolean;
            envSecretName: string;
        } | undefined;
        swap?: {
            sizeGb: number;
        } | undefined;
        disk?: {
            lesson: string;
            rootMinGb: number;
            minFreeGb?: number | undefined;
        } | undefined;
    }>;
}, {
    name: string;
    version: string;
    description: string;
    $schema: "hasna.station_template.v1";
    base: {
        tailscale?: {
            authKeySecretName: string;
            ssh?: boolean | undefined;
            join?: boolean | undefined;
            hostnameFromStation?: boolean | undefined;
        } | undefined;
        files?: {
            id: string;
            source: string;
            target: string;
            lesson: string;
            mode?: string | undefined;
            kind?: "sysctl" | "tmpfiles" | "journald-dropin" | "systemd-dropin" | "systemd-user-unit" | "plain" | "bashrc-block" | undefined;
        }[] | undefined;
        packages?: {
            bun?: (string | {
                name: string;
                lesson?: string | undefined;
                minVersion?: string | undefined;
            })[] | undefined;
            apt?: string[] | undefined;
        } | undefined;
        commands?: {
            command: string;
            id: string;
            install: string;
            lesson: string;
        }[] | undefined;
        services?: {
            name: string;
            scope?: "user" | "system" | undefined;
            expectEnabled?: boolean | undefined;
            expectActive?: boolean | undefined;
        }[] | undefined;
        workstationTestProfile?: boolean | undefined;
        sysctls?: Record<string, string> | undefined;
        runtimeValues?: {
            value: string;
            path: string;
            lesson: string;
        }[] | undefined;
        unitConventions?: {
            lesson: string;
            match?: string | undefined;
            startLimitIntervalSec?: number | undefined;
            startLimitBurst?: number | undefined;
            onFailureUnit?: string | undefined;
            requireAbsoluteExecStart?: boolean | undefined;
        } | undefined;
        accessFloor?: {
            lesson: string;
            service: string;
            ensure: string;
        } | undefined;
        absences?: {
            id: string;
            lesson: string;
            command?: string | undefined;
            paths?: string[] | undefined;
            service?: string | undefined;
        }[] | undefined;
        secretsBootstrap?: {
            envSecretName: string;
            optional?: boolean | undefined;
        } | undefined;
        swap?: {
            sizeGb?: number | undefined;
        } | undefined;
        disk?: {
            lesson: string;
            rootMinGb: number;
            minFreeGb?: number | undefined;
        } | undefined;
    };
    overlays?: Record<string, {
        tailscale?: {
            authKeySecretName: string;
            ssh?: boolean | undefined;
            join?: boolean | undefined;
            hostnameFromStation?: boolean | undefined;
        } | undefined;
        files?: {
            id: string;
            source: string;
            target: string;
            lesson: string;
            mode?: string | undefined;
            kind?: "sysctl" | "tmpfiles" | "journald-dropin" | "systemd-dropin" | "systemd-user-unit" | "plain" | "bashrc-block" | undefined;
        }[] | undefined;
        packages?: {
            bun?: (string | {
                name: string;
                lesson?: string | undefined;
                minVersion?: string | undefined;
            })[] | undefined;
            apt?: string[] | undefined;
        } | undefined;
        commands?: {
            command: string;
            id: string;
            install: string;
            lesson: string;
        }[] | undefined;
        services?: {
            name: string;
            scope?: "user" | "system" | undefined;
            expectEnabled?: boolean | undefined;
            expectActive?: boolean | undefined;
        }[] | undefined;
        workstationTestProfile?: boolean | undefined;
        sysctls?: Record<string, string> | undefined;
        runtimeValues?: {
            value: string;
            path: string;
            lesson: string;
        }[] | undefined;
        unitConventions?: {
            lesson: string;
            match?: string | undefined;
            startLimitIntervalSec?: number | undefined;
            startLimitBurst?: number | undefined;
            onFailureUnit?: string | undefined;
            requireAbsoluteExecStart?: boolean | undefined;
        } | undefined;
        accessFloor?: {
            lesson: string;
            service: string;
            ensure: string;
        } | undefined;
        absences?: {
            id: string;
            lesson: string;
            command?: string | undefined;
            paths?: string[] | undefined;
            service?: string | undefined;
        }[] | undefined;
        secretsBootstrap?: {
            envSecretName: string;
            optional?: boolean | undefined;
        } | undefined;
        swap?: {
            sizeGb?: number | undefined;
        } | undefined;
        disk?: {
            lesson: string;
            rootMinGb: number;
            minFreeGb?: number | undefined;
        } | undefined;
    }> | undefined;
}>, {
    name: string;
    version: string;
    description: string;
    $schema: "hasna.station_template.v1";
    base: {
        files: {
            id: string;
            mode: string;
            source: string;
            target: string;
            kind: "sysctl" | "tmpfiles" | "journald-dropin" | "systemd-dropin" | "systemd-user-unit" | "plain" | "bashrc-block";
            lesson: string;
        }[];
        packages: {
            bun: ({
                name: string;
                minVersion: string | undefined;
                lesson: string | undefined;
            } | {
                name: string;
                lesson?: string | undefined;
                minVersion?: string | undefined;
            })[];
            apt: string[];
        };
        commands: {
            command: string;
            id: string;
            install: string;
            lesson: string;
        }[];
        services: {
            name: string;
            scope: "user" | "system";
            expectEnabled: boolean;
            expectActive: boolean;
        }[];
        workstationTestProfile: boolean;
        sysctls: Record<string, string>;
        runtimeValues: {
            value: string;
            path: string;
            lesson: string;
        }[];
        absences: {
            id: string;
            paths: string[];
            lesson: string;
            command?: string | undefined;
            service?: string | undefined;
        }[];
        tailscale?: {
            ssh: boolean;
            join: boolean;
            authKeySecretName: string;
            hostnameFromStation: boolean;
        } | undefined;
        unitConventions?: {
            match: string;
            lesson: string;
            startLimitIntervalSec: number;
            startLimitBurst: number;
            onFailureUnit: string;
            requireAbsoluteExecStart: boolean;
        } | undefined;
        accessFloor?: {
            lesson: string;
            service: string;
            ensure: string;
        } | undefined;
        secretsBootstrap?: {
            optional: boolean;
            envSecretName: string;
        } | undefined;
        swap?: {
            sizeGb: number;
        } | undefined;
        disk?: {
            lesson: string;
            rootMinGb: number;
            minFreeGb?: number | undefined;
        } | undefined;
    };
    overlays: Record<string, {
        files: {
            id: string;
            mode: string;
            source: string;
            target: string;
            kind: "sysctl" | "tmpfiles" | "journald-dropin" | "systemd-dropin" | "systemd-user-unit" | "plain" | "bashrc-block";
            lesson: string;
        }[];
        packages: {
            bun: ({
                name: string;
                minVersion: string | undefined;
                lesson: string | undefined;
            } | {
                name: string;
                lesson?: string | undefined;
                minVersion?: string | undefined;
            })[];
            apt: string[];
        };
        commands: {
            command: string;
            id: string;
            install: string;
            lesson: string;
        }[];
        services: {
            name: string;
            scope: "user" | "system";
            expectEnabled: boolean;
            expectActive: boolean;
        }[];
        workstationTestProfile: boolean;
        sysctls: Record<string, string>;
        runtimeValues: {
            value: string;
            path: string;
            lesson: string;
        }[];
        absences: {
            id: string;
            paths: string[];
            lesson: string;
            command?: string | undefined;
            service?: string | undefined;
        }[];
        tailscale?: {
            ssh: boolean;
            join: boolean;
            authKeySecretName: string;
            hostnameFromStation: boolean;
        } | undefined;
        unitConventions?: {
            match: string;
            lesson: string;
            startLimitIntervalSec: number;
            startLimitBurst: number;
            onFailureUnit: string;
            requireAbsoluteExecStart: boolean;
        } | undefined;
        accessFloor?: {
            lesson: string;
            service: string;
            ensure: string;
        } | undefined;
        secretsBootstrap?: {
            optional: boolean;
            envSecretName: string;
        } | undefined;
        swap?: {
            sizeGb: number;
        } | undefined;
        disk?: {
            lesson: string;
            rootMinGb: number;
            minFreeGb?: number | undefined;
        } | undefined;
    }>;
}, {
    name: string;
    version: string;
    description: string;
    $schema: "hasna.station_template.v1";
    base: {
        tailscale?: {
            authKeySecretName: string;
            ssh?: boolean | undefined;
            join?: boolean | undefined;
            hostnameFromStation?: boolean | undefined;
        } | undefined;
        files?: {
            id: string;
            source: string;
            target: string;
            lesson: string;
            mode?: string | undefined;
            kind?: "sysctl" | "tmpfiles" | "journald-dropin" | "systemd-dropin" | "systemd-user-unit" | "plain" | "bashrc-block" | undefined;
        }[] | undefined;
        packages?: {
            bun?: (string | {
                name: string;
                lesson?: string | undefined;
                minVersion?: string | undefined;
            })[] | undefined;
            apt?: string[] | undefined;
        } | undefined;
        commands?: {
            command: string;
            id: string;
            install: string;
            lesson: string;
        }[] | undefined;
        services?: {
            name: string;
            scope?: "user" | "system" | undefined;
            expectEnabled?: boolean | undefined;
            expectActive?: boolean | undefined;
        }[] | undefined;
        workstationTestProfile?: boolean | undefined;
        sysctls?: Record<string, string> | undefined;
        runtimeValues?: {
            value: string;
            path: string;
            lesson: string;
        }[] | undefined;
        unitConventions?: {
            lesson: string;
            match?: string | undefined;
            startLimitIntervalSec?: number | undefined;
            startLimitBurst?: number | undefined;
            onFailureUnit?: string | undefined;
            requireAbsoluteExecStart?: boolean | undefined;
        } | undefined;
        accessFloor?: {
            lesson: string;
            service: string;
            ensure: string;
        } | undefined;
        absences?: {
            id: string;
            lesson: string;
            command?: string | undefined;
            paths?: string[] | undefined;
            service?: string | undefined;
        }[] | undefined;
        secretsBootstrap?: {
            envSecretName: string;
            optional?: boolean | undefined;
        } | undefined;
        swap?: {
            sizeGb?: number | undefined;
        } | undefined;
        disk?: {
            lesson: string;
            rootMinGb: number;
            minFreeGb?: number | undefined;
        } | undefined;
    };
    overlays?: Record<string, {
        tailscale?: {
            authKeySecretName: string;
            ssh?: boolean | undefined;
            join?: boolean | undefined;
            hostnameFromStation?: boolean | undefined;
        } | undefined;
        files?: {
            id: string;
            source: string;
            target: string;
            lesson: string;
            mode?: string | undefined;
            kind?: "sysctl" | "tmpfiles" | "journald-dropin" | "systemd-dropin" | "systemd-user-unit" | "plain" | "bashrc-block" | undefined;
        }[] | undefined;
        packages?: {
            bun?: (string | {
                name: string;
                lesson?: string | undefined;
                minVersion?: string | undefined;
            })[] | undefined;
            apt?: string[] | undefined;
        } | undefined;
        commands?: {
            command: string;
            id: string;
            install: string;
            lesson: string;
        }[] | undefined;
        services?: {
            name: string;
            scope?: "user" | "system" | undefined;
            expectEnabled?: boolean | undefined;
            expectActive?: boolean | undefined;
        }[] | undefined;
        workstationTestProfile?: boolean | undefined;
        sysctls?: Record<string, string> | undefined;
        runtimeValues?: {
            value: string;
            path: string;
            lesson: string;
        }[] | undefined;
        unitConventions?: {
            lesson: string;
            match?: string | undefined;
            startLimitIntervalSec?: number | undefined;
            startLimitBurst?: number | undefined;
            onFailureUnit?: string | undefined;
            requireAbsoluteExecStart?: boolean | undefined;
        } | undefined;
        accessFloor?: {
            lesson: string;
            service: string;
            ensure: string;
        } | undefined;
        absences?: {
            id: string;
            lesson: string;
            command?: string | undefined;
            paths?: string[] | undefined;
            service?: string | undefined;
        }[] | undefined;
        secretsBootstrap?: {
            envSecretName: string;
            optional?: boolean | undefined;
        } | undefined;
        swap?: {
            sizeGb?: number | undefined;
        } | undefined;
        disk?: {
            lesson: string;
            rootMinGb: number;
            minFreeGb?: number | undefined;
        } | undefined;
    }> | undefined;
}>;
export type TemplateFile = z.infer<typeof templateFileSchema>;
export type TemplateLayer = z.infer<typeof templateLayerSchema>;
export type StationTemplate = z.infer<typeof stationTemplateSchema>;
export type TemplateService = z.infer<typeof templateServiceSchema>;
export type TemplateCommand = z.infer<typeof templateCommandSchema>;
export type AccessFloor = z.infer<typeof accessFloorSchema>;
export type TemplateAbsence = z.infer<typeof absenceSchema>;
export type TemplateDisk = z.infer<typeof diskSchema>;
export type UnitConventions = z.infer<typeof unitConventionsSchema>;
/** A template file with its content loaded from disk. */
export interface LoadedTemplateFile extends TemplateFile {
    content: string;
    /** Keys managed by this file when kind=sysctl (parsed from content). */
    sysctlKeys: string[];
}
/** The result of merging base + selected overlays. */
export interface EffectiveTemplate {
    schemaId: typeof STATION_TEMPLATE_SCHEMA_ID;
    name: string;
    version: string;
    layers: string[];
    files: LoadedTemplateFile[];
    packages: {
        apt: string[];
        bun: BunPackage[];
    };
    commands: TemplateCommand[];
    services: TemplateService[];
    workstationTestProfile: boolean;
    sysctls: Record<string, string>;
    runtimeValues: z.infer<typeof runtimeValueSchema>[];
    unitConventions?: UnitConventions;
    accessFloor?: AccessFloor;
    absences: TemplateAbsence[];
    tailscale?: z.infer<typeof tailscaleSchema>;
    secretsBootstrap?: z.infer<typeof secretsBootstrapSchema>;
    swap: {
        sizeGb: number;
    };
    disk?: TemplateDisk;
}
