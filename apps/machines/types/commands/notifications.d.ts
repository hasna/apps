import type { NotificationChannel, NotificationConfig, NotificationDispatchSummary, NotificationTestResult } from "../types.js";
declare const trustedNotificationApproval: unique symbol;
export type TrustedNotificationApproval = {
    readonly [trustedNotificationApproval]: true;
};
export declare function createTrustedNotificationApproval(): TrustedNotificationApproval;
export declare function getDefaultNotificationConfig(): NotificationConfig;
export declare function readNotificationConfig(path?: string): NotificationConfig;
export declare function writeNotificationConfig(config: NotificationConfig, path?: string): NotificationConfig;
export declare function listNotificationChannels(): NotificationConfig;
export declare function addNotificationChannel(channel: NotificationChannel, options?: {
    approvalToken?: string;
    trustedApproval?: TrustedNotificationApproval;
}): NotificationConfig;
export declare function removeNotificationChannel(channelId: string): NotificationConfig;
export declare function dispatchNotificationEvent(event: string, message: string, options?: {
    channelId?: string;
    approvalToken?: string;
    trustedApproval?: TrustedNotificationApproval;
}): Promise<NotificationDispatchSummary>;
export declare function testNotificationChannel(channelId: string, event?: string, message?: string, options?: {
    apply?: boolean;
    yes?: boolean;
    approvalToken?: string;
    trustedApproval?: TrustedNotificationApproval;
}): Promise<NotificationTestResult>;
export {};
