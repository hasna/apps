import { type MachineRouteOptions, type MachineRouteKind, type MachineRouteConfidence } from "../topology.js";
export declare const SCREEN_SECRET_NAMESPACE_ENV = "HASNA_MACHINES_SCREEN_SECRET_NAMESPACE";
export declare const DEFAULT_SCREEN_SECRET_NAMESPACE = "machines/screen-sharing";
export interface ResolvedScreenTarget {
    machineId: string;
    user: string | null;
    host: string;
    url: string;
    route: MachineRouteKind;
    confidence: MachineRouteConfidence;
    warnings: string[];
}
export interface ScreenCredentialResolution {
    machineId: string;
    user: string | null;
    userSource: "option" | "route" | "metadata" | "missing";
    passwordSecretKey: string;
    passwordSecretSource: "option" | "metadata" | "default";
}
export interface ScreenEnableCommandPlan {
    machineId: string;
    user: string;
    passwordSecretKey: string;
    remoteCommand: string;
    secretsCommand: string;
    secretsCommandArgs: string[];
    sshCommand: string;
    sshCommandArgs: string[];
    command: string;
}
export interface ScreenCredentialOptions extends MachineRouteOptions {
    user?: string;
    passwordSecretKey?: string;
}
export interface ScreenEnableCommandOptions extends ScreenCredentialOptions {
    secretsCommand?: string;
}
export declare function defaultScreenPasswordSecretKey(machineId: string): string;
/**
 * Resolve the best screen-sharing (VNC) target for a machine.
 * Prefers the live LAN route over Tailscale (lower latency for screen sharing),
 * and always produces a `vnc://user@host` URL when a user is known.
 */
export declare function resolveScreenTarget(machineId: string, options?: MachineRouteOptions): ResolvedScreenTarget;
export declare function resolveScreenCredentials(machineId: string, options?: ScreenCredentialOptions): ScreenCredentialResolution;
/**
 * One row of `screen-credentials` output as far as exit-code evaluation is concerned.
 * `ok: false` marks a machine we could not resolve (e.g. no route); when a secret was
 * checked, `passwordSecret.present` reports whether it exists in the vault.
 */
export interface ScreenCredentialOutcome {
    ok: boolean;
    passwordSecret?: {
        checked: boolean;
        present: boolean | null;
    };
}
/**
 * Decide whether `screen-credentials` should exit non-zero.
 *
 * A read/list command that returns data for at least one machine is a success: an
 * unroutable machine (`ok: false`, e.g. "Machine route not found") is already surfaced
 * per-entry in the output, so a fully-returned listing must not fail-close solely because
 * one machine was unreachable. An explicitly checked-and-missing secret
 * (`passwordSecret.present === false`) is a distinct, requested check that remains fatal.
 *
 * `strict` opts into full fail-closed behaviour: exit non-zero if ANY machine failed to
 * resolve, in addition to the missing-secret check.
 */
export declare function screenCredentialsFailed(entries: ScreenCredentialOutcome[], options?: {
    strict?: boolean;
}): boolean;
/**
 * Build the macOS command that opens Screen Sharing to a machine.
 * `open vnc://user@host` launches Screen Sharing.app pointed at the resolved route.
 */
export declare function buildScreenCommand(machineId: string, options?: MachineRouteOptions): string;
/**
 * Build the remote command that ENABLES Remote Management / Screen Sharing on a
 * macOS target via `kickstart`, plus the SRP + legacy-VNC password tweaks that
 * make user-password auth work reliably from Screen Sharing.app and ARD.
 *
 * `vncPassword` is truncated to 8 chars by the VNC protocol; callers should pass
 * an <=8 char value (or accept that only the first 8 chars are honored by legacy
 * VNC clients).
 *
 * Returns the shell command to run AS ROOT on the target (caller pipes the sudo
 * password or runs under an already-root context).
 */
export declare function buildScreenEnableRemoteCommand(user: string, vncPassword: string): string;
/**
 * Build the remote root command used by secure screen-enable plans.
 * The VNC password is read from stdin so it is not embedded in shell history,
 * generated command text, or the SSH remote command arguments.
 */
export declare function buildScreenEnableRemoteCommandFromStdin(user: string): string;
export declare function buildScreenEnableCommand(machineId: string, options?: ScreenEnableCommandOptions): ScreenEnableCommandPlan;
