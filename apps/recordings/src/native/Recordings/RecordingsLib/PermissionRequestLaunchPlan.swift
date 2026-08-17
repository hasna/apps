import Foundation

public struct PermissionRequestLaunchPlan: Sendable, Equatable {
    public let isHelper: Bool
    public let opensPermissionSettings: Bool
    public let isBarOnly: Bool
    public let runtimeSmokeMode: String?
    public let runtimeSmokeOutputPath: String?
    public let runtimeSmokeAcknowledgementPath: String?
    public let runtimeSmokeCompletionPath: String?

    public var isRuntimeSmoke: Bool { runtimeSmokeMode != nil }
    public var installsGlobalHandlers: Bool { !isHelper && !isRuntimeSmoke }
    // Bar-only launch never creates the workspace window: the app exists solely for its
    // menu-bar record controls, fn/Globe hold-to-talk, live transcription, paste delivery,
    // and settings. The helper and runtime-smoke launches keep the existing gating above it.
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
#if RECORDINGS_BAR_ONLY
        // Bar builds are bar-only by construction. The compile-time define (build.sh passes
        // -Xswiftc -DRECORDINGS_BAR_ONLY for RECORDINGS_VARIANT=bar) is the guarantee that
        // the workspace window never exists, on every launch path: the installer relaunch,
        // a manual `open`, or a LaunchAgent. Relying on the launch argument alone left the
        // installed bar binary behaviorally identical to the full app, because no real
        // launch path passed `--bar-only` and only the runtime smoke did. `isHelper` and
        // `isRuntimeSmoke` still win the gating above, so the permission helper and the
        // runtime smoke run unchanged on a bar build.
        isBarOnly = true
#else
        isBarOnly = arguments.contains("--bar-only")
#endif
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
