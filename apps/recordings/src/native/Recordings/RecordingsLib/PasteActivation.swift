import Foundation

enum PasteActivationFailure: String, Sendable {
    case cancelled, permissionChanged, targetUnavailable, processChanged, activationRejected, timedOut
}

enum PasteActivationReadiness: Equatable, Sendable {
    case ready
    case waitingForFocus
    case unavailable(PasteActivationFailure)
}

enum PasteActivationAttempt: String, Sendable {
    case notAttempted, alreadyFrontmost, accepted, rejected
}

/// Contains no transcript, document title, or application name. Activation acceptance is
/// only a request result; readiness and eventual paste delivery are reported separately.
struct PasteActivationReport: Sendable {
    let attempt: PasteActivationAttempt
    let failure: PasteActivationFailure?
    let elapsed: TimeInterval

    var logLine: String {
        "paste activation request=\(attempt.rawValue) readiness=\(failure?.rawValue ?? "ready") elapsed_ms=\(Int(max(0, elapsed) * 1_000))"
    }
}

/// A single exact-process activation request. The transaction coordinator owns its bounded
/// wait so a second paste cannot activate an app while the first is still pending.
struct PasteActivation: Sendable {
    let request: @MainActor @Sendable () -> Bool
    let readiness: @MainActor @Sendable () -> PasteActivationReadiness
    var report: @MainActor @Sendable (PasteActivationReport) -> Void = { _ in }

    static let pollingInterval: TimeInterval = 0.05
    static let timeout: TimeInterval = 1.5
    private static let clockOrigin = ContinuousClock.now

    /// ContinuousClock advances while the Mac sleeps, so a suspended paste expires rather
    /// than receiving a fresh foreground-stealing window when the user wakes the machine.
    static func continuousTime() -> TimeInterval {
        let duration = clockOrigin.duration(to: ContinuousClock.now).components
        return Double(duration.seconds) + Double(duration.attoseconds) / 1e18
    }

    static func abandonsFallback(outcome: PasteDeliveryOutcome, generation: UInt64?,
                                 currentGeneration: UInt64, isRecording: Bool) -> Bool {
        guard case .targetUnavailable = outcome else { return false }
        return RecordingEngine.shouldAbandonDelivery(pipelineGeneration: generation,
            currentGeneration: currentGeneration, isRecording: isRecording)
    }

    /// Yield only the recorder's own active status, never that of an unrelated application.
    /// Both callbacks address the already selected process; neither finds an alternative app.
    @MainActor
    static func requestOnce(
        recorderIsActive: Bool,
        yield: () -> Void,
        activate: (Bool) -> Bool
    ) -> Bool {
        if recorderIsActive { yield() }
        return activate(recorderIsActive)
    }

    /// A terminated/replaced process, lost permission, or cancelled recording is terminal.
    /// Only a valid process that has not yet become frontmost may continue waiting.
    static func readiness(
        expected: PasteApplicationObservation,
        live: PasteApplicationObservation?,
        frontmost: PasteApplicationObservation?,
        accessibilityTrusted: Bool,
        cancelled: Bool,
        requiresProcessIdentity: Bool
    ) -> PasteActivationReadiness {
        guard !cancelled else { return .unavailable(.cancelled) }
        guard accessibilityTrusted else { return .unavailable(.permissionChanged) }
        guard let live, !live.isTerminated else { return .unavailable(.targetUnavailable) }
        guard live.pid == expected.pid, live.bundleIdentifier == expected.bundleIdentifier,
              live.launchDate == expected.launchDate,
              !requiresProcessIdentity || expected.launchDate != nil else {
            return .unavailable(.processChanged)
        }
        guard !expected.isRegular || live.isRegular else { return .unavailable(.processChanged) }
        guard let frontmost, frontmost.pid == expected.pid else { return .waitingForFocus }
        guard frontmost.bundleIdentifier == expected.bundleIdentifier,
              frontmost.launchDate == expected.launchDate, !frontmost.isTerminated,
              !expected.isRegular || frontmost.isRegular else {
            return .unavailable(.processChanged)
        }
        return .ready
    }
}
