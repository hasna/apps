import Foundation

public struct PermissionRequestLaunchPlan: Sendable, Equatable {
    public let isHelper: Bool
    public let opensPermissionSettings: Bool
    public let runtimeSmokeMode: String?
    public let runtimeSmokeOutputPath: String?
    public let runtimeSmokeAcknowledgementPath: String?
    public let runtimeSmokeCompletionPath: String?
    public let isBarOnly: Bool

    public var isRuntimeSmoke: Bool { runtimeSmokeMode != nil }
    public var installsGlobalHandlers: Bool { !isHelper && !isRuntimeSmoke }
    /// The workspace window may be created only when this holds: never for the permission
    /// helper, never for a bar launch, and regardless of runtime-smoke mode — a full
    /// build's smoke keeps exercising the window deterministically, and only bar builds
    /// finish windowless.
    public var declaresWindow: Bool { !isHelper && !isBarOnly }
    /// Controls the init auto-open and the reopen handler ONLY. Runtime smoke launches
    /// are excluded so the smoke controls window creation deterministically, and bar
    /// launches are excluded so a real bar launch never auto-opens the workspace window.
    public var declaresMainWindow: Bool { !isHelper && !isRuntimeSmoke && !isBarOnly }
    public var declaresMenuBar: Bool {
        if isRuntimeSmoke { return runtimeSmokeMode == "normal" }
        return !isHelper
    }
    public var terminatesAfterHandling: Bool { isHelper }
    public var requestsAccessibilityPrompt: Bool { isHelper && !isRuntimeSmoke }

    public init(arguments: [String]) {
        isHelper = arguments.contains("--request-permissions")
        opensPermissionSettings = isHelper && arguments.contains("--open-permission-settings")
        runtimeSmokeMode = Self.optionValue("--runtime-smoke", arguments: arguments)
        runtimeSmokeOutputPath = Self.optionValue("--runtime-smoke-output", arguments: arguments)
        runtimeSmokeAcknowledgementPath = Self.optionValue(
            "--runtime-smoke-ack",
            arguments: arguments
        )
        runtimeSmokeCompletionPath = Self.optionValue(
            "--runtime-smoke-completion",
            arguments: arguments
        )
        #if RECORDINGS_BAR_ONLY
        // A bar build is bar-only by construction on EVERY launch path — installer
        // relaunch, manual `open`, LaunchAgent, smoke. Relying on the argument alone left
        // real launches of the installed bar behaviorally identical to the full app
        // (review lineage hasna/apps#269, cycle-1 P1). The explicit --bar-only argument
        // remains a belt-and-suspenders self-describing launch record; it is never the
        // only carrier of the bar property.
        isBarOnly = true
        #else
        isBarOnly = arguments.contains("--bar-only")
        #endif
    }

    private static func optionValue(_ name: String, arguments: [String]) -> String? {
        guard let index = arguments.firstIndex(of: name), arguments.indices.contains(index + 1) else {
            return nil
        }
        return arguments[index + 1]
    }
}

public struct PermissionRequestOutcome: Sendable, Equatable {
    public let microphoneGranted: Bool
    public let accessibilityTrusted: Bool

    public init(microphoneGranted: Bool, accessibilityTrusted: Bool) {
        self.microphoneGranted = microphoneGranted
        self.accessibilityTrusted = accessibilityTrusted
    }

    public var succeeded: Bool {
        microphoneGranted && accessibilityTrusted
    }
}
