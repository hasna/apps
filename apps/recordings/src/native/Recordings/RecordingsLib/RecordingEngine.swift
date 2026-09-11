import AVFoundation
@preconcurrency import ApplicationServices
// CopySymbolicHotKeys lives in Carbon's HIToolbox.
import Carbon.HIToolbox
import Darwin
import SwiftUI
@preconcurrency import KeyboardShortcuts

// MARK: - Custom shortcut (not fn — fn is handled by FnKeyMonitor)

extension KeyboardShortcuts.Name {
    @MainActor public static let toggleRecording = Self("toggleRecording", default: .init(.f5))
}

// MARK: - Transcription Result

public struct TranscriptionResult: Identifiable, Sendable {
    public let id = UUID()
    public let rawText: String
    public let processedText: String?
    public let timestamp: Date
    public let projectId: String?
    public let projectName: String?
    public let captureID: String?
    public let audioURL: URL?
    public var displayText: String { processedText ?? rawText }

    public init(rawText: String, processedText: String?, timestamp: Date, projectId: String?, projectName: String?, captureID: String? = nil, audioURL: URL? = nil) {
        self.rawText = rawText
        self.processedText = processedText
        self.timestamp = timestamp
        self.projectId = projectId
        self.projectName = projectName
        self.captureID = captureID
        self.audioURL = audioURL
    }
}

struct RealtimeFastPathSaveResult: Sendable {
    let text: String?
    let error: String?
}

enum FallbackCompletionAction: Equatable, Sendable {
    case deliver(String)
    case fail(String)
    case backgroundRecovered
    case backgroundFailed(String)
}

struct RecordingProcessingConfiguration: Equatable, Sendable {
    let transcriptionPrompt: String
    let transcriberPrompt: String
    let postProcessingMode: String
    let transcriptionLanguage: String
    let transcriptionModel: String
    let transcriberModel: String
    let enhancementModel: String
    let intentModel: String
    let intentDetectionEnabled: Bool
    let enhanceTriggersJSON: String
    let keywordTransformsJSON: String
}

/// Accessibility state frozen near recording start. Captured on a detached task so the
/// recorder never waits on Accessibility IPC to a possibly-unresponsive target app.
struct RecordingStartAXSnapshot: Sendable {
    let selectionToken: AccessibilitySelectionToken?
    let focusedWindowTitle: String?
}

/// Everything about the recording that is only known once the start-time Accessibility
/// snapshot and project auto-selection have resolved. Bound to one recording generation via
/// the task stored in `RecordingCaptureConfiguration`.
struct RecordingStartResolvedContext: Sendable {
    let selectionToken: AccessibilitySelectionToken?
    let canonicalProjectId: String?
    let displayProjectId: String?
    let activeProjectName: String?
    let processing: RecordingProcessingConfiguration
}

struct RecordingCaptureConfiguration: Sendable {
    let targetAppBundleIdentifier: String?
    let targetAppPid: pid_t?
    /// Resolves the frozen selection token, project binding, and processing configuration.
    /// Started at recording start and awaited only after the recorder has stopped, so
    /// capture latency can never delay microphone start.
    let startContext: Task<RecordingStartResolvedContext, Never>
    var preservesStartSelection = true

    func retargeted(to target: RecordingPasteTarget?, preservesSelection: Bool) -> Self {
        Self(targetAppBundleIdentifier: target?.bundleIdentifier, targetAppPid: target?.processIdentifier,
             startContext: startContext, preservesStartSelection: preservesStartSelection && preservesSelection)
    }

    func resolvedStartContext() async -> RecordingStartResolvedContext {
        let context = await startContext.value
        guard !preservesStartSelection else { return context }
        // The recording keeps its start-time processing/project configuration, but
        // another application's frozen AX selection must never reach the new target.
        return RecordingStartResolvedContext(selectionToken: nil, canonicalProjectId: context.canonicalProjectId,
            displayProjectId: context.displayProjectId, activeProjectName: context.activeProjectName,
            processing: context.processing)
    }
}

/// The frontmost-application identity `startRecording` freezes. Abstracted from
/// `NSWorkspace` so production-path tests can drive recording starts headlessly.
struct FrontmostAppSnapshot: Equatable, Sendable {
    let pid: pid_t
    let bundleIdentifier: String?
    let launchDate: Date?
}

/// The one capability `RecordingEngine` needs from an audio recorder; lets tests run the
/// production start path without microphone hardware or TCC grants.
protocol PCMRecordingSource: AnyObject, Sendable {
    func start() throws
    func stop()
}

extension NativePCMRecorder: PCMRecordingSource {}

struct AccessibilitySelectionIdentity<Element: Equatable & Sendable>: Equatable, Sendable {
    let element: Element
    let window: Element
    let documentIdentifier: String
    let rangeLocation: Int
    let rangeLength: Int
    let selectedText: String

    func matches(
        element currentElement: Element,
        window currentWindow: Element,
        documentIdentifier currentDocumentIdentifier: String,
        rangeLocation currentRangeLocation: Int,
        rangeLength currentRangeLength: Int,
        selectedText currentSelectedText: String
    ) -> Bool {
        element == currentElement
            && window == currentWindow
            && documentIdentifier == currentDocumentIdentifier
            && rangeLocation == currentRangeLocation
            && rangeLength == currentRangeLength
            && selectedText == currentSelectedText
    }
}

private struct AXElementIdentity: Equatable, @unchecked Sendable {
    let element: AXUIElement

    static func == (lhs: Self, rhs: Self) -> Bool {
        let element = lhs.element
        let currentElement = rhs.element
        return CFEqual(element, currentElement)
    }
}

/// Captured off the MainActor (Accessibility calls are Mach IPC and thread-safe); the token
/// itself is immutable after capture, so later MainActor revalidation reads are safe.
final class AccessibilitySelectionToken: @unchecked Sendable {
    private let identity: AccessibilitySelectionIdentity<AXElementIdentity>

    var selectedText: String { identity.selectedText }

    private init(
        element: AXUIElement,
        window: AXUIElement,
        documentIdentifier: String,
        range: CFRange,
        selectedText: String
    ) {
        identity = AccessibilitySelectionIdentity(
            element: AXElementIdentity(element: element),
            window: AXElementIdentity(element: window),
            documentIdentifier: documentIdentifier,
            rangeLocation: range.location,
            rangeLength: range.length,
            selectedText: selectedText
        )
    }

    /// Cap for each Accessibility IPC round trip during capture. Capture runs off the
    /// recorder-start path, but revalidation still happens synchronously before a paste or
    /// rewrite, so a beachballing target app must never stall behind the multi-second
    /// system default.
    static let captureMessagingTimeout: Float = 0.25

    #if DEBUG
    /// Test-only token whose AX elements point at this process; revalidation against a real
    /// target fails closed, which is exactly what delivery tests need to observe.
    static func unsafeTestToken(selectedText: String) -> AccessibilitySelectionToken {
        let element = AXUIElementCreateApplication(ProcessInfo.processInfo.processIdentifier)
        return AccessibilitySelectionToken(
            element: element,
            window: element,
            documentIdentifier: "document:test",
            range: CFRange(location: 0, length: (selectedText as NSString).length),
            selectedText: selectedText
        )
    }
    #endif

    static func capture(for pid: pid_t) -> AccessibilitySelectionToken? {
        let application = AXUIElementCreateApplication(pid)
        AXUIElementSetMessagingTimeout(application, captureMessagingTimeout)
        var focusedElementRef: CFTypeRef?
        guard AXUIElementCopyAttributeValue(
            application,
            kAXFocusedUIElementAttribute as CFString,
            &focusedElementRef
        ) == .success,
        let focusedElementRef,
        CFGetTypeID(focusedElementRef) == AXUIElementGetTypeID() else { return nil }
        let focusedElement = focusedElementRef as! AXUIElement
        AXUIElementSetMessagingTimeout(focusedElement, captureMessagingTimeout)

        var focusedWindowRef: CFTypeRef?
        guard AXUIElementCopyAttributeValue(
            application,
            kAXFocusedWindowAttribute as CFString,
            &focusedWindowRef
        ) == .success,
        let focusedWindowRef,
        CFGetTypeID(focusedWindowRef) == AXUIElementGetTypeID() else { return nil }
        let focusedWindow = focusedWindowRef as! AXUIElement
        AXUIElementSetMessagingTimeout(focusedWindow, captureMessagingTimeout)

        let documentIdentifier = stringAttribute(
            kAXDocumentAttribute as CFString,
            on: focusedElement
        ) ?? stringAttribute(
            kAXDocumentAttribute as CFString,
            on: focusedWindow
        )
        guard let contextIdentifier = RecordingEngine.stableAccessibilityContextIdentifier(
            documentIdentifier: documentIdentifier,
            elementIdentifier: stringAttribute(kAXIdentifierAttribute as CFString, on: focusedElement)
        ) else { return nil }

        guard let selectedRange = selectedRange(for: focusedElement),
              let selectedText = selectedText(for: focusedElement, range: selectedRange) else {
            return nil
        }
        return AccessibilitySelectionToken(
            element: focusedElement,
            window: focusedWindow,
            documentIdentifier: contextIdentifier,
            range: selectedRange,
            selectedText: selectedText
        )
    }

    func matchesCurrentSelection(for pid: pid_t) -> Bool {
        guard let current = Self.capture(for: pid) else { return false }
        return identity.matches(
            element: current.identity.element,
            window: current.identity.window,
            documentIdentifier: current.identity.documentIdentifier,
            rangeLocation: current.identity.rangeLocation,
            rangeLength: current.identity.rangeLength,
            selectedText: current.identity.selectedText
        )
    }

    private static func stringAttribute(_ attribute: CFString, on element: AXUIElement) -> String? {
        var valueRef: CFTypeRef?
        guard AXUIElementCopyAttributeValue(element, attribute, &valueRef) == .success else {
            return nil
        }
        return valueRef as? String
    }

    private static func selectedRange(for element: AXUIElement) -> CFRange? {
        var rangeRef: CFTypeRef?
        guard AXUIElementCopyAttributeValue(
            element,
            kAXSelectedTextRangeAttribute as CFString,
            &rangeRef
        ) == .success,
        let rangeRef,
        CFGetTypeID(rangeRef) == AXValueGetTypeID() else { return nil }

        let rangeValue = rangeRef as! AXValue
        var selectedRange = CFRange()
        guard AXValueGetType(rangeValue) == .cfRange,
              AXValueGetValue(rangeValue, .cfRange, &selectedRange),
              selectedRange.location >= 0,
              selectedRange.length > 0 else { return nil }
        return selectedRange
    }

    private static func selectedText(for element: AXUIElement, range: CFRange) -> String? {
        var selectedTextRef: CFTypeRef?
        if AXUIElementCopyAttributeValue(
            element,
            kAXSelectedTextAttribute as CFString,
            &selectedTextRef
        ) == .success,
        let selectedText = selectedTextRef as? String {
            return (selectedText as NSString).length == range.length ? selectedText : nil
        }

        var valueRef: CFTypeRef?
        guard AXUIElementCopyAttributeValue(
            element,
            kAXValueAttribute as CFString,
            &valueRef
        ) == .success,
        let value = valueRef as? String else { return nil }
        let valueLength = (value as NSString).length
        guard range.location <= valueLength,
              range.length <= valueLength - range.location else { return nil }
        return (value as NSString).substring(
            with: NSRange(location: range.location, length: range.length)
        )
    }
}

struct PasteDeliveryTransaction: Equatable, Sendable {
    let id: UUID
    let text: String
    let generation: UInt64?
}

enum PasteDeliveryOutcome: Equatable, Sendable {
    /// Delivery *observed*: the focused field in the target app was read back after the
    /// keystroke and had gained the pasted text. Reachable only from confirming evidence —
    /// see `PasteDeliveryOutcome.forDeliveryEvidence`. A posted `CGEvent` never produces it,
    /// because `CGEvent.post` returns no delivery receipt.
    case pasted
    /// The keystroke was posted and the focused field, readable before and after, did not
    /// change. The paste did not land where it was aimed.
    case deliveryNotObserved
    /// The keystroke was posted and the target app's focused field could not be read back, so
    /// delivery is unknown. Carries the reason so the log says which surface refused to
    /// answer instead of implying success.
    case deliveredUnverified(PasteDeliveryUnverifiedReason)
    /// Secure event input is on, so no synthetic keystroke can reach any app. Nothing was
    /// posted; the payload is left on the clipboard for the user to paste.
    case secureInputActive(SecureInputHolder)
    case targetUnavailable
    case clipboardOwnershipLost
    case clipboardWriteFailed
    case eventPostFailed

    /// Confirmed read-back proves the target has consumed the payload. Uncertain delivery
    /// still needs its clipboard grace period in case the target processes the paste late.
    var requiresClipboardGracePeriod: Bool {
        switch self {
        case .pasted: false
        case .deliveryNotObserved, .deliveredUnverified, .secureInputActive, .targetUnavailable,
             .clipboardOwnershipLost, .clipboardWriteFailed, .eventPostFailed: true
        }
    }

    /// The single place delivery evidence is allowed to become `.pasted`. Kept next to the
    /// outcome so a reader can check the whole mapping at once: two confirming reads, one
    /// contradicting read, everything else unverified.
    static func forDeliveryEvidence(_ evidence: PasteDeliveryEvidence) -> PasteDeliveryOutcome {
        switch evidence {
        case .confirmedByFocusedValue, .confirmedBySelectedText: .pasted
        case .notObservedFocusedValueUnchanged: .deliveryNotObserved
        case .unverified(let reason): .deliveredUnverified(reason)
        }
    }
}

struct PasteboardWriteResult: Equatable, Sendable {
    let verified: Bool
    let ownershipChangeCount: Int
    /// Whether the pasteboard's `changeCount` actually advanced past its pre-write value.
    /// Weaker than `verified` (which also re-reads the stored string) and reported separately
    /// so a log reader can tell "the pasteboard moved" from "the pasteboard holds our text".
    var changeCountAdvanced: Bool = false
}

/// Outcome of revalidating the frozen rewrite target immediately before a rewrite runs.
/// Anything but a live, matching selection fails the rewrite closed.
enum RewriteTargetResolution: Equatable, Sendable {
    case selection(String)
    case targetAppMissing
    case selectionUnavailable
}

@MainActor
final class PasteTransactionCoordinator {
    private enum State: Equatable {
        case idle
        case scheduled(UUID)
        case settling(UUID)
    }

    typealias ScheduledOperation = @MainActor @Sendable () -> Void
    typealias Scheduler = @MainActor @Sendable (TimeInterval, @escaping ScheduledOperation) -> Void
    typealias PayloadWriter = @MainActor @Sendable (String) -> PasteboardWriteResult
    typealias PastePoster = @MainActor @Sendable () -> PasteKeystrokeAttempt
    /// Reads the target app back and reports what that read proves. Defaulted to
    /// `.unverified(.readBackNotAttempted)` at every entry point so a caller that supplies no
    /// verification gets an explicitly unverified outcome, never an assumed success.
    typealias DeliveryVerifier = @MainActor @Sendable () -> PasteDeliveryEvidence
    typealias WriteObserver = @MainActor @Sendable (PasteboardWriteResult) -> Void
    typealias Completion = @MainActor @Sendable (PasteDeliveryTransaction, PasteDeliveryOutcome) -> Void
    typealias Settlement = @MainActor @Sendable (PasteDeliveryTransaction, PasteDeliveryOutcome) -> Void

    private let schedule: Scheduler
    private let writeAndVerify: PayloadWriter
    private let postPaste: PastePoster
    private let now: @MainActor @Sendable () -> TimeInterval
    private var activationPollID: UUID?
    /// Fires immediately before `hasPendingTransaction` changes value. Settlement can return
    /// to idle without any other state write, so an owner
    /// deriving gates from this coordinator (e.g. `canStartRecording`) must publish here or
    /// its observers never recompute after settlement.
    var pendingTransactionWillChange: (@MainActor () -> Void)?
    private var state: State = .idle {
        willSet {
            if (newValue == .idle) != (state == .idle) {
                pendingTransactionWillChange?()
            }
        }
    }

    init(
        schedule: @escaping Scheduler,
        writeAndVerify: @escaping PayloadWriter,
        postPaste: @escaping PastePoster,
        now: @escaping @MainActor @Sendable () -> TimeInterval = { PasteActivation.continuousTime() }
    ) {
        self.schedule = schedule
        self.writeAndVerify = writeAndVerify
        self.postPaste = postPaste
        self.now = now
    }

    var hasPendingTransaction: Bool {
        state != .idle
    }

    @discardableResult
    func submit(
        text: String,
        generation: UInt64?,
        delay: TimeInterval,
        settlementDelay: TimeInterval = 0,
        activation: PasteActivation? = nil,
        targetIsReady: @escaping @MainActor @Sendable () -> Bool = { true },
        payloadIsReady: @escaping @MainActor @Sendable () -> Bool = { true },
        prepare: @escaping ScheduledOperation = {},
        writeAttempted: @escaping WriteObserver = { _ in },
        verify: @escaping DeliveryVerifier = { .unverified(.readBackNotAttempted) },
        // `verificationDelay` is the wait between posting the keystroke and reading the target
        // app back; zero verifies on the posting turn, which only makes sense for tests since a
        // real app cannot have processed the event yet. `verificationAttempts` bounds how many
        // read-backs may run before "the field did not change" is accepted as the verdict —
        // only that verdict is retried, and each retry costs one `verificationDelay`.
        verificationDelay: TimeInterval = 0,
        verificationAttempts: Int = 1,
        completion: @escaping Completion,
        settlement: @escaping Settlement = { _, _ in }
    ) -> Bool {
        guard state == .idle else { return false }
        let transaction = PasteDeliveryTransaction(id: UUID(), text: text, generation: generation)
        state = .scheduled(transaction.id)
        let deliver: ScheduledOperation = { [weak self] in
            guard let self, self.state == .scheduled(transaction.id) else { return }
            self.state = .settling(transaction.id)
            guard targetIsReady() else {
                settlement(transaction, .targetUnavailable)
                self.state = .idle
                completion(transaction, .targetUnavailable)
                return
            }
            prepare()
            guard targetIsReady() else {
                settlement(transaction, .targetUnavailable)
                self.state = .idle
                completion(transaction, .targetUnavailable)
                return
            }
            let writeResult = self.writeAndVerify(transaction.text)
            writeAttempted(writeResult)
            guard writeResult.verified else {
                settlement(transaction, .clipboardWriteFailed)
                self.state = .idle
                completion(transaction, .clipboardWriteFailed)
                return
            }
            guard targetIsReady() else {
                settlement(transaction, .targetUnavailable)
                self.state = .idle
                completion(transaction, .targetUnavailable)
                return
            }
            guard payloadIsReady() else {
                settlement(transaction, .clipboardOwnershipLost)
                self.state = .idle
                completion(transaction, .clipboardOwnershipLost)
                return
            }
            // `@MainActor` is required, not decorative: a local function does not inherit the
            // enclosing closure's actor isolation, so without it `state` cannot be mutated and
            // `completion`/`settlement` cannot be called from here at all.
            @MainActor func failNow(with outcome: PasteDeliveryOutcome) {
                settlement(transaction, outcome)
                self.state = .idle
                completion(transaction, outcome)
            }

            switch self.postPaste() {
            case .constructionFailed:
                failNow(with: .eventPostFailed)
                return
            case .refusedSecureInput(let holder):
                // Nothing was posted: with secure input on, the window server drops synthetic
                // key events for every consumer, so posting would only manufacture a success
                // log for a paste that cannot happen.
                failNow(with: .secureInputActive(holder))
                return
            case .posted:
                break
            }

            // The keystroke is out. `CGEvent.post` returned no receipt, so the transaction
            // stays open: the outcome comes from reading the target app back.
            let pending = PendingDelivery(
                transaction: transaction,
                verify: verify,
                verificationDelay: verificationDelay,
                verificationAttempts: verificationAttempts,
                settlementDelay: settlementDelay,
                completion: completion,
                settlement: settlement
            )
            guard verificationDelay > 0 else {
                self.settleFromDeliveryEvidence(pending, readBackAttempt: verificationAttempts)
                return
            }
            self.schedule(verificationDelay) { [weak self] in
                guard let self, self.state == .settling(transaction.id) else { return }
                self.settleFromDeliveryEvidence(pending, readBackAttempt: 1)
            }
        }
        if let activation {
            beginActivation(activation, transaction: transaction, deliver: deliver,
                            completion: completion, settlement: settlement)
        } else {
            schedule(delay, deliver)
        }
        return true
    }

    private func beginActivation(
        _ activation: PasteActivation, transaction: PasteDeliveryTransaction,
        deliver: @escaping ScheduledOperation,
        completion: @escaping Completion, settlement: @escaping Settlement
    ) {
        let started = now()
        let attempt: PasteActivationAttempt
        let initialReadiness = activation.readiness()
        guard now() - started < PasteActivation.timeout else {
            failActivation(activation, transaction: transaction, attempt: .notAttempted,
                           reason: .timedOut, started: started, completion: completion, settlement: settlement)
            return
        }
        switch initialReadiness {
        case .unavailable(let reason):
            failActivation(activation, transaction: transaction, attempt: .notAttempted,
                           reason: reason, started: started, completion: completion, settlement: settlement)
            return
        case .ready:
            attempt = .alreadyFrontmost
        case .waitingForFocus:
            guard activation.request() else {
                failActivation(activation, transaction: transaction, attempt: .rejected,
                               reason: .activationRejected, started: started,
                               completion: completion, settlement: settlement)
                return
            }
            attempt = .accepted
        }
        waitForActivation(activation, transaction: transaction, attempt: attempt, started: started,
                          deliver: deliver, completion: completion, settlement: settlement)
    }

    private func waitForActivation(
        _ activation: PasteActivation, transaction: PasteDeliveryTransaction,
        attempt: PasteActivationAttempt, started: TimeInterval,
        deliver: @escaping ScheduledOperation,
        completion: @escaping Completion, settlement: @escaping Settlement
    ) {
        let ticket = UUID()
        activationPollID = ticket
        let remaining = max(0, PasteActivation.timeout - (now() - started))
        schedule(min(PasteActivation.pollingInterval, remaining)) { [weak self] in
            guard let self, self.state == .scheduled(transaction.id),
                  self.activationPollID == ticket else { return }
            self.activationPollID = nil
            let readiness = activation.readiness()
            let elapsed = self.now() - started
            let failure: PasteActivationFailure
            switch readiness {
            case .unavailable(let reason): failure = reason
            case .ready where elapsed <= PasteActivation.timeout:
                activation.report(PasteActivationReport(attempt: attempt, failure: nil, elapsed: elapsed))
                deliver()
                return
            case .waitingForFocus where elapsed < PasteActivation.timeout:
                self.waitForActivation(activation, transaction: transaction, attempt: attempt,
                    started: started, deliver: deliver, completion: completion, settlement: settlement)
                return
            case .ready, .waitingForFocus: failure = .timedOut
            }
            self.failActivation(activation, transaction: transaction, attempt: attempt,
                reason: failure, started: started, completion: completion, settlement: settlement)
        }
    }

    private func failActivation(
        _ activation: PasteActivation, transaction: PasteDeliveryTransaction,
        attempt: PasteActivationAttempt, reason: PasteActivationFailure, started: TimeInterval,
        completion: Completion, settlement: Settlement
    ) {
        guard state == .scheduled(transaction.id) else { return }
        activationPollID = nil
        state = .settling(transaction.id)
        activation.report(PasteActivationReport(attempt: attempt, failure: reason, elapsed: now() - started))
        settlement(transaction, .targetUnavailable)
        state = .idle
        completion(transaction, .targetUnavailable)
    }

    /// Everything the read-back loop needs after the keystroke has been posted.
    private struct PendingDelivery: Sendable {
        let transaction: PasteDeliveryTransaction
        let verify: DeliveryVerifier
        let verificationDelay: TimeInterval
        let verificationAttempts: Int
        let settlementDelay: TimeInterval
        let completion: Completion
        let settlement: Settlement
    }

    /// Asks the verifier what the target app shows, retrying only the "field did not change"
    /// verdict: that is the one a slow app can turn into a confirmation, while a confirmed or
    /// unreadable result is already final.
    private func settleFromDeliveryEvidence(_ pending: PendingDelivery, readBackAttempt: Int) {
        let evidence = pending.verify()
        guard evidence == .notObservedFocusedValueUnchanged,
              readBackAttempt < pending.verificationAttempts else {
            complete(pending, outcome: .forDeliveryEvidence(evidence))
            return
        }
        schedule(pending.verificationDelay) { [weak self] in
            guard let self, self.state == .settling(pending.transaction.id) else { return }
            self.settleFromDeliveryEvidence(pending, readBackAttempt: readBackAttempt + 1)
        }
    }

    private func complete(_ pending: PendingDelivery, outcome: PasteDeliveryOutcome) {
        pending.completion(pending.transaction, outcome)
        guard outcome.requiresClipboardGracePeriod, pending.settlementDelay > 0 else {
            // Keep the transaction occupied until restoration has rechecked clipboard
            // ownership. Completion and settlement callbacks cannot admit another paste.
            pending.settlement(pending.transaction, outcome)
            state = .idle
            return
        }
        schedule(pending.settlementDelay) { [weak self] in
            guard let self, self.state == .settling(pending.transaction.id) else { return }
            pending.settlement(pending.transaction, outcome)
            self.state = .idle
        }
    }
}

struct PipelineDeliveryGate: Sendable {
    private var pendingGenerations = Set<UInt64>()
    private var highestClaimedGeneration: UInt64?

    mutating func registerPipeline(_ generation: UInt64) {
        pendingGenerations.insert(generation)
    }

    mutating func abandonPipeline(_ generation: UInt64) {
        pendingGenerations.remove(generation)
    }

    mutating func claimDelivery(for generation: UInt64) -> Bool {
        if pendingGenerations.remove(generation) != nil {
            highestClaimedGeneration = max(highestClaimedGeneration ?? generation, generation)
            return true
        }
        if let highestClaimedGeneration, generation <= highestClaimedGeneration {
            return false
        }
        highestClaimedGeneration = generation
        return true
    }

    func shouldApplyStatus(
        deliveryGeneration: UInt64,
        currentGeneration: UInt64,
        isRecording: Bool,
        isTranscribing: Bool
    ) -> Bool {
        deliveryGeneration == currentGeneration && !isRecording && !isTranscribing
    }
}

struct RecordingPipelineTrace: Sendable {
    let id = UUID().uuidString
    let startedUptimeMilliseconds = UInt64(ProcessInfo.processInfo.systemUptime * 1_000)

    func message(stage: String, detail: String = "") -> String {
        let nowMilliseconds = UInt64(ProcessInfo.processInfo.systemUptime * 1_000)
        let elapsedMilliseconds = nowMilliseconds >= startedUptimeMilliseconds
            ? nowMilliseconds - startedUptimeMilliseconds
            : 0
        let suffix = detail.isEmpty ? "" : " \(detail)"
        return "pipeline_timing pipeline_id=\(id) stage=\(stage) elapsed_ms=\(elapsedMilliseconds)\(suffix)"
    }
}

public enum RecordingTrigger: Equatable, Sendable {
    case manual
    case fnKey
    case keyboardShortcut
}

struct MicrophonePermissionStartGate {
    private(set) var activeRequestID: UUID?

    var isAwaitingResponse: Bool {
        activeRequestID != nil
    }

    mutating func reserve(requestID: UUID = UUID()) -> UUID? {
        guard activeRequestID == nil else { return nil }
        activeRequestID = requestID
        return requestID
    }

    mutating func consumeResponse(for requestID: UUID) -> Bool {
        guard activeRequestID == requestID else { return false }
        activeRequestID = nil
        return true
    }

    mutating func cancel() {
        activeRequestID = nil
    }
}

struct PasteTargetCandidate: Equatable, Sendable {
    let pid: pid_t
    let bundleIdentifier: String?
    let isRegularApp: Bool
    let launchDate: Date?

    init(
        pid: pid_t,
        bundleIdentifier: String?,
        isRegularApp: Bool,
        launchDate: Date? = nil
    ) {
        self.pid = pid
        self.bundleIdentifier = bundleIdentifier
        self.isRegularApp = isRegularApp
        self.launchDate = launchDate
    }
}

struct PasteTargetProcessIdentity: Equatable, Sendable {
    let pid: pid_t
    let bundleIdentifier: String
    let launchDate: Date

    func matches(_ candidate: PasteTargetCandidate) -> Bool {
        candidate.pid == pid
            && candidate.bundleIdentifier == bundleIdentifier
            && candidate.launchDate == launchDate
    }
}

enum PasteDeliveryKind: Equatable, Sendable {
    case ordinaryDictation
    case commandRewrite
    case manualPaste
}

private final class PCMStreamPipe: @unchecked Sendable {
    private let continuation: AsyncStream<Data>.Continuation
    private let processor: Task<Data, Never>

    init(chunkSize: Int, client: RealtimeTranscriptionClient?, providerSession: (any RecordingTranscriptionSession)? = nil) {
        var streamContinuation: AsyncStream<Data>.Continuation!
        let stream = AsyncStream<Data>(bufferingPolicy: .unbounded) { continuation in
            streamContinuation = continuation
        }
        continuation = streamContinuation
        processor = Task {
            var recordedPCM = Data()
            var pendingChunk = Data()

            for await data in stream {
                guard !Task.isCancelled else { break }
                guard !data.isEmpty else { continue }
                recordedPCM.append(data)
                // Providers need every admitted packet before a pause can settle.
                // Only the legacy realtime client waits for network-sized chunks.
                providerSession?.appendPCM(data)
                pendingChunk.append(data)

                while pendingChunk.count >= chunkSize {
                    let chunk = pendingChunk.prefixData(count: chunkSize)
                    await client?.sendAudio(chunk)
                    pendingChunk.removeFirst(chunkSize)
                }
            }

            if !Task.isCancelled && !pendingChunk.isEmpty {
                await client?.sendAudio(pendingChunk)
            }
            return recordedPCM
        }
    }

    func append(_ data: Data) {
        continuation.yield(data)
    }

    func finish() async -> Data {
        continuation.finish()
        return await processor.value
    }

    func cancel() {
        continuation.finish()
        processor.cancel()
    }
}

private extension Data {
    func prefixData(count: Int) -> Data {
        Data(prefix(count))
    }
}

// MARK: - Recording Engine

@MainActor
public final class RecordingEngine: ObservableObject {
    /// Audio is arriving. Not "a start was requested": `AVAudioEngine.start()` returns before
    /// the input tap delivers its first sample (measured cold on Apple silicon:
    /// `native recorder started` at +541 ms, `native recorder received first PCM chunk` at
    /// +644 ms), and a hold released inside that window captured nothing at all. Flipping this
    /// on `start()` returning is what let a short tap fall through to the transcription
    /// pipeline with an empty buffer and finish silently.
    @Published public private(set) var isRecording = false
    /// The microphone is open but has not produced a sample yet — the ~100 ms window above.
    /// Surfaces render this as recording (the user is holding the key), and every teardown
    /// path can abandon it, but nothing may treat it as audio that exists.
    @Published public private(set) var isWarmingUpCapture = false
    @Published public var useFnKey: Bool = false {
        didSet {
            preferences.set(useFnKey, forKey: "useFnKey")
            updateFnMonitor()
            refreshTriggerDiagnostics()
        }
    }
    /// Where a blocked reason came from. The published reason is composed across these rather
    /// than written per-source, because more than one can hold at once — fn and the hotkey can
    /// both be blocked, and a delivery can be blocked while a trigger is too. A per-source
    /// writer lets whichever ran last erase the others, which is the erasure bug this whole
    /// mechanism exists to prevent.
    ///
    /// `Comparable` by declaration order, so the composed string is stable no matter which
    /// source was written last: a reason that reorders itself between renders reads as two
    /// different problems.
    enum BlockedReasonSource: Int, CaseIterable, Comparable, Sendable {
        /// The last delivery could not reach the target app and the transcript is sitting on
        /// the clipboard waiting for the user. Cleared by the next recording, not by the next
        /// status write.
        ///
        /// FIRST deliberately. This is the only reason that tells the owner their transcript is
        /// still recoverable ("press Cmd-V"), and it used to sort LAST — so with a blocked
        /// trigger as well it landed at the tail of a `.font(.caption)` `Text` in a 260-pt
        /// popover, behind two reasons about key bindings. Data-recovery advice leads; the
        /// trigger reasons are about a next press, which can wait.
        case delivery
        /// The keyboard shortcut collides with an enabled system shortcut.
        case hotkey
        /// The fn monitor cannot run (Accessibility).
        case fnKey
        /// A trigger fired but the press was consumed before recording could start — the
        /// permission-prompt case. Transient, and cleared by the next start.
        case pressConsumed

        static func < (lhs: Self, rhs: Self) -> Bool { lhs.rawValue < rhs.rawValue }

        /// Whether this source describes trigger *health* — the subject of the Settings
        /// "Recording Shortcut" section. Exhaustive so a new source has to make the decision
        /// rather than defaulting into a section whose remedy does not fit it.
        var isTriggerHealth: Bool {
            switch self {
            // `.pressConsumed` IS trigger health: it is written from the fn and hotkey release
            // handlers and says "press and hold again to record". Classifying it as non-trigger
            // dropped it from the one section documented as "a trigger that is switched on but
            // cannot arm must say so next to its own switch". `remedy` alone suppresses the wrong
            // button, so the row belongs here.
            case .hotkey, .fnKey, .pressConsumed: true
            // Delivery is about the last paste, not about a binding. It gets its own row.
            case .delivery: false
            }
        }

        /// The action that actually fixes this cause, so a surface offering a *button* keys it to
        /// the cause instead of to whatever text happened to be composed.
        var remedy: BlockedReasonEntry.Remedy {
            switch self {
            case .fnKey: .openAccessibilitySettings
            // A chord collision is not a permissions problem; the Accessibility pane does
            // nothing for it and the shortcut recorder is already on screen.
            case .hotkey: .chooseAnotherShortcut
            // Both say what to do in the message itself — "press Cmd-V", "press and hold
            // again" — so a button would be a second, competing instruction.
            case .delivery, .pressConsumed: .messageOnly
            }
        }
    }

    /// One source's reason together with the remedy that fixes it.
    ///
    /// The composed `blockedReason` string is what the menu bar renders, and it is enough there
    /// because that surface only reports. A Settings section that offers a *button* needs to know
    /// WHICH problem it is offering to fix: rendering the composed string under "Recording
    /// Shortcut" next to "Open Accessibility Settings" meant a secure-input paste failure showed
    /// "transcript copied, press Cmd-V" beside a button that opens the Accessibility pane — the
    /// wrong remedy, in the wrong section, for the wrong cause.
    public struct BlockedReasonEntry: Identifiable, Equatable, Sendable {
        public enum Remedy: Equatable, Sendable {
            /// Grant Accessibility — what the fn monitor needs before its tap can be created.
            case openAccessibilitySettings
            /// Pick a different chord; the recorder that does it is in the same section.
            case chooseAnotherShortcut
            /// The message is the whole remedy. No button.
            case messageOnly
        }

        let source: BlockedReasonSource
        public let message: String
        public var remedy: Remedy { source.remedy }
        /// Whether this belongs in the Settings trigger section.
        public var isTriggerHealth: Bool { source.isTriggerHealth }
        public var id: Int { source.rawValue }
    }

    /// Why the app currently cannot record or deliver, when the reason outlives one status
    /// write. Held separately from `statusMessage` because `updateStatus()` rewrites that on
    /// every return to idle; see `updateStatus()`.
    ///
    /// This is the collapse of what were two fields — `triggerBlockedReason` (trigger health)
    /// and `blockedReason` (secure-input delivery). Two published fields describing "the app
    /// cannot do the thing you asked" is two places for a view to forget to read, and the
    /// menu bar forgot to read either of them. One field, one writer.
    @Published public private(set) var blockedReason: String?
    /// The same reasons, per source and in precedence order. `blockedReason` is composed from
    /// exactly this array, in the same call, so the two cannot disagree — this is the structured
    /// form of one field, not a second field describing the same thing.
    @Published public private(set) var blockedReasonEntries: [BlockedReasonEntry] = []
    /// The ONLY writer of `blockedReason` is `setBlockedReason(_:for:)`. Do not assign the
    /// published property anywhere else; `macos-shortcut-contract.test.ts` asserts that.
    private var blockedReasons: [BlockedReasonSource: String] = [:]
    /// The recording generation the `.delivery` reason was written for, or nil when none is held.
    ///
    /// The `.delivery` reason is the only one that is a claim about a *specific* recording:
    /// "press Cmd-V" is true of the clipboard that recording wrote, and stops being true once the
    /// generation moves on. Tracked so `updateStatus()` can expire it structurally instead of
    /// relying on someone having enumerated every path that ought to clear it.
    private var deliveryBlockedReasonGeneration: UInt64?
    /// Advanced fallback policy (Settings only): when off, every recording is dictated
    /// literally and the classifier is never consulted.
    @Published public var intentDetectionEnabled: Bool = false {
        didSet {
            preferences.set(intentDetectionEnabled, forKey: "intentDetectionEnabled")
        }
    }
    /// Typed Record-page state; views render idle/listening/finalizing/processing/ready/error
    /// from this instead of parsing `statusMessage`.
    @Published public private(set) var flowPhase: RecordingFlowPhase = .idle
    /// Latest conversational answer. Cleared whenever a new recording starts so a stale reply
    /// can never be attributed to a later recording.
    @Published public private(set) var conversationReply: ConversationReply?
    @Published public var recentTranscriptions: [TranscriptionResult] = []
    /// Advances only after the CLI confirms that a recording has been persisted. The app
    /// store observes this independently of the Record pane so asynchronous saves and
    /// background recovery refresh the Library even after that pane has been unmounted.
    @Published public private(set) var persistedRecordingRevision: UInt64 = 0
    @Published public var statusMessage = "Starting..."
    @Published public var isTranscribing = false
    @Published public var recordingDuration: TimeInterval = 0
    @Published public var liveTranscriptionText = ""
    @Published public private(set) var isPaused = false
    @Published public private(set) var audioLevel: Double = 0
    @Published public private(set) var recentPastes: [RecentPaste] = []
    @Published public private(set) var latestAudioPath: String?
    @Published public var autoPasteEnabled = true {
        didSet {
            if usesIsolatedProvider || home == FileManager.default.homeDirectoryForCurrentUser.path {
                preferences.set(autoPasteEnabled, forKey: "recordingsAutoPaste")
            }
        }
    }
    private var captureMonitor = CaptureMonitor()

    public func togglePause() {
        guard isRecording else { return }
        isPaused.toggle()
        captureMonitor.setPaused(isPaused)
        statusMessage = isPaused ? "Paused" : "Recording…"
    }

    public func clearRecentPastes() { recentPastes.removeAll() }

    #if DEBUG
    /// Explicitly isolated design review only; does not open a microphone or connection.
    public func configureVisualPreview() {
        isRecording = true
        recordingDuration = 12
        audioLevel = 0.65
        liveTranscriptionText = "Here are the key takeaways from today’s meeting…"
        let samples = [
            ("com.apple.MobileSMS", "To: James", "Schedule a review for tomorrow at 2 PM…"),
            ("com.apple.Notes", "New Note", "Here are the key takeaways from today’s…"),
            ("com.tinyspeck.slackmacgap", "#product", "Can you confirm we’re still on for Friday?"),
            ("com.apple.mail", "New message", "Sharing the updated timeline and next steps."),
            ("notion.id", "Page", "Write a short summary of the discussion…")
        ]
        recentPastes = zip(samples, ["Messages", "Notes", "Slack", "Mail", "Notion"]).map { sample, name in RecentPaste(text: sample.2, bundleIdentifier: sample.0, appName: name, location: sample.1, status: "Pasted", verified: true) }
    }
    #endif

    @Published public var transcriptionLanguage = OpenAIAPIKeyStore.defaultLanguage {
        didSet {
            preferences.set(transcriptionLanguage, forKey: "recordingsLanguage")
            if !usesIsolatedProvider {
                try? OpenAIAPIKeyStore.saveLanguage(language: transcriptionLanguage, homePath: home)
            }
        }
    }

    private let preferences: UserDefaults
    private let preferencesSuiteName: String?
    private let installsGlobalHandlers: Bool
    private let transcriptionProvider: (any RecordingTranscriptionProvider)?
    private var usesIsolatedProvider: Bool { transcriptionProvider != nil }
    private var providerSession: (any RecordingTranscriptionSession)?
    private var providerConfiguration: RecordingProviderSessionConfiguration?
    private var providerCompletionTask: Task<Void, Never>?
    /// Injection keeps persistence ordering testable without changing the public file contract.
    var providerAudioWriter: @Sendable (Data, URL) throws -> Void = { pcm, url in
        try RecordingEngine.writeWAV(pcmData: pcm, sampleRate: 24_000, channelCount: 1, bitsPerSample: 16, to: url)
    }

    private var nativeRecorder: PCMRecordingSource?
    private var recordingTimer: Timer?
    private var activeTrigger: RecordingTrigger?
    private var microphonePermissionStartGate = MicrophonePermissionStartGate()
    private var keyboardShortcutIsDown = false
    private var fnKeyIsDown = false
    private var targetAppBundleIdentifier: String?
    private var targetAppPid: pid_t?
    private var frozenPasteTargetsByGeneration: [UInt64: RecordingPasteTargetSelection] = [:]
    private var pasteTargetProcessIdentityByGeneration: [UInt64: PasteTargetProcessIdentity] = [:]
    public var projectStore: ProjectStore?
    /// The minimal app uses only global cleanup preferences from the legacy settings
    /// file. Keeping this separate prevents old active projects from tagging new captures.
    public var globalRecordingPreferences: ProjectStore?
    public var voiceShortcuts: VoiceShortcuts?

    var recordingCleanupPreferences: (prompt: String, mode: String) {
        if let settings = globalRecordingPreferences?.settings {
            return (settings.globalSystemPrompt, (PostProcessingMode(rawValue: settings.postProcessingMode) ?? .auto).rawValue)
        }
        return (projectStore?.effectiveSystemPrompt ?? "", projectStore?.effectivePostProcessingMode ?? PostProcessingMode.auto.rawValue)
    }

    // MARK: - Injectable boundaries
    // Production defaults perform the real I/O; tests replace them to drive the production
    // start/delivery paths without microphone, Accessibility, network, or CLI access.
    var microphoneAuthorization: () -> AVAuthorizationStatus = {
        AVCaptureDevice.authorizationStatus(for: .audio)
    }
    var accessibilityTrustCheck: @Sendable () -> Bool = { AXIsProcessTrusted() }
    lazy var protectedOperationTrust: () -> AccessibilityTrustResult = { [accessibilityPromptGate] in
        accessibilityPromptGate.trustForProtectedOperation()
    }
    var frontmostAppSnapshot: () -> FrontmostAppSnapshot? = {
        guard let app = NSWorkspace.shared.frontmostApplication else { return nil }
        return FrontmostAppSnapshot(
            pid: app.processIdentifier,
            bundleIdentifier: app.bundleIdentifier,
            launchDate: app.launchDate
        )
    }
    var pasteTargetApplicationLookup: (pid_t) -> PasteApplicationObservation? = {
        NSRunningApplication(processIdentifier: $0).map(PasteApplicationObservation.init)
    }
    var pasteFallbackWriter: (String) -> Bool = { text in
        RecordingEngine.writeClipboardPreservingOnFailure(text, to: .general)
    }
    var recorderFactory: (@escaping @Sendable (Data) -> Void) -> PCMRecordingSource = {
        NativePCMRecorder(onPCM: $0)
    }
    var selectionCapture: @Sendable (pid_t) -> AccessibilitySelectionToken? = {
        AccessibilitySelectionToken.capture(for: $0)
    }
    var focusedWindowTitleLookup: @Sendable (pid_t) -> String? = {
        RecordingEngine.focusedWindowTitle(pid: $0)
    }
    var commandCLI: @Sendable (_ args: [String], _ home: String, _ timeout: TimeInterval) -> String = { args, home, ceiling in
        // The caller supplies the remaining public budget after queue admission. CLIRunner's
        // total deadline (execution, termination grace, kill grace, pipe drain) sits a full
        // return margin below it: spawn setup, waitid poll granularity, capture shutdown,
        // and the hop back to the caller all run outside CLIRunner's clamped waits and must
        // fit inside the reserved margin.
        let cliDeadline = ceiling - RecordingEngine.commandRewriteReturnMargin
        guard cliDeadline > CLIRunner.wallClockCleanupReserve else {
            return "ERROR: \(CLIRunner.ExecutionError.deadlineExhausted.localizedDescription)"
        }
        return CLIRunner.run(args, home: home, timeout: cliDeadline, totalWallClockBudget: cliDeadline)
    }
    /// Resolves and revalidates the frozen rewrite target immediately before a rewrite:
    /// re-finds the recorded target app, activates it, waits for focus to settle, and
    /// re-reads the frozen Accessibility selection. Production performs real NSWorkspace/AX
    /// I/O; tests replace it to drive the rewrite pipeline (Rewriting busy state, CLI
    /// budget, cancellation, staleness) headless.
    lazy var rewriteSelectionResolver: @MainActor (
        _ targetAppBundleIdentifier: String?,
        _ targetAppPid: pid_t?,
        _ selectionToken: AccessibilitySelectionToken?,
        _ pipelineGeneration: UInt64?
    ) async -> RewriteTargetResolution = { [weak self] bundleIdentifier, pid, token, generation in
        guard let self else { return .targetAppMissing }
        return await self.resolveRewriteSelection(
            targetAppBundleIdentifier: bundleIdentifier,
            targetAppPid: pid,
            selectionToken: token,
            pipelineGeneration: generation
        )
    }
    lazy var openAIAPIKeyProvider: () -> String = { [home] in
        OpenAIAPIKeyStore.load(homePath: home)
    }
    /// Test-only delivery tap. When set, a routed paste stops at this boundary — everything
    /// up to it (routing, payload selection, generation guards) is the production path.
    var pasteInterceptorForTesting: (@MainActor (_ text: String, _ deliveryKind: PasteDeliveryKind, _ pipelineGeneration: UInt64?) -> Void)?

    // Real-time streaming
    private var realtimeClient: RealtimeTranscriptionClient?
    private var streamingTask: Task<Void, Never>?
    private var pcmStreamPipe: PCMStreamPipe?
    private var streamingText = ""
    private var recordedPCM = Data()
    private var activeAudioPath: String?
    private let accessibilityPromptGate = AccessibilityPromptGate.processShared
    private(set) var recordingGeneration: UInt64 = 0
    private var activeCaptureConfiguration: RecordingCaptureConfiguration?
    var pipelineDeliveryGate = PipelineDeliveryGate()
    /// Generation whose intent delivery (Deciding/Answering/Rewriting) is in flight, or nil.
    /// Scoped to the generation so a stale completion can never clear a newer pending state.
    private var intentDeliveryPendingGeneration: UInt64?
    lazy var intentClassifier = SpeechIntentClassifier(
        apiKeyProvider: { [home] in OpenAIAPIKeyStore.load(homePath: home) }
    )
    private lazy var pasteTransactionCoordinator = makePasteTransactionCoordinator(
        schedule: { delay, operation in
            DispatchQueue.main.asyncAfter(deadline: .now() + delay) {
                MainActor.assumeIsolated { operation() }
            }
        },
        writeAndVerify: { text in
            let pasteboard = NSPasteboard.general
            return RecordingEngine.writeClipboardAttempt(text, to: pasteboard)
        },
        postPaste: { [weak self] in
            // Secure input is checked here, on the posting turn, rather than earlier: a
            // password field can take it between the readiness checks and the keystroke, and
            // while it is held the window server drops every synthetic event.
            let secureInput = SecureInputProbe.current()
            self?.lastPasteSecureInputProbe = secureInput
            if case .active(let holder) = secureInput {
                return .refusedSecureInput(holder)
            }
            let source = CGEventSource(stateID: .hidSystemState)
            guard let down = CGEvent(keyboardEventSource: source, virtualKey: 0x09, keyDown: true),
                  let up = CGEvent(keyboardEventSource: source, virtualKey: 0x09, keyDown: false) else {
                return .constructionFailed
            }
            down.flags = .maskCommand
            up.flags = .maskCommand
            down.post(tap: .cgSessionEventTap)
            up.post(tap: .cgSessionEventTap)
            // Probed AGAIN, after posting, because the pre-post reading cannot cover the case
            // that matters: a password field takes secure input between that probe and the
            // keystroke. The window server then drops both events, and the read-back — which
            // compares two AX reads of the focused field — can say "the text did not land" but
            // never "secure input ate it". Its vocabulary tops out at
            // `.notObservedFocusedValueUnchanged` / `.unverified(.readBackUnreadable)`, so the
            // outcome falls to `.deliveryNotObserved` or `.deliveredUnverified`, neither of which
            // is an `isSecureInputOutcome` — deliberately — so NOTHING is persisted: no warning
            // icon, no VoiceOver "blocked" label, and no "press Cmd-V", which is the only thing
            // telling the owner the transcript is still recoverable.
            //
            // And the log was not merely silent about the cause, it stated the opposite:
            // `lastPasteSecureInputProbe` still held the pre-post reading, so
            // `PasteDeliveryReport.logLine` recorded `secureInput=inactive` for a paste secure
            // input had actually eaten.
            //
            // Only an `.active` reading overwrites the stored probe. A post-post `.unknown` after
            // a definite pre-post `.inactive` is less informative about the posting turn, not
            // more, so it must not replace it. The residual race — secure input taken and
            // released entirely inside the posting window — is unobservable from here and stays
            // unobservable; this closes the case where it is still held.
            //
            // This reading does NOT change the return value, and that is the whole design of it.
            // Returning `.refusedSecureInput` here would be wrong twice over. The coordinator
            // answers that case with `failNow`, which settles immediately and never builds the
            // `PendingDelivery` — so the read-back, the ONLY evidence that can say whether the
            // keystroke actually landed, would be discarded at precisely the moment it is needed.
            // And a post-post `.active` reading cannot distinguish the two cases it spans: secure
            // input taken between `up.post()` and this probe leaves the events already dispatched
            // and probably delivered, while secure input taken during the posts drops them.
            // Calling that a refusal would tell the owner "transcript copied, press Cmd-V" for a
            // paste that already succeeded, and Cmd-V would paste it a second time — a worse
            // failure than the missing disclosure it was meant to fix. It would also make the log
            // say `not_posted_secure_input` for events that WERE posted, trading one false
            // statement for another. `.refusedSecureInput` means "nothing was posted"; it must
            // keep meaning that.
            //
            // So the read-back stays the arbiter (#28's ruling) and this probe makes the LOG
            // honest: `PasteDeliveryReport` now carries the post-post reading, where it previously
            // carried the pre-post one and recorded `secure_input=inactive` for a paste secure
            // input may have eaten — asserting the opposite of what happened rather than merely
            // omitting it.
            //
            // NOT restored, and deliberately: attribution strong enough to reach the persistence
            // and visibility path. Making a non-confirming read-back settle as
            // `.secureInputActive` needs a new keystroke-attempt case threaded through
            // `PasteAttempt`, or the log token lies about whether events were posted. That
            // widening is a design change, left for review rather than smuggled in here.
            let secureInputAfterPost = SecureInputProbe.current()
            switch secureInputAfterPost {
            // Held after the posts: the reading the log must carry.
            case .active: self?.lastPasteSecureInputProbe = secureInputAfterPost
            // Definite after an indefinite pre-post reading is strictly more informative, so it
            // replaces it; the reverse would discard a definite reading for an indefinite one.
            case .inactive: if case .unknown = secureInput { self?.lastPasteSecureInputProbe = secureInputAfterPost }
            case .unknown: break
            }
            // Constructed and posted. Nothing here observes delivery, which is why this
            // returns `.posted` and not a success.
            return .posted
        }
    )
    /// Secure-input reading taken on the last posting turn, or nil when no paste has reached
    /// the posting step. Kept so the delivery log can say whether synthetic input was even
    /// possible instead of leaving the reader to guess.
    private var lastPasteSecureInputProbe: SecureInputState?

    /// Every coordinator the engine owns must publish its idle transitions:
    /// `canStartRecording` derives from coordinator state, and settlement back to idle is
    /// otherwise invisible to observers — the menu bar would stay busy with Start disabled
    /// until some unrelated published change.
    private func makePasteTransactionCoordinator(
        schedule: @escaping PasteTransactionCoordinator.Scheduler,
        writeAndVerify: @escaping PasteTransactionCoordinator.PayloadWriter,
        postPaste: @escaping PasteTransactionCoordinator.PastePoster
    ) -> PasteTransactionCoordinator {
        let coordinator = PasteTransactionCoordinator(
            schedule: schedule,
            writeAndVerify: writeAndVerify,
            postPaste: postPaste
        )
        coordinator.pendingTransactionWillChange = { [weak self] in
            self?.objectWillChange.send()
        }
        return coordinator
    }

    #if DEBUG
    /// Test-only: swaps in a coordinator with injected I/O while keeping the production
    /// observation wiring, so settlement observability can be driven deterministically.
    @discardableResult
    func installPasteCoordinatorForTesting(
        schedule: @escaping PasteTransactionCoordinator.Scheduler,
        writeAndVerify: @escaping PasteTransactionCoordinator.PayloadWriter,
        postPaste: @escaping PasteTransactionCoordinator.PastePoster
    ) -> PasteTransactionCoordinator {
        let coordinator = makePasteTransactionCoordinator(
            schedule: schedule,
            writeAndVerify: writeAndVerify,
            postPaste: postPaste
        )
        pasteTransactionCoordinator = coordinator
        return coordinator
    }
    #endif

    private nonisolated static let realtimePeriodicCommitIntervalMilliseconds: UInt64 = 900
    /// Floor of the post-release settlement budget. The settlement wait polls every 10 ms
    /// and returns the moment the final transcription lands, so the budget is only ever
    /// paid in full when the realtime session is still unsettled — the common settled case
    /// costs its actual settle time (measured 0.6-1.6 s on station-class hardware).
    private nonisolated static let realtimeSettleBudgetFloorMilliseconds: UInt64 = 1_500
    /// Additional settlement budget granted per second of captured audio. A settlement
    /// miss falls back to re-transcribing the whole recording through the batch API, which
    /// costs roughly a quarter of the recording's duration (measured: 4 s floor + ~25%
    /// of audio length) — so the longer the recording, the more waiting is worth it.
    private nonisolated static let realtimeSettleBudgetPerAudioSecondMilliseconds: UInt64 = 25
    /// Ceiling of the settlement budget: past this point the user has watched
    /// "Transcribing..." for so long that starting the recoverable batch path is the
    /// better trade even for very long recordings.
    private nonisolated static let realtimeSettleBudgetCeilingMilliseconds: UInt64 = 5_000
    /// PCM byte rate of the capture pipeline (24 kHz, 16-bit, mono) — used to convert
    /// captured byte counts back into audio seconds for the settlement budget.
    private nonisolated static let capturedPCMBytesPerSecond = 48_000

    /// Settlement budget for `RealtimeTranscriptionClient.finish` scaled to the captured
    /// audio length. The previous fixed 700 ms budget was routinely missed by real
    /// sessions (final transcription completions arrive ~0.6-1.6 s after release), which
    /// silently demoted nearly every recording to the duration-proportional batch path —
    /// the "one minute to transcribe" failure mode this budget exists to prevent.
    public nonisolated static func realtimeSettleBudgetMilliseconds(pcmByteCount: Int) -> UInt64 {
        let audioSeconds = UInt64(max(pcmByteCount, 0)) / UInt64(capturedPCMBytesPerSecond)
        let (scaled, overflowed) = audioSeconds.multipliedReportingOverflow(
            by: realtimeSettleBudgetPerAudioSecondMilliseconds
        )
        guard !overflowed else { return realtimeSettleBudgetCeilingMilliseconds }
        let (budget, budgetOverflowed) = realtimeSettleBudgetFloorMilliseconds
            .addingReportingOverflow(scaled)
        guard !budgetOverflowed else { return realtimeSettleBudgetCeilingMilliseconds }
        return min(budget, realtimeSettleBudgetCeilingMilliseconds)
    }
    /// Hard wall-clock budget for the rewrite helper (CLI spawn + one model call), covering
    /// execution *and* CLIRunner's termination grace, kill grace, and pipe drain — not just
    /// the child execution deadline. The user is waiting with recording blocked, so this
    /// matches the interactive answer ceiling (`SpeechIntentClassifier.conversationTimeout`)
    /// — never the generic 120 s CLI ceiling; cancellation stays available the whole time.
    /// The `commandCLI` seam hands CLIRunner `commandRewriteTimeout` minus
    /// `commandRewriteReturnMargin` so the runner's own deadline keeping plus the return
    /// path stays inside this ceiling.
    nonisolated static let commandRewriteTimeout: TimeInterval = 10
    /// Wall-clock margin reserved out of `commandRewriteTimeout` before it becomes
    /// CLIRunner's total deadline. CLIRunner clamps every wait to that deadline but still
    /// pays small unclamped costs around them — spawn setup, waitid poll granularity (each
    /// bounded wait can oversleep one 10 ms poll), synchronous capture shutdown, and the
    /// detached-task hop back to the MainActor. Reserving a full second keeps the
    /// *observable* rewrite time under the public ceiling even when the execution window,
    /// termination grace, and pipe drain all run to exhaustion.
    nonisolated static let commandRewriteReturnMargin: TimeInterval = 1

    /// Create this operation synchronously before awaiting the blocking queue: creating
    /// its deadline inside the submitted closure would give delayed work a fresh budget.
    nonisolated static func makeCommandRewriteOperation(
        args: [String],
        home: String,
        runCLI: @escaping @Sendable ([String], String, TimeInterval) -> String,
        deadline: CLIRunner.WallClockDeadline = .init(after: commandRewriteTimeout)
    ) -> @Sendable () -> String {
        return {
            let remaining = min(commandRewriteTimeout, deadline.remaining())
            guard remaining > commandRewriteReturnMargin + CLIRunner.wallClockCleanupReserve else {
                return "ERROR: \(CLIRunner.ExecutionError.deadlineExhausted.localizedDescription)"
            }
            return runCLI(args, home, remaining)
        }
    }
    /// Wait before each read-back of the target app's focused field. The window server
    /// delivers the posted keystroke asynchronously and the app then does its own work, so a
    /// read taken on the posting turn would report "unchanged" for a paste that is simply
    /// still in flight.
    nonisolated static let pasteReadBackInterval: TimeInterval = 0.15
    /// How many read-backs before "the field did not change" is accepted as the verdict.
    /// Four reads spaced by `pasteReadBackInterval` give a slow target app ~0.6 s to show the
    /// paste; a confirmation on any read ends the wait immediately. The transaction stays
    /// pending for that window, which is why the budget is bounded rather than generous.
    nonisolated static let pasteReadBackAttempts = 4

    // fn key monitor (CGEventTap-based, swallows fn to prevent emoji picker)
    private let fnMonitor = FnKeyMonitor()
    private var permissionRetryTimer: Timer?

    /// Filesystem root for every artifact the engine owns: the audio spool, the
    /// API-key/language store (`config.json`), `Recordings.log`, and the `recordings` CLI it
    /// shells out to. This is the same `homePath:` seam `NativeAppLog.write` and
    /// `OpenAIAPIKeyStore` already expose, defaulted the same way — production keeps the real
    /// home and is unchanged.
    ///
    /// Unlike the closure seams above it must be supplied before `init` returns, because
    /// `init` already creates `audioDir` and logs; hence an `init(homePath:)` parameter
    /// rather than a settable property. Tests must pass a temp directory: with the default,
    /// every engine a test builds appends the suite's synthetic fixtures
    /// (`target=com.example.editor pid=99999`) to the operator's live `Recordings.log` and
    /// rewrites their real `config.json`.
    let home: String
    private var audioDir: String { "\(home)/.hasna/recordings/audio" }

    public convenience init(homePath: String = FileManager.default.homeDirectoryForCurrentUser.path, installsGlobalHandlers: Bool = true) {
        self.init(homePath: homePath, preferences: .standard, preferencesSuiteName: nil, installsGlobalHandlers: installsGlobalHandlers, transcriptionProvider: nil)
    }

    /// Reuses native capture and paste with isolated preferences and an explicit provider.
    /// No global handlers, legacy keys, environment routing or helper CLI are consulted.
    public convenience init(configuration: RecordingEngineConfiguration, transcriptionProvider: any RecordingTranscriptionProvider) {
        // A validated non-empty suite name is supported by Foundation on macOS.
        let preferences = UserDefaults(suiteName: configuration.preferencesSuiteName)!
        self.init(homePath: configuration.isolatedHomePath, preferences: preferences, preferencesSuiteName: configuration.preferencesSuiteName, installsGlobalHandlers: false, transcriptionProvider: transcriptionProvider)
    }

    private init(homePath: String, preferences: UserDefaults, preferencesSuiteName: String?, installsGlobalHandlers: Bool, transcriptionProvider: (any RecordingTranscriptionProvider)?) {
        home = homePath
        self.preferences = preferences
        self.preferencesSuiteName = preferencesSuiteName
        self.installsGlobalHandlers = installsGlobalHandlers
        self.transcriptionProvider = transcriptionProvider
        try? FileManager.default.createDirectory(atPath: audioDir, withIntermediateDirectories: true)
        log("RecordingEngine init; microphone=\(microphonePermissionLabel); accessibility=\(accessibilityPermissionLabel)")

        // Load preferences
        if usesIsolatedProvider || home == FileManager.default.homeDirectoryForCurrentUser.path {
            autoPasteEnabled = storedPreference("recordingsAutoPaste") as? Bool ?? true
        }
        intentDetectionEnabled = storedPreference("intentDetectionEnabled") as? Bool ?? false
        transcriptionLanguage = usesIsolatedProvider
            ? (storedPreference("recordingsLanguage") as? String ?? "en")
            : OpenAIAPIKeyStore.loadLanguage(homePath: home)
        useFnKey = storedPreference("useFnKey") as? Bool ?? false
        guard installsGlobalHandlers else { statusMessage = "Ready"; return }
        if KeyboardShortcuts.getShortcut(for: .toggleRecording) == nil {
            KeyboardShortcuts.setShortcut(.init(.f5), for: .toggleRecording)
        }
        refreshHotkeyDiagnostics()
        logResolvedTrigger()

        // Set up fn key monitor — hold fn to record, release to stop (like WisprFlow)
        fnMonitor.onFnKeyDown = { [weak self] in
            Task { @MainActor [weak self] in
                guard let self else { return }
                self.fnKeyIsDown = true
                guard self.useFnKey else { return }
                guard Self.canBeginRecording(
                    isRecording: self.isRecording,
                    isTranscribing: self.isTranscribing,
                    isWarmingUpCapture: self.isWarmingUpCapture,
                    isAwaitingMicrophonePermission: self.microphonePermissionStartGate.isAwaitingResponse,
                    isDeliveryPending: self.deliveryIsPending
                ) else {
                    self.logIgnoredTrigger(.fnKey)
                    return
                }
                self.startRecording(trigger: .fnKey)
            }
        }
        fnMonitor.onFnKeyUp = { [weak self] in
            Task { @MainActor [weak self] in
                guard let self else { return }
                self.fnKeyIsDown = false
                guard self.useFnKey else { return }
                self.handleTriggerRelease(.fnKey)
            }
        }
        updateFnMonitor(allowAutomaticPrompt: false)

        KeyboardShortcuts.onKeyDown(for: .toggleRecording) { [weak self] in
            Task { @MainActor [weak self] in
                guard let self, !self.keyboardShortcutIsDown else { return }
                self.keyboardShortcutIsDown = true
                guard Self.canBeginRecording(
                    isRecording: self.isRecording,
                    isTranscribing: self.isTranscribing,
                    isWarmingUpCapture: self.isWarmingUpCapture,
                    isAwaitingMicrophonePermission: self.microphonePermissionStartGate.isAwaitingResponse,
                    isDeliveryPending: self.deliveryIsPending
                ) else {
                    self.logIgnoredTrigger(.keyboardShortcut)
                    return
                }
                self.startRecording(trigger: .keyboardShortcut)
            }
        }
        KeyboardShortcuts.onKeyUp(for: .toggleRecording) { [weak self] in
            Task { @MainActor [weak self] in
                guard let self, self.keyboardShortcutIsDown else { return }
                self.keyboardShortcutIsDown = false
                self.handleTriggerRelease(.keyboardShortcut)
            }
        }

        // Granting Accessibility does not revive a tap that failed to create,
        // so retry until permissions arrive instead of requiring a relaunch.
        permissionRetryTimer = Timer.scheduledTimer(withTimeInterval: 5.0, repeats: true) { [weak self] _ in
            Task { @MainActor [weak self] in
                self?.refreshFnMonitorHealth()
            }
        }

        updateStatus()
    }

    private func storedPreference(_ key: String) -> Any? {
        if let preferencesSuiteName {
            // UserDefaults.object also consults process/global domains. A separate app's
            // engine reads only its explicitly named persistent domain.
            return preferences.persistentDomain(forName: preferencesSuiteName)?[key]
        }
        return preferences.object(forKey: key)
    }

    public var microphonePermissionLabel: String {
        switch AVCaptureDevice.authorizationStatus(for: .audio) {
        case .authorized:
            return "Microphone allowed"
        case .notDetermined:
            return "Microphone not requested"
        case .denied:
            return "Microphone denied"
        case .restricted:
            return "Microphone restricted"
        @unknown default:
            return "Microphone unknown"
        }
    }

    public var accessibilityPermissionLabel: String {
        AXIsProcessTrusted() ? "Accessibility allowed" : "Accessibility needed"
    }

    public func requestMicrophonePermission() {
        log("requestMicrophonePermission status=\(AVCaptureDevice.authorizationStatus(for: .audio).rawValue)")
        AVCaptureDevice.requestAccess(for: .audio) { [weak self] granted in
            Task { @MainActor [weak self] in
                guard let self else { return }
                self.log("requestMicrophonePermission result granted=\(granted)")
                self.statusMessage = granted
                    ? "Microphone allowed"
                    : "Enable Microphone permission for Recordings in System Settings"
                self.objectWillChange.send()
            }
        }
    }

    public func requestAccessibilityPermission() {
        let result = accessibilityPromptGate.requestExplicitly()
        log("requestAccessibilityPermission trusted=\(result.trusted)")
        statusMessage = result.trusted
            ? "Accessibility allowed"
            : "Enable Accessibility permission for Recordings to paste"
        objectWillChange.send()
    }

    public func openMicrophoneSettings() {
        openPrivacySettings("Privacy_Microphone")
    }

    public func openAccessibilitySettings() {
        openPrivacySettings("Privacy_Accessibility")
    }

    private func openPrivacySettings(_ pane: String) {
        if let url = URL(string: "x-apple.systempreferences:com.apple.preference.security?\(pane)") {
            NSWorkspace.shared.open(url)
        }
    }

    /// Record which trigger is actually bound, at launch and whenever it changes.
    ///
    /// The log already showed `startRecording trigger=keyboardShortcut`, but never which
    /// key was registered — so a hotkey silently rebound to a key the keyboard cannot send
    /// was indistinguishable from a working one. Log the resolved binding so "is the
    /// trigger armed, and to what" is answerable from the log alone.
    public func logResolvedTrigger() {
        guard installsGlobalHandlers else { return }
        let stored = KeyboardShortcuts.getShortcut(for: .toggleRecording)
        let bound = stored
            .map { "carbonKeyCode=\($0.carbonKeyCode) carbonModifiers=\($0.carbonModifiers)" }
            ?? "none"
        // `getShortcut` is a UserDefaults read, so it says what is *configured*, never what
        // is *armed*: KeyboardShortcuts 1.12.0 discards RegisterEventHotKey's OSStatus, so a
        // chord already owned by another app is indistinguishable from a working one here.
        // Say "unknown" rather than let a stored value read as a live binding.
        let systemReserved = stored.map {
            Self.systemReservedShortcuts().contains([$0.carbonKeyCode, $0.carbonModifiers])
        }
        // The permission labels belong on the same line: a press that fires but delivers
        // nothing is a permission problem, and correlating two log lines by timestamp was
        // the only way to tell that apart from a trigger that never fired.
        log(
            "trigger bindings: shortcutStored=\(bound) "
                + "shortcutArmed=unknown(carbon-registration-status-not-exposed) "
                + "shortcutSystemReserved=\(systemReserved.map(String.init(describing:)) ?? "n/a") "
                + "useFnKey=\(useFnKey) fnMonitorRunning=\(fnMonitor.isRunning) "
                + "microphone=\(microphonePermissionLabel) accessibility=\(accessibilityPermissionLabel) "
                + "blocked=\(blockedReason ?? "none")"
        )
    }

    /// Both global triggers used to `return` silently when the engine was busy, so a press
    /// that produced nothing left no trace at all — indistinguishable from a trigger that
    /// never fired. Name the refusal instead.
    ///
    /// Every field the start gate consults must appear here, `isWarmingUpCapture` included:
    /// a press arriving during the ~100 ms warm-up is refused by that field alone, and
    /// omitting it would print every reason as false and reproduce the exact silence this
    /// function was added to end.
    private func logIgnoredTrigger(_ trigger: RecordingTrigger) {
        log(
            "trigger ignored trigger=\(trigger) isRecording=\(isRecording) "
                + "isWarmingUpCapture=\(isWarmingUpCapture) "
                + "isTranscribing=\(isTranscribing) deliveryPending=\(deliveryIsPending) "
                + "awaitingMicrophonePermission=\(microphonePermissionStartGate.isAwaitingResponse)"
        )
    }

    /// Accessibility is the gate in practice: `FnKeyMonitor` creates an *active* tap
    /// (`options: .defaultTap`, and it returns nil to swallow fn), and an event-modifying
    /// tap requires Accessibility. Only a listen-only tap would fall under Input
    /// Monitoring, so naming both grants sent people to the wrong pane.
    static let fnAccessibilityBlockedMessage =
        "fn needs Accessibility: System Settings > Privacy & Security > Accessibility"

    /// Periodic reconciliation of the fn tap against reality.
    ///
    /// Two failures this closes. Granting Accessibility does not revive a tap that failed to
    /// create, so it has to be retried — and the retry used to run `updateFnMonitor()`
    /// without `updateStatus()`, so the stale "fn needs Accessibility" line survived the
    /// grant. And a tap can die *after* creation (Accessibility revoked at runtime), which
    /// no creation-time check can see; `FnKeyMonitor.isRunning` now reflects whether the tap
    /// is actually enabled, so that case is detected here instead of reading as "Ready".
    private func refreshFnMonitorHealth() {
        guard useFnKey else { return }
        if fnMonitor.isRunning {
            if blockedReasons[.fnKey] != nil {
                setBlockedReason(nil, for: .fnKey)
                updateStatus()
            }
            return
        }
        if AXIsProcessTrusted() {
            log("fn monitor not running while trusted — retrying")
            updateFnMonitor()
        } else {
            setBlockedReason(Self.fnAccessibilityBlockedMessage, for: .fnKey)
        }
        updateStatus()
    }

    private func updateFnMonitor(allowAutomaticPrompt: Bool = true) {
        guard installsGlobalHandlers else { return }
        // Decided as a local first, then handed to the single writer once. Assigning the
        // published property from each branch is how the per-source erasure bug got in.
        var reason: String?
        if useFnKey {
            let ok = fnMonitor.start()
            log("fn monitor start ok=\(ok)")
            if !ok {
                if allowAutomaticPrompt {
                    let result = accessibilityPromptGate.trustForProtectedOperation()
                    log("fn monitor accessibility trusted=\(result.trusted) prompted=\(result.didPrompt)")
                }
                reason = Self.fnAccessibilityBlockedMessage
                log("trigger blocked: \(Self.fnAccessibilityBlockedMessage)")
            }
        } else {
            fnMonitor.stop()
        }
        setBlockedReason(reason, for: .fnKey)
    }

    /// Record or clear one source's reason and recompute the published value. Each source owns
    /// its own slot; this is the **only** writer of `blockedReason`.
    ///
    /// - Parameter generation: the recording generation a `.delivery` reason belongs to. Passed
    ///   explicitly by the paste completion because that closure can run *after*
    ///   `recordingGeneration` has already moved on — binding to the current value there would
    ///   stamp a superseded reason as fresh, which is the whole failure this parameter closes.
    ///   Ignored for every other source, none of which is recording-scoped.
    private func setBlockedReason(
        _ reason: String?,
        for source: BlockedReasonSource,
        generation: UInt64? = nil
    ) {
        if let reason, !reason.isEmpty {
            // Refuse the write outright when the reason belongs to a superseded recording. The
            // expiry in `updateStatus()` is lazy — no production caller runs it on the delivery
            // completion or the return to idle — so a superseded reason written here would render
            // and stay rendered until the owner next touched a trigger. Declining the store is the
            // pre-render gate; the expiry remains as defence against a generation bump that
            // happens AFTER a legitimate write.
            if source == .delivery, let generation, generation != recordingGeneration {
                log("delivery blocked reason refused for superseded generation=\(generation) current=\(recordingGeneration)")
                return
            }
            blockedReasons[source] = reason
            if source == .delivery {
                // `nil` means unscoped, NOT "current". The public `pasteIntoFrontApp` route has no
                // pipeline generation, so there is nothing that can supersede its reason and it
                // must not be stamped with a generation it never belonged to.
                deliveryBlockedReasonGeneration = generation
            }
        } else {
            blockedReasons.removeValue(forKey: source)
            if source == .delivery {
                deliveryBlockedReasonGeneration = nil
            }
        }
        let entries = blockedReasons
            .sorted { $0.key < $1.key }
            .map { BlockedReasonEntry(source: $0.key, message: $0.value) }
        blockedReasonEntries = entries
        let composed = entries
            .map(\.message)
            .joined(separator: " · ")
        blockedReason = composed.isEmpty ? nil : composed
    }

    /// Enabled system-reserved shortcuts, read straight from Carbon.
    ///
    /// KeyboardShortcuts has an equivalent `Shortcut.isTakenBySystem`, but it sits in a
    /// plain (internal) extension in the pinned 1.12.0 source, so it cannot be reached from
    /// here. Only shortcuts flagged enabled count: a disabled system binding does not
    /// contend for the key.
    static func systemReservedShortcuts() -> Set<[Int]> {
        var unmanaged: Unmanaged<CFArray>?
        guard
            CopySymbolicHotKeys(&unmanaged) == noErr,
            let entries = unmanaged?.takeRetainedValue() as? [[String: Any]]
        else {
            return []
        }
        var reserved: Set<[Int]> = []
        for entry in entries {
            guard
                (entry[kHISymbolicHotKeyEnabled] as? Bool) == true,
                let code = entry[kHISymbolicHotKeyCode] as? Int,
                let modifiers = entry[kHISymbolicHotKeyModifiers] as? Int
            else {
                continue
            }
            reserved.insert([code, modifiers])
        }
        return reserved
    }

    /// Re-evaluate whether the stored hotkey can plausibly arm.
    ///
    /// This is the honest half of a hard limit. `RegisterEventHotKey`'s `OSStatus` is
    /// swallowed inside KeyboardShortcuts 1.12.0 (`CarbonKeyboardShortcuts.register` guards
    /// on `registerError == noErr` and returns Void), so a hotkey stolen by *another
    /// application* is not observable from here at all. A collision with an enabled
    /// *system* shortcut is observable, and it is the case that silently wins, so it gets a
    /// real blocked reason instead of a "Ready" that is not true.
    /// Re-evaluate every trigger's health, push it to the UI, and record it. The one entry
    /// point callers should use after anything changes a binding.
    public func refreshTriggerDiagnostics() {
        guard installsGlobalHandlers else { updateStatus(); return }
        refreshHotkeyDiagnostics()
        updateStatus()
        logResolvedTrigger()
    }

    private func refreshHotkeyDiagnostics() {
        guard let shortcut = KeyboardShortcuts.getShortcut(for: .toggleRecording) else {
            setBlockedReason(nil, for: .hotkey)
            return
        }
        let key = [shortcut.carbonKeyCode, shortcut.carbonModifiers]
        var reason: String?
        if Self.systemReservedShortcuts().contains(key) {
            reason = "macOS already reserves this shortcut — pick another in Settings > Recording Shortcut"
            log("trigger blocked: hotkey collides with an enabled system shortcut \(key)")
        }
        setBlockedReason(reason, for: .hotkey)
    }

    /// Message shown after a trigger fired but the press was consumed before recording could
    /// start — in practice, the first fn press after a microphone permission prompt. Cancelling
    /// is correct for push-to-talk (releasing the key before the recorder starts must not leave
    /// a recording running with no key held); saying nothing about it is not.
    static let pressConsumedByPermissionPromptMessage =
        "Permission was requested — press and hold again to record"

    /// The only writer of the idle status pair. Nothing else may set `statusMessage` to
    /// "Ready" — three separate callers had grown their own copy of that assignment, and each
    /// one silently bypassed the `blockedReason` branch below, overwriting a live "the app
    /// cannot do the thing you asked" disclosure with a cheerful "Ready". Route every
    /// return-to-idle through here so a fourth copy cannot appear.
    public func updateStatus() {
        if captureIsActive || isTranscribing || deliveryIsPending { return }
        expireStaleDeliveryBlockedReason()
        // A blocked trigger outlives one status write. `init` and every `useFnKey` change
        // called `updateFnMonitor()` and then `updateStatus()`, so the fn permission
        // warning was overwritten with "Ready" before it could ever be read — an enabled
        // trigger that could not arm looked exactly like a working one. Idle now carries
        // the reason until the blocker clears.
        if let blockedReason {
            statusMessage = blockedReason
            flowPhase = .idle
            return
        }
        statusMessage = "Ready"
        flowPhase = .idle
    }

    /// Drop a `.delivery` reason whose recording has been superseded since it was written.
    ///
    /// Lazily, and deliberately named as such: this runs only from `updateStatus()`, and no
    /// production caller invokes that on the delivery completion or on the return to idle. It is
    /// therefore NOT the pre-render gate — `setBlockedReason` declining the write is. This covers
    /// the other half: a generation bump that happens after a legitimate write, which
    /// `cancelIntentProcessing()` does.
    ///
    /// This is the structural half of the delivery reason's lifetime, and it exists because the
    /// two halves are asymmetric: `updateDeliveryStatus` refuses to write a *status* for a
    /// superseded generation and clears nothing on that path, while the paste completion's
    /// `setBlockedReason(…, for: .delivery)` is ungated. A suppressed completion therefore
    /// withholds the status line and persists "press Cmd-V" anyway — pointing at a clipboard that
    /// has moved on, on the app's own instruction.
    ///
    /// A generation check here rather than a fifth enumerated clear site: the four existing clear
    /// sites cover the paths someone thought of, and the paths that matter are the ones nobody
    /// did. `cancelIntentProcessing()` is already one of them — it bumps `recordingGeneration`
    /// without clearing — and `PasteTransactionCoordinator.failNow` releases the pending fence
    /// *before* running the completion closure, so the interleaving is one inserted `await` away
    /// from being reachable rather than latent.
    private func expireStaleDeliveryBlockedReason() {
        guard let generation = deliveryBlockedReasonGeneration,
              generation != recordingGeneration else { return }
        log("delivery blocked reason expired generation=\(generation) current=\(recordingGeneration)")
        setBlockedReason(nil, for: .delivery)
    }

    // MARK: - Trigger release

    /// Single key-up path for both hold-to-record triggers, so fn and the configurable
    /// shortcut can never diverge on the only question that matters here: whether any audio
    /// exists yet. A release that lands before the first PCM chunk is a tap that captured
    /// nothing, and it is abandoned rather than transcribed.
    func handleTriggerRelease(_ trigger: RecordingTrigger) {
        guard activeTrigger == trigger else { return }
        guard isRecording else {
            log("\(trigger) released before audio started; cancelling pending start")
            cancelPendingStart()
            return
        }
        stopAndTranscribe()
    }

    /// Key-up with no audio yet. Two windows reach this: the microphone permission prompt
    /// (nothing was ever started, so there is nothing to tear down) and the warm-up window
    /// (the microphone is open and a realtime session may be negotiating, both of which must
    /// be closed).
    private func cancelPendingStart() {
        if isWarmingUpCapture {
            abandonWarmingCapture(
                reason: "trigger released before first audio",
                alert: .releasedBeforeAudio
            )
            return
        }
        // Nothing was started: the press landed while the microphone permission prompt was up
        // and was consumed by it. Both key-up handlers used to carry a copy of this disclosure;
        // it belongs here, once, with the rest of the no-audio branch.
        let consumedByPermissionPrompt = microphonePermissionStartGate.isAwaitingResponse
        resetRecordingIntent()
        if consumedByPermissionPrompt {
            setBlockedReason(Self.pressConsumedByPermissionPromptMessage, for: .pressConsumed)
        }
        updateStatus()
    }

    // MARK: - Toggle

    public func toggleRecording() {
        if captureIsActive { stopAndTranscribe() } else { startRecording(trigger: .manual) }
    }

    // MARK: - Start Recording (Streaming)

    public func startRecording(trigger: RecordingTrigger = .manual,
                               pasteTarget: RecordingPasteTargetSelection = .frontmostApplication) {
        guard Self.canBeginRecording(
            isRecording: isRecording,
            isTranscribing: isTranscribing,
            isWarmingUpCapture: isWarmingUpCapture,
            isAwaitingMicrophonePermission: microphonePermissionStartGate.isAwaitingResponse,
            isDeliveryPending: deliveryIsPending
        ) else {
            if isTranscribing {
                statusMessage = "Finish transcribing before recording again"
            } else if deliveryIsPending {
                statusMessage = "Still delivering the last recording"
            }
            return
        }
        log("startRecording trigger=\(trigger) microphoneStatus=\(microphoneAuthorization().rawValue) accessibility=\(accessibilityTrustCheck())")
        recordingGeneration &+= 1
        if pasteTargetProcessIdentityByGeneration.count >= 32 || frozenPasteTargetsByGeneration.count >= 32 {
            let oldestRetainedGeneration = recordingGeneration > 16 ? recordingGeneration - 16 : 0
            pasteTargetProcessIdentityByGeneration = pasteTargetProcessIdentityByGeneration.filter {
                $0.key >= oldestRetainedGeneration
            }
            frozenPasteTargetsByGeneration = frozenPasteTargetsByGeneration.filter { $0.key >= oldestRetainedGeneration }
        }
        activeTrigger = trigger
        keyboardShortcutIsDown = trigger == .keyboardShortcut
        conversationReply = nil
        // Both transient reasons are superseded by a new press, and the delivery one is the
        // reason this clearing exists: "transcript copied, press Cmd-V" was only ever cleared
        // by the NEXT delivery's completion, so a recording that produced no delivery left it
        // asserted indefinitely — and by then the clipboard may hold something else, so Cmd-V
        // pastes the wrong thing on the app's own instruction. This recording is about to
        // rewrite the clipboard, so the old instruction stops being true here.
        //
        // Accepted cost, stated rather than hidden: if this recording is itself cancelled, a
        // still-accurate "press Cmd-V" has been cleared early. Losing a true message is a
        // smaller failure than asserting a false one forever.
        setBlockedReason(nil, for: .pressConsumed)
        setBlockedReason(nil, for: .delivery)

        let myPID = ProcessInfo.processInfo.processIdentifier
        let frontmostApp: FrontmostAppSnapshot?
        switch pasteTarget {
        case .frontmostApplication:
            frontmostApp = frontmostAppSnapshot()
        case .frozen(let target):
            // Keep explicit nil distinct from omission, including when a previously
            // observed target terminated between the host's snapshot and this call.
            frozenPasteTargetsByGeneration[recordingGeneration] = pasteTarget
            if let target, target.processIdentifier != myPID,
               let app = pasteTargetApplicationLookup(target.processIdentifier), target.matches(app) {
                frontmostApp = FrontmostAppSnapshot(pid: target.processIdentifier, bundleIdentifier: target.bundleIdentifier, launchDate: target.launchDate)
            } else { frontmostApp = nil }
        }
        let isOwnApp = frontmostApp?.pid == myPID
        targetAppBundleIdentifier = isOwnApp ? nil : frontmostApp?.bundleIdentifier
        targetAppPid = isOwnApp ? nil : frontmostApp?.pid
        if !isOwnApp,
           let pid = frontmostApp?.pid,
           let bundleIdentifier = frontmostApp?.bundleIdentifier,
           let launchDate = frontmostApp?.launchDate {
            pasteTargetProcessIdentityByGeneration[recordingGeneration] = PasteTargetProcessIdentity(
                pid: pid,
                bundleIdentifier: bundleIdentifier,
                launchDate: launchDate
            )
        } else {
            pasteTargetProcessIdentityByGeneration[recordingGeneration] = nil
        }

        // The selection is still frozen for every recording (not only an exposed "command
        // mode"), so a later command decision can only ever act on the exact text and
        // element that were selected when the user started speaking. The Accessibility IPC
        // that reads it runs on a blocking-work queue, concurrently with recorder start:
        // neither the microphone nor a cooperative worker waits on a beachballing app. The MainActor stays
        // free to process the key-up that stops the recording. Skipped entirely when intent
        // detection is off — no command route exists to consume it.
        let shouldCaptureSelection = Self.shouldCaptureSelection(
            targetPid: targetAppPid,
            accessibilityTrusted: accessibilityTrustCheck(),
            intentDetectionEnabled: !usesIsolatedProvider && intentDetectionEnabled
        )
        let capturePid = targetAppPid
        let captureSelection = selectionCapture
        let windowTitleLookup = focusedWindowTitleLookup
        let windowTitlePid = frontmostApp?.pid
        let axSnapshotTask = Task.detached(priority: .userInitiated) { () -> RecordingStartAXSnapshot in
            await BlockingOperation.run {
                let selectionToken = shouldCaptureSelection ? capturePid.flatMap { captureSelection($0) } : nil
                let focusedWindowTitle = windowTitlePid.flatMap { windowTitleLookup($0) }
                return RecordingStartAXSnapshot(
                    selectionToken: selectionToken,
                    focusedWindowTitle: focusedWindowTitle
                )
            }
        }

        // Project auto-selection and the processing configuration resolve with the
        // snapshot, still once per recording start and frozen for this generation; the
        // recording pipeline awaits this context only after the recorder has stopped.
        let generation = recordingGeneration
        let projectStore = projectStore
        let cleanupPreferences = recordingCleanupPreferences
        let targetBundleIdentifierForProjects = targetAppBundleIdentifier
        let transcriptionLanguageAtStart = transcriptionLanguage
        let intentDetectionEnabledAtStart = !usesIsolatedProvider && intentDetectionEnabled
        let usesIsolatedProvider = usesIsolatedProvider
        let homePath = home
        let startContext = Task { @MainActor [weak self] () -> RecordingStartResolvedContext in
            let axSnapshot = await axSnapshotTask.value
            if let self, generation == self.recordingGeneration, let store = projectStore {
                let projects = store.settings.projects
                let detected = ProjectStore.matchProject(
                    windowTitle: axSnapshot.focusedWindowTitle,
                    bundleId: targetBundleIdentifierForProjects,
                    projects: projects
                )
                if let detected,
                   detected.id != store.settings.activeProjectId,
                   store.canMutateProjects {
                    do {
                        try store.setActive(detected.id)
                    } catch {
                        self.log("project auto-selection failed; continuing capture with the last active project: \(error.localizedDescription)")
                    }
                }
                if let warning = store.synchronizationError ?? store.persistenceError {
                    self.log("project synchronization degraded; continuing capture: \(warning)")
                }
            }
            let modelSelection = usesIsolatedProvider
                ? ProcessingModelSelection(transcriptionPrompt: "", transcriptionModel: "", transcriberModel: "", enhancementModel: "", intentModel: "", enhanceTriggersJSON: "[]", keywordTransformsJSON: "{}")
                : OpenAIAPIKeyStore.loadProcessingModelSelection(homePath: homePath)
            return RecordingStartResolvedContext(
                selectionToken: axSnapshot.selectionToken,
                canonicalProjectId: projectStore?.activeCanonicalProjectIdForRecording,
                displayProjectId: projectStore?.settings.activeProjectId,
                activeProjectName: projectStore?.activeProject?.name,
                processing: RecordingProcessingConfiguration(
                    transcriptionPrompt: modelSelection.transcriptionPrompt,
                    transcriberPrompt: cleanupPreferences.prompt,
                    postProcessingMode: cleanupPreferences.mode,
                    transcriptionLanguage: transcriptionLanguageAtStart,
                    transcriptionModel: modelSelection.transcriptionModel,
                    transcriberModel: modelSelection.transcriberModel,
                    enhancementModel: modelSelection.enhancementModel,
                    intentModel: modelSelection.intentModel,
                    intentDetectionEnabled: intentDetectionEnabledAtStart,
                    enhanceTriggersJSON: modelSelection.enhanceTriggersJSON,
                    keywordTransformsJSON: modelSelection.keywordTransformsJSON
                )
            )
        }

        switch microphoneAuthorization() {
        case .authorized:
            startNativeRecording(startContext: startContext)
        case .notDetermined:
            guard let requestID = microphonePermissionStartGate.reserve() else { return }
            statusMessage = "Allow microphone access to record"
            log("requesting microphone access before recording")
            AVCaptureDevice.requestAccess(for: .audio) { [weak self] granted in
                Task { @MainActor [weak self] in
                    guard let self else { return }
                    guard self.microphonePermissionStartGate.consumeResponse(for: requestID) else {
                        self.log("ignoring stale microphone permission response")
                        return
                    }
                    self.log("microphone access response granted=\(granted)")
                    if granted {
                        guard self.shouldContinueStarting(trigger: trigger) else {
                            self.log("recording start cancelled before microphone permission completed trigger=\(trigger)")
                            self.resetRecordingIntent()
                            self.updateStatus()
                            return
                        }
                        self.startNativeRecording(startContext: startContext)
                    } else {
                        self.resetRecordingIntent()
                        self.statusMessage = "Microphone permission denied"
                        self.flowPhase = .failed(self.statusMessage)
                    }
                }
            }
        case .denied, .restricted:
            resetRecordingIntent()
            log("microphone permission blocked status=\(microphoneAuthorization().rawValue)")
            statusMessage = "Enable Microphone permission for Recordings in System Settings"
            flowPhase = .failed(statusMessage)
        @unknown default:
            resetRecordingIntent()
            statusMessage = "Microphone permission unavailable"
            flowPhase = .failed(statusMessage)
        }
    }

    /// `isWarmingUpCapture` deliberately has no default. It is a safety input, and a default of
    /// `false` is the permissive value: a call site that forgot it would compile, read as
    /// startable during the warm-up window, and open a second recorder on top of a live one.
    nonisolated static func canBeginRecording(
        isRecording: Bool,
        isTranscribing: Bool,
        isWarmingUpCapture: Bool,
        isAwaitingMicrophonePermission: Bool = false,
        isDeliveryPending: Bool = false
    ) -> Bool {
        !isRecording && !isTranscribing && !isAwaitingMicrophonePermission && !isDeliveryPending
            && !isWarmingUpCapture
    }

    nonisolated static func shouldCaptureSelection(
        targetPid: pid_t?,
        accessibilityTrusted: Bool,
        intentDetectionEnabled: Bool
    ) -> Bool {
        targetPid != nil && accessibilityTrusted && intentDetectionEnabled
    }

    nonisolated static func recordingStatus(
        trigger: RecordingTrigger
    ) -> String {
        switch trigger {
        case .manual: "Recording — click Stop when finished"
        case .fnKey, .keyboardShortcut: "Recording — release to stop"
        }
    }

    private var deliveryIsPending: Bool {
        intentDeliveryPendingGeneration != nil || pasteTransactionCoordinator.hasPendingTransaction
    }

    private func beginIntentDelivery(for generation: UInt64) {
        intentDeliveryPendingGeneration = generation
    }

    private func endIntentDelivery(for generation: UInt64) {
        if intentDeliveryPendingGeneration == generation {
            intentDeliveryPendingGeneration = nil
        }
    }

    /// Truthful start availability for UI surfaces. Mirrors exactly the gate
    /// `startRecording` applies, so a menu bar or button can never present Start while the
    /// engine would reject it.
    public var canStartRecording: Bool {
        Self.canBeginRecording(
            isRecording: isRecording,
            isTranscribing: isTranscribing,
            isWarmingUpCapture: isWarmingUpCapture,
            isAwaitingMicrophonePermission: microphonePermissionStartGate.isAwaitingResponse,
            isDeliveryPending: deliveryIsPending
        )
    }

    /// A capture attempt is in flight — warming up or live. Anything that used to read
    /// `isRecording` because it meant "a recording is happening" reads this instead, so the
    /// warm-up window can neither look idle nor accept a second start.
    public var captureIsActive: Bool { isWarmingUpCapture || isRecording }

    /// Whether an in-flight Deciding/Answering/Rewriting delivery can be cancelled. Once a
    /// paste transaction is submitted the remaining window is sub-second and has its own
    /// target/clipboard safety rails, so cancellation stops being offered.
    public var canCancelIntentDelivery: Bool {
        intentDeliveryPendingGeneration != nil && !pasteTransactionCoordinator.hasPendingTransaction
    }

    /// Cancels the pending intent delivery. Every phase that can be pending here —
    /// Deciding, Answering, Rewriting — inserted the transcript into Recent before the
    /// phase began (and the recording was already persisted to the library), so cancelling
    /// only abandons the delivery: "transcript saved to Recent" is literally true. Bumping
    /// the generation makes every in-flight completion stale, and every completion path
    /// re-checks the generation before touching state, the clipboard, or the target app —
    /// a cancelled decision, answer, or rewrite can never land later.
    public func cancelIntentProcessing() {
        guard canCancelIntentDelivery else { return }
        log("intent delivery cancelled by user generation=\(recordingGeneration)")
        recordingGeneration &+= 1
        intentDeliveryPendingGeneration = nil
        isTranscribing = false
        liveTranscriptionText = ""
        statusMessage = "Cancelled — transcript saved to Recent"
        flowPhase = .idle
    }

    #if DEBUG
    /// Test-only: advances and registers a pipeline generation the way a recording
    /// start/stop pair would, so delivery tests can drive `finishWithText` repeatedly.
    func beginPipelineForTesting() -> UInt64 {
        recordingGeneration &+= 1
        pipelineDeliveryGate.registerPipeline(recordingGeneration)
        return recordingGeneration
    }
    #endif

    /// Single staleness rule for generation-bound deliveries: anything bound to a
    /// superseded generation — or arriving mid-recording — is abandoned.
    nonisolated static func shouldAbandonDelivery(
        pipelineGeneration: UInt64?,
        currentGeneration: UInt64,
        isRecording: Bool
    ) -> Bool {
        guard let pipelineGeneration else { return false }
        return isRecording || pipelineGeneration != currentGeneration
    }

    nonisolated static func shouldContinueStartingAfterPermission(
        trigger: RecordingTrigger,
        keyboardShortcutIsDown: Bool,
        fnKeyIsDown: Bool
    ) -> Bool {
        switch trigger {
        case .manual:
            return true
        case .keyboardShortcut:
            return keyboardShortcutIsDown
        case .fnKey:
            return fnKeyIsDown
        }
    }

    private func shouldContinueStarting(trigger: RecordingTrigger) -> Bool {
        activeTrigger == trigger && Self.shouldContinueStartingAfterPermission(
            trigger: trigger,
            keyboardShortcutIsDown: keyboardShortcutIsDown,
            fnKeyIsDown: fnKeyIsDown
        )
    }

    private func startNativeRecording(startContext: Task<RecordingStartResolvedContext, Never>) {
        let apiKey = usesIsolatedProvider ? "" : openAIAPIKeyProvider()
        if let transcriptionProvider {
            let generation = recordingGeneration
            let configuration = RecordingProviderSessionConfiguration(captureID: UUID().uuidString, language: transcriptionLanguage)
            do {
                providerSession = try transcriptionProvider.makeSession(configuration: configuration) { [weak self] text in
                    Task { @MainActor [weak self] in
                        guard let self, self.recordingGeneration == generation,
                              self.captureIsActive || self.isTranscribing else { return }
                        self.liveTranscriptionText = text
                    }
                }
                providerConfiguration = configuration
            } catch {
                resetRecordingIntent()
                statusMessage = error.localizedDescription
                flowPhase = .failed(statusMessage)
                return
            }
        }
        let captureConfiguration = RecordingCaptureConfiguration(
            targetAppBundleIdentifier: targetAppBundleIdentifier,
            targetAppPid: targetAppPid,
            startContext: startContext
        )
        activeCaptureConfiguration = captureConfiguration
        log("startNativeRecording apiKeyConfigured=\(!apiKey.isEmpty)")
        // Constructing the client is a plain allocation; the WebSocket handshake happens in
        // `beginRealtimeStreaming` below, only once the recorder has actually started. The
        // stream pipe needs the client at construction time, which is why the two steps are
        // split rather than simply reordered. The handshake cannot be deferred further — to
        // the first PCM chunk — without reworking `PCMStreamPipe`: `RealtimeTranscriptionClient`
        // silently drops audio queued while `isStreaming` is false.
        let client: RealtimeTranscriptionClient? = apiKey.isEmpty
            ? nil
            : RealtimeTranscriptionClient(apiKey: apiKey, homePath: home)
        realtimeClient = client

        let streamPipe = PCMStreamPipe(chunkSize: 4_800, client: client, providerSession: providerSession)
        pcmStreamPipe = streamPipe
        let homePath = home
        let captureGeneration = recordingGeneration
        let confirmCapture: @MainActor @Sendable (UInt64) -> Void = { [weak self] generation in
            self?.confirmCaptureIsLive(generation: generation)
        }
        let firstChunkLogged = LockedFlag()
        let monitor = CaptureMonitor()
        captureMonitor = monitor
        isPaused = false
        audioLevel = 0
        let recorder = recorderFactory { data in
            guard monitor.admit(data) else { return }
            if firstChunkLogged.take() {
                NativeAppLog.write("native recorder received first PCM chunk bytes=\(data.count)", homePath: homePath)
                // The first sample is the only honest signal that this recording exists.
                // Promoting the capture here — not when `start()` returned — is what makes a
                // release during warm-up take the cancel path.
                Task { @MainActor in confirmCapture(captureGeneration) }
            }
            streamPipe.append(data)
        }

        do {
            try recorder.start()
            log("native recorder started")
            nativeRecorder = recorder
            isWarmingUpCapture = true
            recordingDuration = 0
            streamingText = ""
            liveTranscriptionText = ""
            recordedPCM.removeAll(keepingCapacity: true)
            activeAudioPath = "\(audioDir)/recording-\(Self.timestampForFilename()).wav"
            let trigger = activeTrigger ?? .manual
            statusMessage = Self.recordingStatus(trigger: trigger)
            // The pane must not look dead for the ~100 ms of warm-up, so it enters the
            // listening layout immediately; Stop and Discard there both abandon the attempt.
            flowPhase = .listening
            if let client {
                beginRealtimeStreaming(client: client, transcriptionLanguage: transcriptionLanguage)
            }

            recordingTimer = Timer.scheduledTimer(withTimeInterval: 0.1, repeats: true) { [weak self] _ in
                Task { @MainActor [weak self] in
                    guard let self else { return }
                    let sample = monitor.snapshot()
                    self.recordingDuration = sample.duration
                    self.audioLevel = sample.level
                }
            }
        } catch {
            cancelProviderSession()
            log("native recorder failed error=\(error.localizedDescription)")
            // Unreachable today — nothing between `recorder.start()` and `isWarmingUpCapture`
            // can throw — but a warming flag left set here wedges the engine permanently: the
            // start gate refuses every press and no teardown path runs, with the input device
            // possibly open. One added throwing call above is all it would take, so clear it
            // here rather than rely on the current statement order.
            isWarmingUpCapture = false
            realtimeClient?.stop()
            realtimeClient = nil
            streamingTask?.cancel()
            streamingTask = nil
            pcmStreamPipe?.cancel()
            pcmStreamPipe = nil
            activeCaptureConfiguration = nil
            resetRecordingIntent()
            statusMessage = "Failed: \(error.localizedDescription)"
            flowPhase = .failed(statusMessage)
        }
    }

    // MARK: - Capture confirmation

    /// Promotes a warming capture to live on the first PCM chunk. Bound to the generation that
    /// requested it, because a chunk already in the recorder's delivery queue can be handed to
    /// the MainActor *after* a key-up has abandoned the attempt — that late chunk must never
    /// resurrect a dead recording.
    private func confirmCaptureIsLive(generation: UInt64) {
        guard generation == recordingGeneration, isWarmingUpCapture else { return }
        isWarmingUpCapture = false
        isRecording = true
        log("native capture confirmed live")
    }

    /// Tears down a capture attempt that never produced a sample. `recorder.start()` had
    /// succeeded, so the microphone is open and a realtime session may be mid-handshake, but
    /// there is no audio: running the transcription pipeline over that empty buffer is exactly
    /// what made a short tap finish silently. `alert` is nil when the user asked for the
    /// discard and therefore already knows the outcome.
    private func abandonWarmingCapture(reason: String, alert: RecordingAttemptAlert?) {
        guard isWarmingUpCapture else { return }
        log("capture abandoned before first audio reason=\(reason)")
        cancelProviderSession()
        // Supersede the attempt so every completion still bound to it — a queued first-chunk
        // confirmation, the resolved start context — is stale and cannot apply.
        recordingGeneration &+= 1

        recordingTimer?.invalidate()
        recordingTimer = nil

        let recorder = nativeRecorder
        nativeRecorder = nil
        recorder?.stop()

        realtimeClient?.stop()
        realtimeClient = nil
        streamingTask?.cancel()
        streamingTask = nil
        pcmStreamPipe?.cancel()
        pcmStreamPipe = nil

        isWarmingUpCapture = false
        isRecording = false
        isTranscribing = false
        streamingText = ""
        liveTranscriptionText = ""
        recordedPCM.removeAll(keepingCapacity: true)
        activeAudioPath = nil
        activeCaptureConfiguration = nil
        resetRecordingIntent()

        if let alert {
            discloseEmptyAttempt(alert)
        } else {
            // `updateStatus()`, never a direct "Ready": the state above is already cleared, so
            // its early return does not fire, and going through it is what preserves a live
            // `blockedReason` instead of overwriting the disclosure with "Ready".
            updateStatus()
        }
    }

    // MARK: - Visible outcome

    /// Discloses an attempt that produced nothing, on the one surface that is always on screen.
    ///
    /// Routed through `setBlockedReason(_:for: .pressConsumed)` rather than a published field of
    /// its own. That slot already means "a press was consumed and nothing was recorded", it is
    /// already cleared by the next `startRecording`, and `MenuBarPresentation` already renders
    /// `blockedReason` with a distinct icon and a distinct VoiceOver label. It also outlives a
    /// timer: the disclosure is still on the glyph a minute later, which a three-second badge on
    /// a surface the user had no reason to watch would not be.
    private func discloseEmptyAttempt(_ alert: RecordingAttemptAlert) {
        log("attempt produced no audio disclosure=\(alert)")
        setBlockedReason(alert.message, for: .pressConsumed)
        updateStatus()
    }

    // MARK: - Real-time Streaming

    private func beginRealtimeStreaming(
        client: RealtimeTranscriptionClient,
        transcriptionLanguage: String
    ) {
        let language = OpenAIAPIKeyStore.apiLanguageHint(for: transcriptionLanguage)
        log("realtime streaming task starting language=\(language.isEmpty ? "auto" : language)")

        streamingTask = Task {
            await client.startStreaming(language: language)
            self.log("realtime start completed streaming=\(client.isStreaming) error=\(client.error ?? "")")

            var lastPeriodicCommitAt: UInt64?

            // Receive deltas
            while client.isStreaming {
                try? await Task.sleep(for: .milliseconds(100))
                let now = Self.monotonicMilliseconds()
                let periodicCommitIsDue = Self.realtimePeriodicCommitIsDue(
                    nowMilliseconds: now,
                    lastCommitMilliseconds: lastPeriodicCommitAt
                )
                if self.isRecording, periodicCommitIsDue {
                    if await client.commitInput(reason: "periodic") {
                        lastPeriodicCommitAt = now
                    }
                }
                let text = client.accumulatedText
                if text != streamingText {
                    await MainActor.run {
                        self.streamingText = text
                        self.liveTranscriptionText = Self.cleanRealtimeArtifactText(text)
                    }
                }
            }

            if let message = client.error, !message.isEmpty {
                await MainActor.run {
                    self.log("realtime unavailable message=\(message)")
                    if self.isRecording {
                        self.statusMessage = "Live preview unavailable — will transcribe after recording"
                    }
                }
            }
        }
    }

    // MARK: - Cancel (discard without transcribing)

    public func cancelRecording() {
        if usesIsolatedProvider && isTranscribing {
            pipelineDeliveryGate.abandonPipeline(recordingGeneration)
            recordingGeneration &+= 1
            cancelProviderSession()
            isTranscribing = false
            liveTranscriptionText = ""
            recordedPCM.removeAll(keepingCapacity: true)
            activeAudioPath = nil
            resetRecordingIntent()
            updateStatus()
            return
        }
        // Discard during warm-up: identical teardown, but the user asked for it, so the glyph
        // stays quiet.
        if isWarmingUpCapture {
            abandonWarmingCapture(reason: "discarded during warm-up", alert: nil)
            return
        }
        guard isRecording else { return }
        log("cancelRecording")
        cancelProviderSession()

        recordingTimer?.invalidate()
        recordingTimer = nil

        let recorder = nativeRecorder
        nativeRecorder = nil
        recorder?.stop()

        realtimeClient?.stop()
        realtimeClient = nil
        streamingTask?.cancel()
        streamingTask = nil
        pcmStreamPipe?.cancel()
        pcmStreamPipe = nil

        isRecording = false
        isPaused = false
        audioLevel = 0
        recordingDuration = 0
        isTranscribing = false
        liveTranscriptionText = ""
        recordedPCM.removeAll(keepingCapacity: true)
        activeAudioPath = nil
        activeCaptureConfiguration = nil
        resetRecordingIntent()
        // Same reason as the warm-up abandon path: this used to assign "Ready" directly and
        // silently discard a live trigger-blocked warning.
        updateStatus()
    }

    // MARK: - Stop & Transcribe

    private func cancelProviderSession() {
        providerCompletionTask?.cancel()
        providerCompletionTask = nil
        providerSession?.cancel()
        providerSession = nil
        providerConfiguration = nil
    }

    /// The provider path shares capture, WAV writing and verified paste delivery with the
    /// legacy recorder. It never enters the legacy CLI, credential or intent-model paths.
    private func stopWithProvider(
        recorder: PCMRecordingSource?, pipe: PCMStreamPipe?,
        session: any RecordingTranscriptionSession,
        configuration: RecordingProviderSessionConfiguration, audioPath: String?,
        targetAppBundleIdentifier: String?, targetAppPid: pid_t?,
        pipelineGeneration: UInt64, pipelineTrace: RecordingPipelineTrace
    ) {
        providerCompletionTask = Task { [weak self] in
            // Shutdown and drain belong to this capture even if the user cancels and starts
            // another one before the native input tap has stopped.
            await Task.detached(priority: .userInitiated) { recorder?.stop() }.value
            let pcm = await pipe?.finish() ?? Data()
            guard !Task.isCancelled, let self,
                  self.recordingGeneration == pipelineGeneration else { return }
            var timings = [pipelineTrace.message(stage: "pcm_drain_complete", detail: "pcm_bytes=\(pcm.count)")]
            // Capture timestamps now, but batch their I/O after completion. Instrumentation
            // must not add a log-file write before the early network commit or WAV write.
            defer { self.log(timings.joined(separator: "\n")) }
            do {
                guard !pcm.isEmpty, let audioPath else { throw RecordingProviderError.noAudio }
                let audioURL = URL(fileURLWithPath: audioPath)
                session.inputEnded()
                timings.append(pipelineTrace.message(stage: "provider_input_ended"))
                let writeAudio = self.providerAudioWriter
                try await Task.detached(priority: .userInitiated) {
                    try writeAudio(pcm, audioURL)
                }.value
                try Task.checkCancellation()
                guard self.recordingGeneration == pipelineGeneration else { return }
                timings.append(pipelineTrace.message(stage: "wav_write_complete"))
                let duration = Double(pcm.count) / 48_000
                self.recordingDuration = duration
                let result = try await session.finish(RecordingTranscriptionRequest(
                    captureID: configuration.captureID, audioURL: audioURL,
                    duration: duration, language: configuration.language
                ))
                try Task.checkCancellation()
                guard self.recordingGeneration == pipelineGeneration else { return }
                timings.append(pipelineTrace.message(stage: "provider_finish_complete"))
                let rawText = result.rawText.trimmingCharacters(in: .whitespacesAndNewlines)
                let processed = result.processedText?.trimmingCharacters(in: .whitespacesAndNewlines)
                let text = (processed?.isEmpty == false ? processed : nil) ?? rawText
                guard !text.isEmpty else { throw RecordingProviderError.emptyTranscript }
                self.isTranscribing = false
                self.liveTranscriptionText = ""
                self.activeAudioPath = nil
                self.providerSession = nil
                self.providerConfiguration = nil
                self.providerCompletionTask = nil
                // Publication precedes delivery. Consumers may persist asynchronously without
                // delaying paste; this is an in-memory result, not a persistence receipt.
                self.recentTranscriptions.insert(TranscriptionResult(
                    rawText: rawText, processedText: processed?.isEmpty == false ? processed : nil,
                    timestamp: Date(), projectId: nil, projectName: nil,
                    captureID: configuration.captureID, audioURL: audioURL
                ), at: 0)
                if self.recentTranscriptions.count > 20 { self.recentTranscriptions.removeLast() }
                guard self.pipelineDeliveryGate.claimDelivery(for: pipelineGeneration) else { return }
                self.pasteIntoFrontApp(
                    text, targetAppBundleIdentifier: targetAppBundleIdentifier,
                    targetAppPid: targetAppPid, restoreClipboard: true,
                    deliveryKind: .ordinaryDictation, captureID: configuration.captureID, pipelineTrace: pipelineTrace,
                    pipelineGeneration: pipelineGeneration, deliveryCompleted: nil
                )
            } catch {
                guard self.recordingGeneration == pipelineGeneration, !Task.isCancelled else { return }
                session.cancel()
                self.providerSession = nil
                self.providerConfiguration = nil
                self.providerCompletionTask = nil
                self.activeAudioPath = nil
                self.pipelineDeliveryGate.abandonPipeline(pipelineGeneration)
                // Do not log provider errors: third-party error text can contain a token or
                // request URL. The host UI receives the localized description for diagnosis.
                self.isTranscribing = false
                self.liveTranscriptionText = ""
                self.statusMessage = error.localizedDescription
                self.flowPhase = .failed(self.statusMessage)
            }
        }
    }

    private func validatedStopPasteTarget(_ selection: RecordingPasteTargetSelection) -> RecordingPasteTarget? {
        let currentPID = ProcessInfo.processInfo.processIdentifier
        switch selection {
        case .frozen(let target):
            guard let target, target.processIdentifier != currentPID,
                  let observed = pasteTargetApplicationLookup(target.processIdentifier),
                  target.matches(observed) else { return nil }
            return target
        case .frontmostApplication:
            guard let frontmost = frontmostAppSnapshot(),
                  let observed = pasteTargetApplicationLookup(frontmost.pid),
                  observed.pid == frontmost.pid, observed.bundleIdentifier == frontmost.bundleIdentifier,
                  observed.launchDate == frontmost.launchDate else { return nil }
            return RecordingPasteTarget(observation: observed, currentPID: currentPID)
        }
    }

    /// An explicit override selects and freezes the destination at an active Stop.
    /// Omitting it preserves the Start-time target. Frozen nil means no destination;
    /// duplicate, idle, cancelled, and warm-up Stops cannot retarget a pipeline.
    public func stopAndTranscribe(pasteTarget: RecordingPasteTargetSelection? = nil) {
        // Stop during the warm-up window has nothing to transcribe — the microphone was opened
        // but has not delivered a sample. Abandon visibly instead of spending a transcription
        // pipeline (and a CLI round trip) on an empty buffer.
        if isWarmingUpCapture {
            abandonWarmingCapture(reason: "stopped during warm-up", alert: .releasedBeforeAudio)
            return
        }
        guard isRecording else { return }
        let pipelineTrace = RecordingPipelineTrace()
        log(pipelineTrace.message(stage: "release"))

        recordingTimer?.invalidate()
        recordingTimer = nil

        let recorder = nativeRecorder
        nativeRecorder = nil

        isRecording = false
        isTranscribing = true

        guard var captureConfiguration = activeCaptureConfiguration else {
            recorder?.stop()
            realtimeClient?.stop()
            realtimeClient = nil
            streamingTask?.cancel()
            streamingTask = nil
            pcmStreamPipe?.cancel()
            pcmStreamPipe = nil
            activeAudioPath = nil
            recordedPCM.removeAll(keepingCapacity: true)
            resetRecordingIntent()
            finish("Recording configuration unavailable")
            return
        }
        if let pasteTarget {
            let previousIdentity = pasteTargetProcessIdentityByGeneration[recordingGeneration]
            let target = validatedStopPasteTarget(pasteTarget)
            let identity = target.map {
                PasteTargetProcessIdentity(pid: $0.processIdentifier, bundleIdentifier: $0.bundleIdentifier,
                                           launchDate: $0.launchDate)
            }
            // Even an explicit frontmost request is now frozen: later focus or a
            // missing/replaced process cannot substitute another destination.
            frozenPasteTargetsByGeneration[recordingGeneration] = .frozen(target)
            pasteTargetProcessIdentityByGeneration[recordingGeneration] = identity
            self.targetAppBundleIdentifier = target?.bundleIdentifier
            self.targetAppPid = target?.processIdentifier
            captureConfiguration = captureConfiguration.retargeted(to: target,
                preservesSelection: identity != nil && identity == previousIdentity)
        }
        activeCaptureConfiguration = nil
        let targetAppBundleIdentifier = captureConfiguration.targetAppBundleIdentifier
        let targetAppPid = captureConfiguration.targetAppPid
        let audioPath = activeAudioPath
        latestAudioPath = audioPath
        isPaused = false
        audioLevel = 0
        let pcmStreamPipe = pcmStreamPipe
        let client = realtimeClient
        let pipelineGeneration = recordingGeneration
        pipelineDeliveryGate.registerPipeline(pipelineGeneration)
        statusMessage = "Transcribing..."
        flowPhase = .finalizing
        resetRecordingIntent()
        self.pcmStreamPipe = nil

        if let providerSession, let providerConfiguration {
            stopWithProvider(
                recorder: recorder, pipe: pcmStreamPipe, session: providerSession,
                configuration: providerConfiguration, audioPath: audioPath,
                targetAppBundleIdentifier: targetAppBundleIdentifier, targetAppPid: targetAppPid,
                pipelineGeneration: pipelineGeneration, pipelineTrace: pipelineTrace
            )
            return
        }

        Task {
            // AVAudioEngine shutdown can block for hundreds of milliseconds. Keep
            // receiving realtime text and repainting while capture drains completely.
            await Task.detached(priority: .userInitiated) { recorder?.stop() }.value
            if let pcmStreamPipe {
                self.recordedPCM = await pcmStreamPipe.finish()
                self.recordingDuration = Double(self.recordedPCM.count) / 48_000
            }
            self.log(pipelineTrace.message(
                stage: "pcm_drain_complete",
                detail: "pcm_bytes=\(self.recordedPCM.count)"
            ))

            let streamingResult = await client?.finish(
                timeoutMilliseconds: Self.realtimeSettleBudgetMilliseconds(
                    pcmByteCount: self.recordedPCM.count
                ),
                pipelineID: pipelineTrace.id,
                pipelineStartedUptimeMilliseconds: pipelineTrace.startedUptimeMilliseconds
            )
                ?? RealtimeFinishResult(text: "", settled: false, error: nil)
            self.log(pipelineTrace.message(
                stage: "realtime_finish_complete",
                detail: "settled=\(streamingResult.settled) chars=\(streamingResult.text.count)"
            ))

            // The start context was captured concurrently at recording start; by the time
            // the realtime transcript has settled it is resolved in all but pathological
            // cases, and its Accessibility reads are bounded either way.
            let startContext = await captureConfiguration.resolvedStartContext()
            let selectionToken = startContext.selectionToken
            let activeProjectId = startContext.displayProjectId
            let canonicalProjectId = startContext.canonicalProjectId
            let activeProjectName = startContext.activeProjectName
            let processingConfiguration = startContext.processing
            let postProcessingMode = processingConfiguration.postProcessingMode
            let busyLabel = Self.shouldLabelRewriting(
                postProcessingMode: postProcessingMode
            ) ? "Rewriting..." : "Transcribing..."

            self.realtimeClient = nil
            self.streamingTask?.cancel()
            self.streamingTask = nil
            if self.isTranscribing {
                self.statusMessage = busyLabel
                self.flowPhase = .processing(busyLabel)
            }

            if let error = streamingResult.error {
                self.log("realtime finish reported error=\(error)")
            }

            let realtimeText = Self.normalizedRealtimeTranscript(streamingResult.text)
            let safeRealtimeFallbackText = Self.settledRealtimeFallbackTranscript(
                finishResult: streamingResult,
                pcmByteCount: self.recordedPCM.count,
                language: processingConfiguration.transcriptionLanguage
            )
            let realtimeFastPathText = Self.settledRealtimeFastPathTranscript(
                finishResult: streamingResult,
                pcmByteCount: self.recordedPCM.count,
                language: processingConfiguration.transcriptionLanguage
            )

            self.liveTranscriptionText = ""

            if let realtimeFastPathText {
                let pcmData = self.recordedPCM
                let durationMs = Int(self.recordingDuration * 1_000)
                let language = OpenAIAPIKeyStore.apiLanguageHint(for: processingConfiguration.transcriptionLanguage)
                let homePath = self.home
                self.log(pipelineTrace.message(
                    stage: "realtime_fast_path_ready",
                    detail: "chars=\(realtimeFastPathText.count) pcm_bytes=\(pcmData.count)"
                ))
                let persist: @Sendable () async -> RealtimeFastPathSaveResult = {
                    await Self.saveRealtimeTranscript(
                        text: realtimeFastPathText,
                        audioPath: audioPath,
                        pcmData: pcmData,
                        durationMs: durationMs,
                        activeProjectId: canonicalProjectId,
                        processingConfiguration: processingConfiguration,
                        language: language,
                        recordingId: pipelineTrace.id,
                        homePath: homePath,
                        pipelineTrace: pipelineTrace
                    )
                }

                if Self.shouldPasteBeforePersistence(
                    postProcessingMode: postProcessingMode,
                    transcript: realtimeFastPathText,
                    hasSelection: selectionToken != nil,
                    intentDetectionEnabled: processingConfiguration.intentDetectionEnabled,
                    enhanceTriggersJSON: processingConfiguration.enhanceTriggersJSON
                ) {
                    self.isTranscribing = false
                    _ = Self.deliverRealtimeBeforePersistence(
                        text: realtimeFastPathText,
                        persist: persist,
                        deliver: { text in
                            await withCheckedContinuation { continuation in
                                self.finishWithText(
                                    text,
                                    rawTranscript: text,
                                    targetAppBundleIdentifier: targetAppBundleIdentifier,
                                    targetAppPid: targetAppPid,
                                    selectionToken: selectionToken,
                                    canonicalProjectId: canonicalProjectId,
                                    activeProjectId: activeProjectId,
                                    activeProjectName: activeProjectName,
                                    processingConfiguration: processingConfiguration,
                                    pipelineTrace: pipelineTrace,
                                    pipelineGeneration: pipelineGeneration,
                                    deliveryCompleted: { continuation.resume() }
                                )
                            }
                        },
                        persistenceCompleted: { result in
                            self.recordPersistenceCompletion(savedText: result.text)
                            if result.text == nil {
                                self.recoverAsyncPersistenceFailure(
                                    error: result.error ?? "Realtime save returned no recording",
                                    audioPath: audioPath,
                                    pcmData: pcmData,
                                    targetAppBundleIdentifier: targetAppBundleIdentifier,
                                    targetAppPid: targetAppPid,
                                    selectionToken: selectionToken,
                                    canonicalProjectId: canonicalProjectId,
                                    displayProjectId: activeProjectId,
                                    activeProjectName: activeProjectName,
                                    processingConfiguration: processingConfiguration,
                                    pipelineTrace: pipelineTrace,
                                    pipelineGeneration: pipelineGeneration
                                )
                            } else {
                                self.log(pipelineTrace.message(stage: "async_persistence_complete"))
                            }
                        }
                    )
                    self.activeAudioPath = nil
                    self.recordedPCM.removeAll(keepingCapacity: true)
                    return
                }

                let saveResult = await persist()
                self.recordPersistenceCompletion(savedText: saveResult.text)
                guard let savedText = saveResult.text else {
                    self.log("realtime fast-path save failed error=\(saveResult.error ?? "unknown")")
                    if let audioPath, FileManager.default.fileExists(atPath: audioPath) || self.writeCapturedWAV(to: audioPath) {
                        self.fallbackTranscribe(
                            audioPath: audioPath,
                            targetAppBundleIdentifier: targetAppBundleIdentifier,
                            targetAppPid: targetAppPid,
                            selectionToken: selectionToken,
                            canonicalProjectId: canonicalProjectId,
                            displayProjectId: activeProjectId,
                            activeProjectName: activeProjectName,
                            processingConfiguration: processingConfiguration,
                            realtimeText: safeRealtimeFallbackText,
                            pipelineTrace: pipelineTrace,
                            pipelineGeneration: pipelineGeneration
                        )
                    } else {
                        self.pipelineDeliveryGate.abandonPipeline(pipelineGeneration)
                        self.finish(saveResult.error ?? "Failed to save transcription")
                    }
                    self.activeAudioPath = nil
                    self.recordedPCM.removeAll(keepingCapacity: true)
                    return
                }
                self.isTranscribing = false
                self.finishWithText(
                    savedText,
                    rawTranscript: realtimeFastPathText,
                    targetAppBundleIdentifier: targetAppBundleIdentifier,
                    targetAppPid: targetAppPid,
                    selectionToken: selectionToken,
                    canonicalProjectId: canonicalProjectId,
                    activeProjectId: activeProjectId,
                    activeProjectName: activeProjectName,
                    processingConfiguration: processingConfiguration,
                    pipelineTrace: pipelineTrace,
                    pipelineGeneration: pipelineGeneration
                )
            } else if let audioPath, self.writeCapturedWAV(to: audioPath) {
                self.log(pipelineTrace.message(stage: "wav_write_complete", detail: "path=\(audioPath)"))
                if realtimeText != nil, !streamingResult.settled {
                    self.log("realtime fast path skipped because final transcript did not settle")
                }
                self.log("transcribing captured full audio with quality model audioPath=\(audioPath) realtimePreviewChars=\(realtimeText?.count ?? 0)")
                self.fallbackTranscribe(
                    audioPath: audioPath,
                    targetAppBundleIdentifier: targetAppBundleIdentifier,
                    targetAppPid: targetAppPid,
                    selectionToken: selectionToken,
                    canonicalProjectId: canonicalProjectId,
                    displayProjectId: activeProjectId,
                    activeProjectName: activeProjectName,
                    processingConfiguration: processingConfiguration,
                    realtimeText: safeRealtimeFallbackText,
                    pipelineTrace: pipelineTrace,
                    pipelineGeneration: pipelineGeneration
                )
            } else {
                let resolved = Self.resolveFinalTranscript(
                    cliText: nil,
                    cliError: "No audio captured",
                    realtimeText: safeRealtimeFallbackText
                )
                if let text = resolved.text {
                    self.log("no audio file written; using realtime transcript chars=\(text.count)")
                    self.isTranscribing = false
                    self.finishWithText(
                        text,
                        rawTranscript: text,
                        targetAppBundleIdentifier: targetAppBundleIdentifier,
                        targetAppPid: targetAppPid,
                        selectionToken: selectionToken,
                        canonicalProjectId: canonicalProjectId,
                        activeProjectId: activeProjectId,
                        activeProjectName: activeProjectName,
                        processingConfiguration: processingConfiguration,
                        pipelineTrace: pipelineTrace,
                        pipelineGeneration: pipelineGeneration
                    )
                } else {
                    self.log("no audio captured")
                    self.pipelineDeliveryGate.abandonPipeline(pipelineGeneration)
                    // The one failure the user has no other way to notice: nothing was typed,
                    // nothing appeared, and the status line lives behind a click on a menu-bar
                    // glyph that never changed. So disclose it on the glyph too.
                    //
                    // One message, used for both. `MenuBarPresentation` renders the blocked
                    // state as `statusText = blockedReason`, so passing the generic constant here
                    // while `finish` held a specific `failureStatus` would replace the specific
                    // diagnosis with "No audio captured" in every surface that reads the
                    // presentation — losing the more useful of the two.
                    let failure = resolved.failureStatus ?? RecordingAttemptAlert.noAudioCaptured.message
                    self.finish(failure)
                    self.setBlockedReason(failure, for: .pressConsumed)
                }
            }

            self.activeAudioPath = nil
            self.recordedPCM.removeAll(keepingCapacity: true)
        }
    }

    public nonisolated static func shouldFallbackFromPartialRealtime(text: String, pcmByteCount: Int) -> Bool {
        let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard pcmByteCount >= 48_000, !trimmed.isEmpty else { return false }
        let words = trimmed.split(whereSeparator: { $0.isWhitespace || $0.isNewline })
        return trimmed.count < 12 || words.count <= 2
    }

    public nonisolated static func normalizedRealtimeTranscript(_ text: String?) -> String? {
        guard let text else { return nil }
        let trimmed = cleanRealtimeArtifactText(text).trimmingCharacters(in: .whitespacesAndNewlines)
        return trimmed.isEmpty ? nil : trimmed
    }

    public nonisolated static func settledRealtimeFastPathTranscript(
        finishResult: RealtimeFinishResult,
        pcmByteCount: Int,
        language: String
    ) -> String? {
        guard let text = settledRealtimeFallbackTranscript(
            finishResult: finishResult,
            pcmByteCount: pcmByteCount,
            language: language
        ) else { return nil }
        return text
    }

    public nonisolated static func settledRealtimeFallbackTranscript(
        finishResult: RealtimeFinishResult,
        pcmByteCount: Int,
        language: String
    ) -> String? {
        // Transport failures cannot settle, so a settled transcript outranks incidental server errors.
        guard finishResult.settled else { return nil }
        guard let text = safeRealtimeFallbackTranscript(
            realtimeText: finishResult.text,
            language: language
        ) else { return nil }
        return shouldFallbackFromPartialRealtime(text: text, pcmByteCount: pcmByteCount) ? nil : text
    }

    /// Delivery may only run ahead of persistence for transcripts the local screens already
    /// decided are plain dictation: the paste is near-instant, so persistence is deferred by
    /// milliseconds. Command/conversation-shaped transcripts persist first — their delivery
    /// can block on the classifier, the assistant, or the rewrite CLI, and the recording
    /// must already be durable by then.
    ///
    /// `off` mode never rewrites, so plain dictation always qualifies. `auto` mode
    /// qualifies only when `EnhancementScreen` proves the helper cannot rewrite the
    /// transcript — enhancement-eligible speech must keep pasting the helper's output,
    /// which only exists after persistence. `always` mode rewrites unconditionally and
    /// therefore always persists first.
    nonisolated static func shouldPasteBeforePersistence(
        postProcessingMode: String,
        transcript: String,
        hasSelection: Bool,
        intentDetectionEnabled: Bool,
        // No default: "[]" decodes successfully to "no configured triggers", which
        // silently fails OPEN for a caller that forgets the argument — the opposite
        // of the fail-closed contract documented on EnhancementScreen. Every caller
        // must state the configured triggers explicitly (review F2 on #30).
        enhanceTriggersJSON: String
    ) -> Bool {
        switch PostProcessingMode(rawValue: postProcessingMode) {
        case .off:
            break
        case .auto:
            guard !EnhancementScreen.mayRequireEnhancement(
                text: transcript,
                enhanceTriggersJSON: enhanceTriggersJSON
            ) else { return false }
        default:
            return false
        }
        guard intentDetectionEnabled else { return true }
        return IntentScreen.screen(text: transcript, hasSelection: hasSelection)?.intent == .dictate
    }

    nonisolated static func shouldLabelRewriting(
        postProcessingMode: String
    ) -> Bool {
        PostProcessingMode(rawValue: postProcessingMode) != .off
    }

    @MainActor
    static func deliverRealtimeBeforePersistence(
        text: String,
        persist: @escaping @Sendable () async -> RealtimeFastPathSaveResult,
        deliver: @escaping @MainActor @Sendable (String) async -> Void,
        persistenceCompleted: @escaping @MainActor @Sendable (RealtimeFastPathSaveResult) -> Void
    ) -> Task<Void, Never> {
        return Task {
            await deliver(text)
            let result = await persist()
            persistenceCompleted(result)
        }
    }

    /// Publishes a monotonic completion event only for confirmed persistence. A failed
    /// helper result must not make the Library appear current before recovery succeeds.
    func recordPersistenceCompletion(savedText: String?) {
        guard savedText != nil else { return }
        persistedRecordingRevision &+= 1
    }

    public nonisolated static func shouldUseRealtimeFastPath(
        realtimeText: String?,
        pcmByteCount: Int,
        language: String = "en"
    ) -> Bool {
        realtimeFastPathTranscript(
            realtimeText: realtimeText,
            pcmByteCount: pcmByteCount,
            language: language
        ) != nil
    }

    public nonisolated static func realtimeFastPathTranscript(
        realtimeText: String?,
        pcmByteCount: Int,
        language: String = "en"
    ) -> String? {
        guard let text = safeRealtimeFallbackTranscript(realtimeText: realtimeText, language: language) else { return nil }
        return shouldFallbackFromPartialRealtime(text: text, pcmByteCount: pcmByteCount) ? nil : text
    }

    public nonisolated static func safeRealtimeFallbackTranscript(
        realtimeText: String?,
        language: String = "en"
    ) -> String? {
        guard let text = normalizedRealtimeTranscript(realtimeText) else { return nil }
        guard isSafeRealtimeFastPathText(
            rawText: realtimeText ?? "",
            cleanedText: text,
            language: language
        ) else { return nil }
        return text
    }

    public nonisolated static func isSafeRealtimeFastPathText(rawText: String, cleanedText: String, language: String) -> Bool {
        guard !cleanedText.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else { return false }
        let languageHint = OpenAIAPIKeyStore.apiLanguageHint(for: language)

        let rawTrimmed = rawText.trimmingCharacters(in: .whitespacesAndNewlines)
        let rawNormalized = normalizedTranscriptText(rawTrimmed)
        let cleanedNormalized = normalizedTranscriptText(cleanedText)
        guard !cleanedNormalized.isEmpty else { return false }
        if languageHint == "en" {
            guard cjkLetterCount(in: cleanedNormalized) == 0 else { return false }
        }
        guard rawNormalized != cleanedNormalized else { return true }
        guard cjkLetterCount(in: cleanedNormalized) == 0 else { return false }

        let cleanedWords = canonicalTranscriptWords(cleanedNormalized)
        guard !cleanedWords.isEmpty else { return false }

        // CJK fragments are known realtime transport artifacts, but repeated words and
        // fillers may be intentional speech. The fast path is only safe when cleanup
        // preserves every lexical token; otherwise the whole WAV is transcribed.
        let rawWords = languageHint == "en"
            ? canonicalTranscriptWordsPreservingSpeechTokens(rawNormalized)
            : canonicalTranscriptWords(rawNormalized)
        guard cleanedWords == rawWords else { return false }

        guard languageHint == "en" else { return true }

        let rawCJKCount = cjkLetterCount(in: rawNormalized)
        if rawCJKCount > 0 {
            let cleanedLatinCount = latinLetterCount(in: cleanedNormalized)
            guard cleanedLatinCount >= max(2, rawCJKCount * 2) else { return false }
            guard rawCJKCount <= max(6, cleanedLatinCount / 3) else { return false }
        }

        return true
    }

    public nonisolated static func wasRealtimeTranscriptRepaired(rawText: String, cleanedText: String) -> Bool {
        normalizedTranscriptText(rawText) != normalizedTranscriptText(cleanedText)
    }

    public nonisolated static func cleanRealtimeArtifactText(_ text: String) -> String {
        var cleaned = text
            .replacingOccurrences(of: "\n", with: " ")
            .replacingOccurrences(of: "\t", with: " ")
        cleaned = cleaned.replacingOccurrences(
            of: #"(?i)(?<=[A-Za-z])어\b"#,
            with: "",
            options: .regularExpression
        )
        cleaned = cleaned.replacingOccurrences(
            of: #"\s+"#,
            with: " ",
            options: .regularExpression
        )
        cleaned = removeStandaloneRealtimeArtifacts(from: cleaned)
        cleaned = collapseAdjacentDuplicateWords(in: cleaned)
        cleaned = collapseAdjacentDuplicatePhrases(in: cleaned)
        cleaned = cleaned.replacingOccurrences(
            of: #"\s+([,.;:!?])"#,
            with: "$1",
            options: .regularExpression
        )
        return cleaned.trimmingCharacters(in: .whitespacesAndNewlines)
    }

    private nonisolated static func removeStandaloneRealtimeArtifacts(from text: String) -> String {
        let artifactTokens: Set<String> = ["어", "음", "um", "umm", "uh", "uhh", "erm", "hmm", "eh"]
        let words = text.split(separator: " ").compactMap { rawWord -> String? in
            let normalized = rawWord
                .trimmingCharacters(in: .punctuationCharacters.union(.whitespacesAndNewlines))
                .lowercased()
            return artifactTokens.contains(normalized) ? nil : String(rawWord)
        }
        return words.joined(separator: " ")
    }

    private nonisolated static func normalizedTranscriptText(_ text: String) -> String {
        text
            .replacingOccurrences(of: "\n", with: " ")
            .replacingOccurrences(of: "\t", with: " ")
            .replacingOccurrences(
                of: #"\s+"#,
                with: " ",
                options: .regularExpression
            )
            .trimmingCharacters(in: .whitespacesAndNewlines)
    }

    private nonisolated static func canonicalTranscriptWords(_ text: String) -> [String] {
        text.split(whereSeparator: { $0.isWhitespace || $0.isNewline }).compactMap { rawWord in
            let normalized = String(rawWord)
                .trimmingCharacters(in: .punctuationCharacters.union(.whitespacesAndNewlines))
                .lowercased()
            guard !normalized.isEmpty else { return nil }
            return normalized
        }
    }

    private nonisolated static func canonicalTranscriptWordsPreservingSpeechTokens(_ text: String) -> [String] {
        text.split(whereSeparator: { $0.isWhitespace || $0.isNewline }).compactMap { rawWord in
            var normalized = String(rawWord)
                .trimmingCharacters(in: .punctuationCharacters.union(.whitespacesAndNewlines))
                .lowercased()
            if normalized == "어" || normalized == "음" {
                return nil
            }
            if normalized.hasSuffix("어") {
                let withoutSuffix = String(normalized.dropLast())
                if latinLetterCount(in: withoutSuffix) > 0 {
                    normalized = withoutSuffix
                }
            }
            return normalized.isEmpty ? nil : normalized
        }
    }

    private nonisolated static func collapseAdjacentDuplicateWords(in text: String) -> String {
        let words = text.split(separator: " ").map(String.init)
        guard words.count > 1 else { return text }

        var output: [String] = []
        for word in words {
            if let last = output.last,
               normalizedTranscriptWord(last) == normalizedTranscriptWord(word) {
                continue
            }
            output.append(word)
        }
        return output.joined(separator: " ")
    }

    private nonisolated static func collapseAdjacentDuplicatePhrases(in text: String) -> String {
        var words = text.split(separator: " ").map(String.init)
        guard words.count >= 6 else { return text }

        var i = 0
        while i < words.count {
            let maxLength = min(24, (words.count - i) / 2)
            var removedDuplicate = false
            if maxLength >= 3 {
                for length in stride(from: maxLength, through: 3, by: -1) {
                    let first = words[i..<(i + length)].map(normalizedTranscriptWord)
                    let second = words[(i + length)..<(i + (2 * length))].map(normalizedTranscriptWord)
                    if first == second {
                        words.removeSubrange((i + length)..<(i + (2 * length)))
                        removedDuplicate = true
                        break
                    }
                }
            }
            if !removedDuplicate {
                i += 1
            }
        }
        return words.joined(separator: " ")
    }

    private nonisolated static func normalizedTranscriptWord(_ word: String) -> String {
        word.trimmingCharacters(in: .punctuationCharacters.union(.whitespacesAndNewlines)).lowercased()
    }

    private nonisolated static func latinLetterCount(in text: String) -> Int {
        text.unicodeScalars.filter { scalar in
            (65...90).contains(Int(scalar.value)) || (97...122).contains(Int(scalar.value))
        }.count
    }

    private nonisolated static func cjkLetterCount(in text: String) -> Int {
        text.unicodeScalars.filter(isCJKScalar).count
    }

    private nonisolated static func containsCJKArtifact(in text: String) -> Bool {
        cjkLetterCount(in: text) > 0
    }

    private nonisolated static func isCJKScalar(_ scalar: UnicodeScalar) -> Bool {
        switch scalar.value {
        case 0x3040...0x30FF, 0x3400...0x4DBF, 0x4E00...0x9FFF, 0xAC00...0xD7AF:
            return true
        default:
            return false
        }
    }

    func finishWithText(
        _ text: String,
        rawTranscript: String,
        targetAppBundleIdentifier: String?,
        targetAppPid: pid_t?,
        selectionToken: AccessibilitySelectionToken?,
        canonicalProjectId: String?,
        activeProjectId: String?,
        activeProjectName: String?,
        processingConfiguration: RecordingProcessingConfiguration,
        pipelineTrace: RecordingPipelineTrace? = nil,
        pipelineGeneration: UInt64? = nil,
        deliveryCompleted: (@MainActor @Sendable () -> Void)? = nil
    ) {
        log("finishWithText chars=\(text.count) rawChars=\(rawTranscript.count)")
        if let pipelineGeneration,
           !pipelineDeliveryGate.claimDelivery(for: pipelineGeneration) {
            log("duplicate delivery suppressed pipeline_generation=\(pipelineGeneration)")
            deliveryCompleted?()
            return
        }
        // A delivery whose recording has been superseded (or that would land mid-recording)
        // is abandoned outright: the transcript is persisted to the library, and nothing may
        // paste into whatever the user is doing now.
        if isRecording || Self.shouldAbandonDelivery(
            pipelineGeneration: pipelineGeneration,
            currentGeneration: recordingGeneration,
            isRecording: isRecording
        ) {
            log("delivery abandoned for superseded recording pipeline_generation=\(pipelineGeneration.map(String.init) ?? "nil")")
            deliveryCompleted?()
            return
        }

        let execute: @MainActor @Sendable (RoutedSpeechAction, IntentDecisionOrigin, Bool) -> Void = { [weak self] action, origin, transcriptRetainedInRecent in
            guard let self else {
                deliveryCompleted?()
                return
            }
            self.executeRoutedAction(
                action,
                origin: origin,
                transcriptRetainedInRecent: transcriptRetainedInRecent,
                text: text,
                rawTranscript: rawTranscript,
                targetAppBundleIdentifier: targetAppBundleIdentifier,
                targetAppPid: targetAppPid,
                selectionToken: selectionToken,
                canonicalProjectId: canonicalProjectId,
                activeProjectId: activeProjectId,
                activeProjectName: activeProjectName,
                processingConfiguration: processingConfiguration,
                pipelineTrace: pipelineTrace,
                pipelineGeneration: pipelineGeneration,
                deliveryCompleted: deliveryCompleted
            )
        }

        // Voice shortcuts are explicit user-configured expansions and take precedence over
        // intent inference, exactly as they preceded routing before this flow existed.
        if let shortcutText = voiceShortcuts?.match(rawTranscript) {
            log("voice shortcut matched — pasting shortcut content")
            pasteIntoFrontApp(
                shortcutText,
                targetAppBundleIdentifier: targetAppBundleIdentifier,
                targetAppPid: targetAppPid,
                restoreClipboard: true,
                deliveryKind: .ordinaryDictation,
                pipelineTrace: pipelineTrace,
                pipelineGeneration: pipelineGeneration,
                deliveryCompleted: deliveryCompleted
            )
            insertRecentTranscription(
                rawText: rawTranscript,
                processedText: shortcutText,
                projectId: activeProjectId,
                projectName: activeProjectName
            )
            return
        }

        // Intent is always decided on the raw transcript — never on post-processed output,
        // which the enhancement pipeline may have rewritten.
        let routingContext = IntentRoutingContext(
            detectionEnabled: processingConfiguration.intentDetectionEnabled,
            hasSelection: selectionToken != nil,
            accessibilityTrusted: accessibilityTrustCheck()
        )
        if !routingContext.detectionEnabled {
            execute(IntentRouter.route(decision: nil, context: routingContext), .localScreen, false)
            return
        }
        if let localDecision = IntentScreen.screen(text: rawTranscript, hasSelection: routingContext.hasSelection) {
            log("intent decided locally intent=\(localDecision.intent.rawValue) reason=\(localDecision.reason)")
            execute(
                IntentRouter.route(decision: localDecision, context: routingContext),
                .localScreen,
                false
            )
            return
        }

        // Consult the classifier. New recordings are blocked while the decision is pending,
        // and the generation is re-checked afterwards so a stale (or user-cancelled)
        // decision can never act on a later recording.
        // The transcript enters Recent before the pending phase begins: cancelling while
        // Deciding (or any later phase) promises "transcript saved to Recent", so it must
        // already be there.
        insertRecentTranscription(
            rawText: rawTranscript,
            processedText: nil,
            projectId: activeProjectId,
            projectName: activeProjectName
        )
        let deliveryGeneration = pipelineGeneration ?? recordingGeneration
        beginIntentDelivery(for: deliveryGeneration)
        updateDeliveryStatus("Deciding...", kind: .progress, pipelineGeneration: pipelineGeneration)
        if let pipelineTrace { log(pipelineTrace.message(stage: "intent_classification_started")) }
        let classifier = intentClassifier
        let intentModel = processingConfiguration.intentModel
        let hasSelection = routingContext.hasSelection
        let trustCheck = accessibilityTrustCheck
        Task { [weak self] in
            let outcome = await classifier.classify(
                transcript: rawTranscript,
                hasSelection: hasSelection,
                model: intentModel
            )
            guard let self else {
                deliveryCompleted?()
                return
            }
            self.endIntentDelivery(for: deliveryGeneration)
            guard deliveryGeneration == self.recordingGeneration, !self.isRecording else {
                self.log("stale intent decision abandoned pipeline_generation=\(deliveryGeneration)")
                deliveryCompleted?()
                return
            }
            let decision: IntentDecision?
            switch outcome {
            case .decision(let classified):
                decision = classified
                self.log("intent classified intent=\(classified.intent.rawValue) confidence=\(classified.confidence) reason=\(classified.reason)")
            case .unavailable(let message):
                decision = nil
                self.log("intent classifier unavailable — failing closed to dictation: \(message)")
            }
            if let pipelineTrace { self.log(pipelineTrace.message(stage: "intent_classification_complete")) }
            let action = IntentRouter.route(
                decision: decision,
                context: IntentRoutingContext(
                    detectionEnabled: true,
                    hasSelection: hasSelection,
                    accessibilityTrusted: trustCheck()
                )
            )
            execute(action, .classifier, true)
        }
    }

    private func executeRoutedAction(
        _ action: RoutedSpeechAction,
        origin: IntentDecisionOrigin,
        transcriptRetainedInRecent: Bool,
        text: String,
        rawTranscript: String,
        targetAppBundleIdentifier: String?,
        targetAppPid: pid_t?,
        selectionToken: AccessibilitySelectionToken?,
        canonicalProjectId: String?,
        activeProjectId: String?,
        activeProjectName: String?,
        processingConfiguration: RecordingProcessingConfiguration,
        pipelineTrace: RecordingPipelineTrace?,
        pipelineGeneration: UInt64?,
        deliveryCompleted: (@MainActor @Sendable () -> Void)?
    ) {
        switch action {
        case .paste(let reason, let literalRawTranscript):
            log("intent route=paste origin=\(origin.rawValue) literal=\(literalRawTranscript) reason=\(reason)")
            let output = literalRawTranscript ? rawTranscript : text
            pasteIntoFrontApp(
                output,
                targetAppBundleIdentifier: targetAppBundleIdentifier,
                targetAppPid: targetAppPid,
                restoreClipboard: true,
                deliveryKind: .ordinaryDictation,
                pipelineTrace: pipelineTrace,
                pipelineGeneration: pipelineGeneration,
                deliveryCompleted: deliveryCompleted
            )
            if transcriptRetainedInRecent {
                attachProcessedTextToRecentTranscription(
                    rawText: rawTranscript,
                    processedText: output == rawTranscript ? nil : output
                )
            } else {
                insertRecentTranscription(
                    rawText: rawTranscript,
                    processedText: output == rawTranscript ? nil : output,
                    projectId: activeProjectId,
                    projectName: activeProjectName
                )
            }
        case .rewriteSelection(let reason):
            log("intent route=rewriteSelection origin=\(origin.rawValue) reason=\(reason)")
            // Retention before processing: the Rewriting phase can be cancelled (or fail),
            // and the Cancel affordance promises the transcript stays in Recent.
            if !transcriptRetainedInRecent {
                insertRecentTranscription(
                    rawText: rawTranscript,
                    processedText: nil,
                    projectId: activeProjectId,
                    projectName: activeProjectName
                )
            }
            runCommandMode(
                instruction: rawTranscript,
                targetAppBundleIdentifier: targetAppBundleIdentifier,
                targetAppPid: targetAppPid,
                selectionToken: selectionToken,
                canonicalProjectId: canonicalProjectId,
                processingConfiguration: processingConfiguration,
                pipelineTrace: pipelineTrace,
                pipelineGeneration: pipelineGeneration,
                deliveryCompleted: deliveryCompleted
            )
        case .answerConversation(let reason):
            log("intent route=answerConversation origin=\(origin.rawValue) reason=\(reason)")
            if !transcriptRetainedInRecent {
                insertRecentTranscription(
                    rawText: rawTranscript,
                    processedText: nil,
                    projectId: activeProjectId,
                    projectName: activeProjectName
                )
            }
            runConversationMode(
                question: rawTranscript,
                processingConfiguration: processingConfiguration,
                pipelineTrace: pipelineTrace,
                pipelineGeneration: pipelineGeneration,
                deliveryCompleted: deliveryCompleted
            )
        }
    }

    private func insertRecentTranscription(
        rawText: String,
        processedText: String?,
        projectId: String?,
        projectName: String?
    ) {
        recentTranscriptions.insert(
            TranscriptionResult(
                rawText: rawText,
                processedText: processedText,
                timestamp: Date(),
                projectId: projectId,
                projectName: projectName
            ),
            at: 0
        )
        if recentTranscriptions.count > 20 { recentTranscriptions.removeLast() }
    }

    /// Backfills the processed text onto a transcript that entered Recent when its pending
    /// phase began, so the entry shows exactly what was pasted. The original timestamp is
    /// preserved.
    private func attachProcessedTextToRecentTranscription(rawText: String, processedText: String?) {
        guard let processedText,
              let index = recentTranscriptions.firstIndex(where: { $0.rawText == rawText }) else { return }
        let existing = recentTranscriptions[index]
        recentTranscriptions[index] = TranscriptionResult(
            rawText: existing.rawText,
            processedText: processedText,
            timestamp: existing.timestamp,
            projectId: existing.projectId,
            projectName: existing.projectName
        )
    }

    private func writeCapturedWAV(to path: String) -> Bool {
        guard !recordedPCM.isEmpty else { return false }
        do {
            try Self.writeWAV(
                pcmData: recordedPCM,
                sampleRate: 24_000,
                channelCount: 1,
                bitsPerSample: 16,
                to: URL(fileURLWithPath: path)
            )
            log("wrote wav path=\(path) pcmBytes=\(recordedPCM.count)")
            return true
        } catch {
            log("failed to save wav error=\(error.localizedDescription)")
            statusMessage = "Failed to save audio"
            return false
        }
    }

    private nonisolated static func saveRealtimeTranscript(
        text: String,
        audioPath: String?,
        pcmData: Data,
        durationMs: Int,
        activeProjectId: String?,
        processingConfiguration: RecordingProcessingConfiguration,
        language: String,
        recordingId: String,
        homePath: String,
        pipelineTrace: RecordingPipelineTrace
    ) async -> RealtimeFastPathSaveResult {
        await Task.detached(priority: .utility) {
            do {
                var savedAudioPath: String?
                if let audioPath, !pcmData.isEmpty {
                    NativeAppLog.write(
                        pipelineTrace.message(stage: "wav_write_started", detail: "pcm_bytes=\(pcmData.count)"),
                        homePath: homePath
                    )
                    try Self.writeWAV(
                        pcmData: pcmData,
                        sampleRate: 24_000,
                        channelCount: 1,
                        bitsPerSample: 16,
                        to: URL(fileURLWithPath: audioPath)
                    )
                    savedAudioPath = audioPath
                    NativeAppLog.write(
                        pipelineTrace.message(stage: "wav_write_complete", detail: "path=\(audioPath) pcm_bytes=\(pcmData.count)"),
                        homePath: homePath
                    )
                }

                let textFile = try Self.writeTemporaryTranscript(text: text, homePath: homePath)
                defer { try? FileManager.default.removeItem(atPath: textFile) }

                let args = saveTextCLIArgs(
                    textFile: textFile,
                    audioPath: savedAudioPath,
                    activeProjectId: activeProjectId,
                    transcriberPrompt: processingConfiguration.transcriberPrompt,
                    postProcessingMode: processingConfiguration.postProcessingMode,
                    language: language,
                    transcriptionModel: processingConfiguration.transcriptionModel,
                    transcriberModel: processingConfiguration.transcriberModel,
                    enhancementModel: processingConfiguration.enhancementModel,
                    enhanceTriggersJSON: processingConfiguration.enhanceTriggersJSON,
                    keywordTransformsJSON: processingConfiguration.keywordTransformsJSON,
                    recordingId: recordingId,
                    durationMs: durationMs,
                    source: "realtime_fast_path",
                    modelUsed: RealtimeTranscriptionClient.transcriptionModelID
                )
                NativeAppLog.write(
                    pipelineTrace.message(stage: "helper_started", detail: "operation=save_text"),
                    homePath: homePath
                )
                let output = CLIRunner.run(args, home: homePath)
                if let error = CLIRunner.parseError(output) {
                    NativeAppLog.write(
                        pipelineTrace.message(stage: "helper_processing_store_failed", detail: "error=\(NativeErrorSanitizer.sanitize(error))"),
                        homePath: homePath
                    )
                    return RealtimeFastPathSaveResult(text: nil, error: error)
                }

                NativeAppLog.write(
                    pipelineTrace.message(stage: "helper_processing_store_complete"),
                    homePath: homePath
                )
                return RealtimeFastPathSaveResult(text: CLIRunner.parseJSON(output) ?? text, error: nil)
            } catch {
                NativeAppLog.write(
                    pipelineTrace.message(stage: "persistence_failed", detail: "error=\(NativeErrorSanitizer.sanitize(error.localizedDescription))"),
                    homePath: homePath
                )
                return RealtimeFastPathSaveResult(text: nil, error: error.localizedDescription)
            }
        }.value
    }

    private nonisolated static func writeTemporaryTranscript(text: String, homePath: String) throws -> String {
        let dir = URL(fileURLWithPath: homePath)
            .appendingPathComponent(".hasna", isDirectory: true)
            .appendingPathComponent("recordings", isDirectory: true)
            .appendingPathComponent("tmp", isDirectory: true)
        try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        let url = dir.appendingPathComponent("realtime-\(UUID().uuidString).txt")
        try text.write(to: url, atomically: true, encoding: .utf8)
        return url.path
    }

    private nonisolated static func writeWAV(pcmData: Data, sampleRate: UInt32, channelCount: UInt16, bitsPerSample: UInt16, to url: URL) throws {
        let byteRate = sampleRate * UInt32(channelCount) * UInt32(bitsPerSample / 8)
        let blockAlign = channelCount * (bitsPerSample / 8)
        let dataSize = UInt32(pcmData.count)
        let fileSize = UInt32(36) + dataSize

        var wav = Data()
        func appendASCII(_ string: String) {
            wav.append(contentsOf: string.utf8)
        }
        func appendUInt16LE(_ value: UInt16) {
            wav.append(UInt8(value & 0xff))
            wav.append(UInt8((value >> 8) & 0xff))
        }
        func appendUInt32LE(_ value: UInt32) {
            wav.append(UInt8(value & 0xff))
            wav.append(UInt8((value >> 8) & 0xff))
            wav.append(UInt8((value >> 16) & 0xff))
            wav.append(UInt8((value >> 24) & 0xff))
        }

        appendASCII("RIFF")
        appendUInt32LE(fileSize)
        appendASCII("WAVE")
        appendASCII("fmt ")
        appendUInt32LE(16)
        appendUInt16LE(1)
        appendUInt16LE(channelCount)
        appendUInt32LE(sampleRate)
        appendUInt32LE(byteRate)
        appendUInt16LE(blockAlign)
        appendUInt16LE(bitsPerSample)
        appendASCII("data")
        appendUInt32LE(dataSize)
        wav.append(pcmData)

        let dir = url.deletingLastPathComponent()
        try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        try wav.write(to: url, options: .atomic)
    }

    private static func timestampForFilename() -> String {
        let formatter = DateFormatter()
        formatter.dateFormat = "yyyyMMdd-HHmmss-SSS"
        return formatter.string(from: Date())
    }

    // MARK: - Fallback Transcription

    private func recoverAsyncPersistenceFailure(
        error: String,
        audioPath: String?,
        pcmData: Data,
        targetAppBundleIdentifier: String?,
        targetAppPid: pid_t?,
        selectionToken: AccessibilitySelectionToken?,
        canonicalProjectId: String?,
        displayProjectId: String?,
        activeProjectName: String?,
        processingConfiguration: RecordingProcessingConfiguration,
        pipelineTrace: RecordingPipelineTrace,
        pipelineGeneration: UInt64
    ) {
        let sanitizedError = NativeErrorSanitizer.sanitize(error)
        log(pipelineTrace.message(
            stage: "async_persistence_failed",
            detail: "error=\(sanitizedError)"
        ))
        updateBackgroundRecoveryStatus(
            "Pasted; recovering recording...",
            kind: .success,
            pipelineGeneration: pipelineGeneration
        )

        Task.detached {
            let recoveryAudioPath = Self.ensureBackgroundRecoveryAudio(
                audioPath: audioPath,
                pcmData: pcmData
            )

            await MainActor.run {
                guard let recoveryAudioPath else {
                    self.updateBackgroundRecoveryStatus(
                        "Pasted, but recording could not be saved: \(sanitizedError)",
                        kind: .failure,
                        pipelineGeneration: pipelineGeneration
                    )
                    return
                }
                self.fallbackTranscribe(
                    audioPath: recoveryAudioPath,
                    targetAppBundleIdentifier: targetAppBundleIdentifier,
                    targetAppPid: targetAppPid,
                    selectionToken: selectionToken,
                    canonicalProjectId: canonicalProjectId,
                    displayProjectId: displayProjectId,
                    activeProjectName: activeProjectName,
                    processingConfiguration: processingConfiguration,
                    realtimeText: nil,
                    pipelineTrace: pipelineTrace,
                    deliverResult: false,
                    backgroundRecoveryGeneration: pipelineGeneration
                )
            }
        }
    }

    nonisolated static func ensureBackgroundRecoveryAudio(
        audioPath: String?,
        pcmData: Data
    ) -> String? {
        guard let audioPath else { return nil }
        if FileManager.default.fileExists(atPath: audioPath) {
            return audioPath
        }
        guard !pcmData.isEmpty else { return nil }
        do {
            try writeWAV(
                pcmData: pcmData,
                sampleRate: 24_000,
                channelCount: 1,
                bitsPerSample: 16,
                to: URL(fileURLWithPath: audioPath)
            )
            return audioPath
        } catch {
            return nil
        }
    }

    nonisolated static func shouldApplyBackgroundRecoveryStatus(
        recoveryGeneration: UInt64,
        currentGeneration: UInt64,
        isRecording: Bool,
        isTranscribing: Bool
    ) -> Bool {
        recoveryGeneration == currentGeneration && !isRecording && !isTranscribing
    }

    private func updateBackgroundRecoveryStatus(
        _ message: String,
        kind: DeliveryStatusKind,
        pipelineGeneration: UInt64
    ) {
        guard Self.shouldApplyBackgroundRecoveryStatus(
            recoveryGeneration: pipelineGeneration,
            currentGeneration: recordingGeneration,
            isRecording: isRecording,
            isTranscribing: isTranscribing
        ) else {
            log("background recovery status suppressed for superseded pipeline generation=\(pipelineGeneration)")
            return
        }
        statusMessage = message
        flowPhase = Self.flowPhase(forDeliveryStatus: message, kind: kind)
    }

    nonisolated static func fallbackCompletionAction(
        cliText: String?,
        cliError: String?,
        realtimeText: String?,
        deliverResult: Bool
    ) -> FallbackCompletionAction {
        let resolved = resolveFinalTranscript(
            cliText: cliText,
            cliError: cliError,
            realtimeText: realtimeText
        )
        guard let text = resolved.text else {
            let failure = resolved.failureStatus ?? "Transcription failed"
            return deliverResult ? .fail(failure) : .backgroundFailed(failure)
        }
        return deliverResult ? .deliver(text) : .backgroundRecovered
    }

    private func fallbackTranscribe(
        audioPath: String,
        targetAppBundleIdentifier: String?,
        targetAppPid: pid_t?,
        selectionToken: AccessibilitySelectionToken?,
        canonicalProjectId: String?,
        displayProjectId: String?,
        activeProjectName: String?,
        processingConfiguration: RecordingProcessingConfiguration,
        realtimeText: String? = nil,
        pipelineTrace: RecordingPipelineTrace? = nil,
        pipelineGeneration: UInt64? = nil,
        deliverResult: Bool = true,
        backgroundRecoveryGeneration: UInt64? = nil
    ) {
        let homePath = home

        if deliverResult {
            isTranscribing = true
            statusMessage = Self.shouldLabelRewriting(
                postProcessingMode: processingConfiguration.postProcessingMode
            ) ? "Rewriting..." : "Transcribing..."
            flowPhase = .processing(statusMessage)
        } else {
            if let backgroundRecoveryGeneration {
                updateBackgroundRecoveryStatus(
                    "Pasted; recovering recording...",
                    kind: .success,
                    pipelineGeneration: backgroundRecoveryGeneration
                )
            }
        }

        // Only a proven canonical Store id may be persisted. The local display id remains
        // available to recent-transcript UI even when synchronization is degraded.
        let transcribeArgs = Self.transcribeCLIArgs(
            audioPath: audioPath,
            activeProjectId: canonicalProjectId,
            transcriberPrompt: processingConfiguration.transcriberPrompt,
            postProcessingMode: processingConfiguration.postProcessingMode,
            language: processingConfiguration.transcriptionLanguage,
            transcriptionPrompt: processingConfiguration.transcriptionPrompt,
            transcriptionModel: processingConfiguration.transcriptionModel,
            transcriberModel: processingConfiguration.transcriberModel,
            enhancementModel: processingConfiguration.enhancementModel,
            enhanceTriggersJSON: processingConfiguration.enhanceTriggersJSON,
            keywordTransformsJSON: processingConfiguration.keywordTransformsJSON,
            recordingId: pipelineTrace?.id
        )

        Task.detached {
            if let pipelineTrace {
                NativeAppLog.write(
                    pipelineTrace.message(stage: "helper_started", detail: "operation=batch_transcribe"),
                    homePath: homePath
                )
            }
            let output = CLIRunner.run(transcribeArgs, home: homePath)
            let cliError = CLIRunner.parseError(output)
            let cliText = cliError == nil ? CLIRunner.parseJSON(output) : nil
            let cliRawText = cliError == nil ? CLIRunner.parseRawTranscript(output) : nil

            await MainActor.run {
                if let pipelineTrace {
                    self.log(pipelineTrace.message(
                        stage: cliError == nil ? "helper_processing_store_complete" : "helper_processing_store_failed"
                    ))
                }
                if let cliError {
                    self.log("cli transcription failed error=\(cliError)")
                } else if cliText == nil {
                    self.log("cli transcription empty output=\(output.prefix(160))")
                }

                if cliText == nil {
                    self.log("using realtime transcript fallback chars=\(realtimeText?.count ?? 0)")
                } else {
                    self.log("cli transcription succeeded chars=\(cliText?.count ?? 0)")
                }
                self.recordPersistenceCompletion(savedText: cliError == nil ? cliText : nil)
                switch Self.fallbackCompletionAction(
                    cliText: cliText,
                    cliError: cliError,
                    realtimeText: realtimeText,
                    deliverResult: deliverResult
                ) {
                case .deliver(let text):
                    self.isTranscribing = false
                    self.finishWithText(
                        text,
                        rawTranscript: cliRawText ?? realtimeText ?? text,
                        targetAppBundleIdentifier: targetAppBundleIdentifier,
                        targetAppPid: targetAppPid,
                        selectionToken: selectionToken,
                        canonicalProjectId: canonicalProjectId,
                        activeProjectId: displayProjectId,
                        activeProjectName: activeProjectName,
                        processingConfiguration: processingConfiguration,
                        pipelineTrace: pipelineTrace,
                        pipelineGeneration: pipelineGeneration
                    )
                case .fail(let failure):
                    if let pipelineGeneration {
                        self.pipelineDeliveryGate.abandonPipeline(pipelineGeneration)
                    }
                    self.finish(failure)
                case .backgroundRecovered:
                    if let pipelineTrace {
                        self.log(pipelineTrace.message(stage: "async_persistence_recovered"))
                    }
                    if let backgroundRecoveryGeneration {
                        self.updateBackgroundRecoveryStatus(
                            "Pasted and saved",
                            kind: .success,
                            pipelineGeneration: backgroundRecoveryGeneration
                        )
                    }
                case .backgroundFailed(let failure):
                    if let backgroundRecoveryGeneration {
                        self.updateBackgroundRecoveryStatus(
                            "Pasted, but recording could not be saved: \(failure)",
                            kind: .failure,
                            pipelineGeneration: backgroundRecoveryGeneration
                        )
                    }
                }
            }
        }
    }

    private func mostRecentAudioFile() -> String? {
        let files = (try? FileManager.default.contentsOfDirectory(atPath: audioDir)) ?? []
        let wavFiles = files.filter { $0.hasSuffix(".wav") }.sorted().reversed()
        return wavFiles.first.map { "\(audioDir)/\($0)" }
    }

    nonisolated static func transcribeCLIArgs(
        audioPath: String,
        activeProjectId: String?,
        transcriberPrompt: String,
        postProcessingMode: String,
        language: String = "auto",
        transcriptionPrompt: String? = nil,
        transcriptionModel: String? = nil,
        transcriberModel: String? = nil,
        enhancementModel: String? = nil,
        enhanceTriggersJSON: String? = nil,
        keywordTransformsJSON: String? = nil,
        recordingId: String? = nil
    ) -> [String] {
        var args = ["--json"]
        if let activeProjectId, !activeProjectId.isEmpty {
            args += ["--project", activeProjectId]
        }
        args += ["transcribe", audioPath]

        let languageHint = OpenAIAPIKeyStore.apiLanguageHint(for: language)
        if !languageHint.isEmpty {
            args += ["--language", languageHint]
        }
        if let recordingId, !recordingId.isEmpty {
            args += ["--recording-id", recordingId]
        }
        if let transcriptionPrompt, !transcriptionPrompt.isEmpty {
            args += ["--prompt", transcriptionPrompt]
        }
        if let transcriptionModel, !transcriptionModel.isEmpty {
            args += ["--transcription-model", transcriptionModel]
        }
        if let transcriberModel, !transcriberModel.isEmpty {
            args += ["--transcriber-model", transcriberModel]
        }
        if let enhancementModel, !enhancementModel.isEmpty {
            args += ["--enhancement-model", enhancementModel]
        }
        if let enhanceTriggersJSON, !enhanceTriggersJSON.isEmpty {
            args += ["--enhance-triggers-json", enhanceTriggersJSON]
        }
        if let keywordTransformsJSON, !keywordTransformsJSON.isEmpty {
            args += ["--keyword-transforms-json", keywordTransformsJSON]
        }

        let mode = PostProcessingMode(rawValue: postProcessingMode)?.rawValue ?? PostProcessingMode.auto.rawValue
        args += ["--post-processing", mode]

        let prompt = transcriberPrompt.trimmingCharacters(in: .whitespacesAndNewlines)
        if !prompt.isEmpty {
            args += ["--transcriber-prompt", prompt]
        }

        return args
    }

    nonisolated static func saveTextCLIArgs(
        textFile: String,
        audioPath: String?,
        activeProjectId: String?,
        transcriberPrompt: String,
        postProcessingMode: String,
        language: String,
        transcriptionModel: String? = nil,
        transcriberModel: String? = nil,
        enhancementModel: String? = nil,
        enhanceTriggersJSON: String? = nil,
        keywordTransformsJSON: String? = nil,
        recordingId: String? = nil,
        durationMs: Int,
        source: String,
        modelUsed: String
    ) -> [String] {
        var args = ["--json"]
        if let activeProjectId, !activeProjectId.isEmpty {
            args += ["--project", activeProjectId]
        }
        args += [
            "save-text",
            "--text-file", textFile,
            "--source", source,
            "--model-used", modelUsed,
            "--post-processing", PostProcessingMode(rawValue: postProcessingMode)?.rawValue ?? PostProcessingMode.auto.rawValue,
        ]
        if let audioPath, !audioPath.isEmpty {
            args += ["--audio-path", audioPath]
        }
        if durationMs > 0 {
            args += ["--duration-ms", String(durationMs)]
        }
        if !language.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            args += ["--language", language]
        }
        if let recordingId, !recordingId.isEmpty {
            args += ["--recording-id", recordingId]
        }
        if let transcriptionModel, !transcriptionModel.isEmpty {
            args += ["--transcription-model", transcriptionModel]
        }
        if let transcriberModel, !transcriberModel.isEmpty {
            args += ["--transcriber-model", transcriberModel]
        }
        if let enhancementModel, !enhancementModel.isEmpty {
            args += ["--enhancement-model", enhancementModel]
        }
        if let enhanceTriggersJSON, !enhanceTriggersJSON.isEmpty {
            args += ["--enhance-triggers-json", enhanceTriggersJSON]
        }
        if let keywordTransformsJSON, !keywordTransformsJSON.isEmpty {
            args += ["--keyword-transforms-json", keywordTransformsJSON]
        }
        let prompt = transcriberPrompt.trimmingCharacters(in: .whitespacesAndNewlines)
        if !prompt.isEmpty {
            args += ["--transcriber-prompt", prompt]
        }
        return args
    }

    nonisolated static func rewriteCLIArgs(
        selectedText: String,
        instruction: String,
        activeProjectId: String?,
        processingConfiguration: RecordingProcessingConfiguration
    ) -> [String] {
        var args: [String] = []
        if let activeProjectId, !activeProjectId.isEmpty {
            args += ["--project", activeProjectId]
        }
        args += [
            "rewrite",
            "--instruction", instruction,
            "--post-processing", processingConfiguration.postProcessingMode,
            "--language", processingConfiguration.transcriptionLanguage,
            "--prompt", processingConfiguration.transcriptionPrompt,
            "--transcriber-prompt", processingConfiguration.transcriberPrompt,
            "--transcription-model", processingConfiguration.transcriptionModel,
            "--transcriber-model", processingConfiguration.transcriberModel,
            "--enhancement-model", processingConfiguration.enhancementModel,
            "--enhance-triggers-json", processingConfiguration.enhanceTriggersJSON,
            "--keyword-transforms-json", processingConfiguration.keywordTransformsJSON,
            "--", selectedText,
        ]
        return args
    }

    private func finish(_ msg: String) {
        log("finish status=\(msg)")
        isTranscribing = false
        liveTranscriptionText = ""
        statusMessage = msg
        flowPhase = .failed(msg)
    }

    private func resetRecordingIntent() {
        activeTrigger = nil
        microphonePermissionStartGate.cancel()
        keyboardShortcutIsDown = false
        fnKeyIsDown = false
        targetAppBundleIdentifier = nil
        targetAppPid = nil
    }

    // MARK: - Conversation

    private func runConversationMode(
        question: String,
        processingConfiguration: RecordingProcessingConfiguration,
        pipelineTrace: RecordingPipelineTrace?,
        pipelineGeneration: UInt64?,
        deliveryCompleted: (@MainActor @Sendable () -> Void)?
    ) {
        let deliveryGeneration = pipelineGeneration ?? recordingGeneration
        beginIntentDelivery(for: deliveryGeneration)
        updateDeliveryStatus("Answering...", kind: .progress, pipelineGeneration: pipelineGeneration)
        if let pipelineTrace { log(pipelineTrace.message(stage: "conversation_started")) }
        let classifier = intentClassifier
        let model = processingConfiguration.intentModel
        Task { [weak self] in
            let outcome = await classifier.answer(question: question, model: model)
            guard let self else {
                deliveryCompleted?()
                return
            }
            self.endIntentDelivery(for: deliveryGeneration)
            if let pipelineTrace { self.log(pipelineTrace.message(stage: "conversation_complete")) }
            // The conversation route never touches the clipboard: the reply card has an
            // explicit Copy affordance, and clobbering whatever the user had copied would be
            // an irreversible side effect of a possibly-misclassified recording.
            switch outcome {
            case .answer(let answer):
                if Self.shouldApplyConversationReply(
                    replyGeneration: pipelineGeneration,
                    currentGeneration: self.recordingGeneration,
                    isRecording: self.isRecording
                ) {
                    self.conversationReply = ConversationReply(question: question, answer: answer)
                    self.updateDeliveryStatus("Answered", kind: .success, pipelineGeneration: pipelineGeneration)
                } else {
                    self.log("stale conversation reply dropped pipeline_generation=\(pipelineGeneration.map(String.init) ?? "nil")")
                }
            case .unavailable(let message):
                // The delayed answer failed; never auto-paste this late. Fail closed to the
                // preview path: the transcript is persisted and stays in Recent.
                self.log("conversation unavailable: \(message)")
                self.updateDeliveryStatus(
                    "Couldn't answer — transcript saved to Recent",
                    kind: .failure,
                    pipelineGeneration: pipelineGeneration
                )
            }
            deliveryCompleted?()
        }
    }

    nonisolated static func shouldApplyConversationReply(
        replyGeneration: UInt64?,
        currentGeneration: UInt64,
        isRecording: Bool
    ) -> Bool {
        guard !isRecording else { return false }
        // No generation means the reply cannot be proven current — fail closed.
        guard let replyGeneration else { return false }
        return replyGeneration == currentGeneration
    }

    // MARK: - Command Mode

    private func runCommandMode(
        instruction: String,
        targetAppBundleIdentifier: String?,
        targetAppPid: pid_t?,
        selectionToken: AccessibilitySelectionToken?,
        canonicalProjectId: String?,
        processingConfiguration: RecordingProcessingConfiguration,
        pipelineTrace: RecordingPipelineTrace?,
        pipelineGeneration: UInt64?,
        deliveryCompleted: (@MainActor @Sendable () -> Void)?
    ) {
        let deliveryGeneration = pipelineGeneration ?? recordingGeneration
        beginIntentDelivery(for: deliveryGeneration)
        let finishCommandDelivery: @MainActor @Sendable () -> Void = { [weak self] in
            self?.endIntentDelivery(for: deliveryGeneration)
            deliveryCompleted?()
        }
        guard protectedOperationTrust().trusted else {
            log("command mode blocked by accessibility permission")
            updateDeliveryStatus(
                "Enable Accessibility permission for Recordings to rewrite selected text",
                kind: .failure,
                pipelineGeneration: pipelineGeneration
            )
            finishCommandDelivery()
            return
        }

        let homePath = home
        let resolveTarget = rewriteSelectionResolver
        Task { @MainActor in
            let resolution = await resolveTarget(
                targetAppBundleIdentifier,
                targetAppPid,
                selectionToken,
                pipelineGeneration
            )
            let selected: String
            switch resolution {
            case .targetAppMissing:
                self.log("command mode target app not found")
                self.updateDeliveryStatus("No target app found", kind: .failure, pipelineGeneration: pipelineGeneration)
                finishCommandDelivery()
                return
            case .selectionUnavailable:
                self.updateDeliveryStatus("No text selected", kind: .failure, pipelineGeneration: pipelineGeneration)
                finishCommandDelivery()
                return
            case .selection(let validated):
                selected = validated
            }
            // A cancellation (or newer recording) during target resolution makes the whole
            // rewrite stale — never spawn the CLI for a delivery that can only be abandoned.
            guard !Self.shouldAbandonDelivery(
                pipelineGeneration: pipelineGeneration,
                currentGeneration: self.recordingGeneration,
                isRecording: self.isRecording
            ) else {
                self.log("stale rewrite abandoned before CLI pipeline_generation=\(pipelineGeneration.map(String.init) ?? "nil")")
                finishCommandDelivery()
                return
            }
            if self.canOwnBusyState(pipelineGeneration: pipelineGeneration) {
                self.statusMessage = "Rewriting..."
                self.flowPhase = .processing("Rewriting...")
                self.isTranscribing = true
            }

            let rewriteArguments = Self.rewriteCLIArgs(
                selectedText: selected,
                instruction: instruction,
                activeProjectId: canonicalProjectId,
                processingConfiguration: processingConfiguration
            )
            let rewriteOperation = Self.makeCommandRewriteOperation(
                args: rewriteArguments,
                home: homePath,
                runCLI: self.commandCLI
            )
            let result = await BlockingOperation.run(rewriteOperation)
            if self.canOwnBusyState(pipelineGeneration: pipelineGeneration) {
                self.isTranscribing = false
                self.liveTranscriptionText = ""
            }
            // A rewrite finishing after the user cancelled (or after a newer recording
            // superseded it) must never paste, even if the frozen selection still matches.
            guard !Self.shouldAbandonDelivery(
                pipelineGeneration: pipelineGeneration,
                currentGeneration: self.recordingGeneration,
                isRecording: self.isRecording
            ) else {
                self.log("stale rewrite abandoned pipeline_generation=\(pipelineGeneration.map(String.init) ?? "nil")")
                finishCommandDelivery()
                return
            }
            if CLIRunner.parseError(result) == nil, !result.isEmpty {
                self.pasteIntoFrontApp(
                    result,
                    targetAppBundleIdentifier: targetAppBundleIdentifier,
                    targetAppPid: targetAppPid,
                    restoreClipboard: true,
                    deliveryKind: .commandRewrite,
                    selectionToken: selectionToken,
                    pipelineTrace: pipelineTrace,
                    pipelineGeneration: pipelineGeneration,
                    deliveryCompleted: finishCommandDelivery
                )
            } else {
                self.updateDeliveryStatus(
                    CLIRunner.parseError(result) ?? "Rewrite failed",
                    kind: .failure,
                    pipelineGeneration: pipelineGeneration
                )
                finishCommandDelivery()
            }
        }
    }

    /// Production body of `rewriteSelectionResolver`: real NSWorkspace/AX I/O. The frozen
    /// target app is re-found and activated, focus settles, and the frozen selection is
    /// revalidated element-for-element before any rewrite may run.
    private func resolveRewriteSelection(
        targetAppBundleIdentifier: String?,
        targetAppPid: pid_t?,
        selectionToken: AccessibilitySelectionToken?,
        pipelineGeneration: UInt64?
    ) async -> RewriteTargetResolution {
        let requiredProcessIdentity = pipelineGeneration.flatMap {
            pasteTargetProcessIdentityByGeneration[$0]
        }
        let targetApp = selectedRunningPasteTarget(
            targetAppBundleIdentifier: targetAppBundleIdentifier,
            targetAppPid: targetAppPid,
            frontmostPid: NSWorkspace.shared.frontmostApplication?.processIdentifier,
            pipelineGeneration: pipelineGeneration
        )
        guard let targetApp else {
            return .targetAppMissing
        }
        let alreadyFrontmost = targetApp.processIdentifier == NSWorkspace.shared.frontmostApplication?.processIdentifier
        if !alreadyFrontmost {
            targetApp.activate()
        }

        let focusDelay: TimeInterval = alreadyFrontmost ? 0.05 : 0.35
        try? await Task.sleep(for: .milliseconds(Int(focusDelay * 1_000)))
        let frontmostBeforeRead = NSWorkspace.shared.frontmostApplication
        guard Self.pasteTargetIsReady(
            expectedPid: targetApp.processIdentifier,
            expectedBundleIdentifier: targetApp.bundleIdentifier,
            frontmostPid: frontmostBeforeRead?.processIdentifier,
            frontmostBundleIdentifier: frontmostBeforeRead?.bundleIdentifier,
            accessibilityTrusted: AXIsProcessTrusted(),
            expectedLaunchDate: requiredProcessIdentity?.launchDate,
            frontmostLaunchDate: frontmostBeforeRead?.launchDate,
            requiresProcessIdentity: pipelineGeneration != nil && targetAppPid != nil
        ) else {
            return .selectionUnavailable
        }
        let frontmostAfterRead = NSWorkspace.shared.frontmostApplication
        let selected = Self.validAccessibilitySelection(
            selectionToken?.selectedText,
            targetStillFrontmost: Self.pasteTargetIsReady(
                expectedPid: targetApp.processIdentifier,
                expectedBundleIdentifier: targetApp.bundleIdentifier,
                frontmostPid: frontmostAfterRead?.processIdentifier,
                frontmostBundleIdentifier: frontmostAfterRead?.bundleIdentifier,
                accessibilityTrusted: AXIsProcessTrusted(),
                expectedLaunchDate: requiredProcessIdentity?.launchDate,
                frontmostLaunchDate: frontmostAfterRead?.launchDate,
                requiresProcessIdentity: pipelineGeneration != nil && targetAppPid != nil
            )
        )
        guard let selected,
              selectionToken?.matchesCurrentSelection(
                for: targetApp.processIdentifier
              ) == true else {
            return .selectionUnavailable
        }
        return .selection(selected)
    }

    nonisolated static func validAccessibilitySelection(
        _ candidate: String?,
        targetStillFrontmost: Bool
    ) -> String? {
        let text = candidate ?? ""
        guard targetStillFrontmost,
              !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else { return nil }
        return text
    }

    private func canOwnBusyState(pipelineGeneration: UInt64?) -> Bool {
        guard let pipelineGeneration else { return true }
        return pipelineGeneration == recordingGeneration && !isRecording
    }

    // MARK: - Window Title (Accessibility API)

    /// Runs off the MainActor in the recording-start snapshot; every IPC round trip is
    /// bounded so an unresponsive app delays project detection, never recording.
    private nonisolated static func focusedWindowTitle(pid: pid_t?) -> String? {
        guard let pid else { return nil }
        let app = AXUIElementCreateApplication(pid)
        AXUIElementSetMessagingTimeout(app, AccessibilitySelectionToken.captureMessagingTimeout)
        var windowRef: CFTypeRef?
        guard AXUIElementCopyAttributeValue(app, kAXFocusedWindowAttribute as CFString, &windowRef) == .success,
              let window = windowRef,
              CFGetTypeID(window) == AXUIElementGetTypeID() else { return nil }
        let windowElement = window as! AXUIElement
        AXUIElementSetMessagingTimeout(windowElement, AccessibilitySelectionToken.captureMessagingTimeout)
        var titleRef: CFTypeRef?
        guard AXUIElementCopyAttributeValue(windowElement, kAXTitleAttribute as CFString, &titleRef) == .success,
              let title = titleRef as? String else { return nil }
        return title
    }

    // MARK: - Paste

    /// Copies text without pasting, preserving the previous clipboard if the write fails.
    /// Used by explicit "Copy" affordances in the UI.
    @discardableResult
    public func copyToClipboard(_ text: String) -> Bool {
        Self.writeClipboardPreservingOnFailure(text, to: .general)
    }

    public func pasteIntoFrontApp(
        _ text: String,
        targetAppBundleIdentifier: String? = nil,
        targetAppPid: pid_t? = nil,
        restoreClipboard: Bool = false,
        captureID: String? = nil
    ) {
        pasteIntoFrontApp(
            text,
            targetAppBundleIdentifier: targetAppBundleIdentifier,
            targetAppPid: targetAppPid,
            restoreClipboard: restoreClipboard,
            deliveryKind: .manualPaste,
            captureID: captureID,
            pipelineTrace: nil,
            pipelineGeneration: nil,
            deliveryCompleted: nil
        )
    }

    private func pasteIntoFrontApp(
        _ text: String,
        targetAppBundleIdentifier: String? = nil,
        targetAppPid: pid_t? = nil,
        restoreClipboard: Bool = false,
        deliveryKind: PasteDeliveryKind,
        captureID: String? = nil,
        selectionToken: AccessibilitySelectionToken? = nil,
        pipelineTrace: RecordingPipelineTrace?,
        pipelineGeneration: UInt64?,
        deliveryCompleted: (@MainActor @Sendable () -> Void)?
    ) {
        if let pipelineTrace { log(pipelineTrace.message(stage: "paste_requested", detail: "chars=\(text.count)")) }
        log("paste requested chars=\(text.count) target=\(targetAppBundleIdentifier ?? "nil") pid=\(targetAppPid.map(String.init) ?? "nil") accessibility=\(accessibilityTrustCheck())")
        // A paste bound to a superseded generation (a cancelled or replaced recording) is
        // abandoned before it can touch the clipboard or the target app.
        if Self.shouldAbandonDelivery(
            pipelineGeneration: pipelineGeneration,
            currentGeneration: recordingGeneration,
            isRecording: isRecording
        ) {
            log("paste abandoned for superseded recording pipeline_generation=\(pipelineGeneration.map(String.init) ?? "nil")")
            deliveryCompleted?()
            return
        }
        if !autoPasteEnabled && deliveryKind != .manualPaste {
            updateDeliveryStatus("Transcript ready — auto-paste is off", kind: .success, pipelineGeneration: pipelineGeneration)
            deliveryCompleted?()
            return
        }
        if let pasteInterceptorForTesting {
            pasteInterceptorForTesting(text, deliveryKind, pipelineGeneration)
            deliveryCompleted?()
            return
        }
        if let generation = pipelineGeneration, frozenPasteTargetsByGeneration[generation] != nil,
           pasteTargetProcessIdentityByGeneration[generation] == nil {
            completeUnavailablePaste(text, deliveryKind: deliveryKind, captureID: captureID,
                                     pipelineGeneration: pipelineGeneration)
            deliveryCompleted?()
            return
        }
        var previousClipboard: ClipboardSnapshot?

        let accessibility = protectedOperationTrust()
        guard accessibility.trusted else {
            let shouldCopy = Self.shouldCopyPasteFallback(deliveryKind: deliveryKind)
            let copied = shouldCopy && pasteFallbackWriter(text)
            appendUndeliveredPaste(text: text, copied: copied, captureID: captureID,
                                   pipelineGeneration: pipelineGeneration, fallbackBundle: targetAppBundleIdentifier)
            log("paste blocked by accessibility permission")
            let message = if deliveryKind == .commandRewrite {
                "Paste cancelled because Accessibility permission changed"
            } else if !copied {
                "Transcription ready, but the clipboard could not be updated"
            } else if accessibility.didPrompt {
                "Copied — approve Accessibility for this Recordings app"
            } else {
                "Copied — waiting for Accessibility approval"
            }
            updateDeliveryStatus(message, kind: .failure, pipelineGeneration: pipelineGeneration)
            deliveryCompleted?()
            return
        }

        let frontmostPid = NSWorkspace.shared.frontmostApplication?.processIdentifier
        let requiredProcessIdentity = pipelineGeneration.flatMap {
            pasteTargetProcessIdentityByGeneration[$0]
        }
        let targetApp = selectedRunningPasteTarget(
            targetAppBundleIdentifier: targetAppBundleIdentifier,
            targetAppPid: targetAppPid,
            frontmostPid: frontmostPid,
            pipelineGeneration: pipelineGeneration
        )

        guard let app = targetApp else {
            completeUnavailablePaste(text, deliveryKind: deliveryKind, captureID: captureID,
                                     pipelineGeneration: pipelineGeneration, fallbackBundle: targetAppBundleIdentifier)
            deliveryCompleted?()
            return
        }

        // Freeze the selected process before activation; polling must not select a replacement
        // process or a different foreground app while the system processes the request.
        let alreadyFrontmost = app.processIdentifier == frontmostPid
        let expectedApp = PasteApplicationObservation(
            pid: requiredProcessIdentity?.pid ?? app.processIdentifier,
            bundleIdentifier: requiredProcessIdentity?.bundleIdentifier ?? app.bundleIdentifier,
            launchDate: requiredProcessIdentity?.launchDate ?? app.launchDate,
            isRegular: app.activationPolicy == .regular
        )
        let activation = PasteActivation(
            request: {
                PasteActivation.requestOnce(
                    recorderIsActive: NSApp?.isActive == true
                        && NSWorkspace.shared.frontmostApplication?.processIdentifier == ProcessInfo.processInfo.processIdentifier,
                    yield: { NSApp?.yieldActivation(to: app) },
                    activate: { cooperative in
                        cooperative ? app.activate(from: .current, options: []) : app.activate(options: [])
                    }
                )
            },
            readiness: {
                PasteActivation.readiness(
                    expected: expectedApp,
                    live: NSRunningApplication(processIdentifier: expectedApp.pid).map(PasteApplicationObservation.init),
                    frontmost: NSWorkspace.shared.frontmostApplication.map(PasteApplicationObservation.init),
                    accessibilityTrusted: AXIsProcessTrusted(),
                    cancelled: Self.shouldAbandonDelivery(
                        pipelineGeneration: pipelineGeneration,
                        currentGeneration: self.recordingGeneration,
                        isRecording: self.isRecording
                    ),
                    requiresProcessIdentity: pipelineGeneration != nil && targetAppPid != nil
                )
            },
            report: { self.log($0.logLine) }
        )
        var ownedPasteboardChangeCount: Int?
        var clipboardWrite: PasteboardWriteResult?
        var clipboardOwnershipWasLost = false
        // Focused field of the target app as it read immediately before the keystroke. The
        // read-back after the keystroke is compared against this and against nothing else.
        var deliveryProbe: FocusedTextProbe?
        // What the read-back proved, and how many reads it took. Both stay at their initial
        // values when the paste failed before the keystroke, so the log reports "no read-back"
        // rather than borrowing a verdict from a previous paste.
        var deliveryEvidence: PasteDeliveryEvidence = .unverified(.readBackNotAttempted)
        var readBackAttempts = 0
        lastPasteSecureInputProbe = nil
        updateDeliveryStatus("Pasting...", kind: .progress, pipelineGeneration: pipelineGeneration)
        let accepted = pasteTransactionCoordinator.submit(
            text: text,
            generation: pipelineGeneration,
            delay: 0,
            settlementDelay: restoreClipboard ? 0.6 : 0,
            activation: activation,
            targetIsReady: {
                guard activation.readiness() == .ready else { return false }
                return selectionToken?.matchesCurrentSelection(for: app.processIdentifier) ?? true
            },
            payloadIsReady: {
                guard let ownedPasteboardChangeCount else { return false }
                return Self.clipboardStillOwned(
                    NSPasteboard.general,
                    text: text,
                    changeCount: ownedPasteboardChangeCount
                )
            },
            prepare: {
                if restoreClipboard {
                    previousClipboard = ClipboardSnapshot(pasteboard: .general)
                }
                // Captured before the clipboard write rather than immediately before the
                // keystroke: the readiness checks that follow re-validate focus anyway, and
                // two Accessibility round trips must not sit between the payload check and
                // the keystroke. A focus move in the gap is caught by the read-back, which
                // refuses to compare across a changed element.
                deliveryProbe = FocusedTextProbe.capture(pid: app.processIdentifier)
            },
            writeAttempted: { result in
                ownedPasteboardChangeCount = result.ownershipChangeCount
                clipboardWrite = result
            },
            verify: {
                guard let deliveryProbe else { return .unverified(.readBackNotAttempted) }
                readBackAttempts += 1
                let evidence = PasteDeliveryVerifier.classify(
                    pastedText: text,
                    baseline: deliveryProbe.baseline,
                    readBack: deliveryProbe.readBack()
                )
                deliveryEvidence = evidence
                return evidence
            },
            verificationDelay: Self.pasteReadBackInterval,
            verificationAttempts: Self.pasteReadBackAttempts
        ) { transaction, outcome in
            // A cancelled generation must not copy a fallback payload after its readiness
            // wait was abandoned. Ownership-checked settlement still runs unchanged.
            if PasteActivation.abandonsFallback(
                outcome: outcome,
                generation: transaction.generation,
                currentGeneration: self.recordingGeneration,
                isRecording: self.isRecording
            ) {
                self.log("paste abandoned during activation or preparation reason=cancelled")
                deliveryCompleted?()
                return
            }
            let accessibilityTrusted = AXIsProcessTrusted()
            // Same reason the two static predicates below switch instead of comparing: a `==`
            // test answers `false` for any outcome added later, and this feeds
            // `shouldCopyAfterPasteFailure`, which decides whether the transcript is re-copied.
            let completedTranscriptAlreadyOnClipboard = Self.outcomeLeavesTranscriptOnClipboard(outcome)
                && !restoreClipboard
                && (ownedPasteboardChangeCount.map {
                    Self.clipboardStillOwned(.general, text: transaction.text, changeCount: $0)
                } ?? false)
            let shouldCopyAfterFailure = Self.shouldCopyAfterPasteFailure(
                outcome: outcome,
                deliveryKind: deliveryKind,
                accessibilityTrusted: accessibilityTrusted,
                clipboardOwnershipWasLost: clipboardOwnershipWasLost,
                completedTranscriptAlreadyOnClipboard: completedTranscriptAlreadyOnClipboard
            )
            let copiedAfterFailure = shouldCopyAfterFailure
                && Self.writeClipboardPreservingOnFailure(transaction.text, to: .general)
            self.log("paste outcome=\(outcome) target=\(app.bundleIdentifier ?? "?") alreadyFrontmost=\(alreadyFrontmost) transaction=\(transaction.id)")
            // The line to read when asking "did the text land?". Every step reports itself, so
            // a posted keystroke can no longer stand in for delivery.
            self.log(PasteDeliveryReport(
                targetBundleIdentifier: app.bundleIdentifier,
                characterCount: transaction.text.count,
                clipboardWriteVerified: clipboardWrite?.verified ?? false,
                clipboardChangeCountAdvanced: clipboardWrite?.changeCountAdvanced ?? false,
                attempt: .forOutcome(outcome),
                secureInput: self.lastPasteSecureInputProbe,
                evidence: deliveryEvidence,
                readBackAttempts: readBackAttempts
            ).logLine)
            if let pipelineTrace {
                self.log(pipelineTrace.message(
                    stage: Self.pasteTraceStage(for: outcome),
                    detail: "chars=\(transaction.text.count)"
                ))
            }
            let verified = Self.pasteTraceStage(for: outcome) == "paste_delivery_confirmed"
            let deliveryStatus = Self.recentPasteDeliveryStatus(for: outcome)
            self.recentPastes.insert(RecentPaste(
                text: transaction.text, bundleIdentifier: app.bundleIdentifier, appName: app.localizedName ?? "Application",
                location: "Focused field", status: verified ? "Pasted" : "Unconfirmed", verified: verified,
                captureID: captureID, deliveryStatus: deliveryStatus
            ), at: 0)
            if self.recentPastes.count > 50 { self.recentPastes.removeLast() }
            deliveryCompleted?()
            let message = switch outcome {
            case .pasted: "Pasted (\(transaction.text.count) chars)"
            case .deliveryNotObserved: restoreClipboard
                ? "Paste did not reach the target app"
                : "Paste did not reach the target app — text kept on the clipboard"
            case .deliveredUnverified: restoreClipboard
                ? "Paste sent, delivery unconfirmed"
                : "Paste sent, delivery unconfirmed — text kept on the clipboard"
            // One message either way, because the clipboard is kept either way — see the
            // `shouldRestore` switch in `settlement`. Telling the owner to press Cmd-V is only
            // honest if the transcript is still there, so this branch may not depend on
            // `restoreClipboard`. When restore WAS requested, say that it was overridden
            // rather than letting the owner discover it.
            case .secureInputActive: restoreClipboard
                ? "This field blocks typing (secure input) — transcript kept on the clipboard "
                    + "instead of restoring it, press Cmd-V"
                : "This field blocks typing (secure input) — transcript copied, press Cmd-V"
            case .targetUnavailable: Self.targetUnavailableDeliveryStatus(
                deliveryKind: deliveryKind,
                accessibilityTrusted: accessibilityTrusted,
                clipboardOwnershipWasLost: clipboardOwnershipWasLost,
                completedTranscriptAlreadyOnClipboard: completedTranscriptAlreadyOnClipboard,
                fallbackWriteRequested: shouldCopyAfterFailure,
                fallbackWriteSucceeded: copiedAfterFailure
            )
            case .clipboardOwnershipLost: "Paste cancelled because the clipboard changed"
            case .clipboardWriteFailed: "Paste failed because the clipboard could not be updated"
            case .eventPostFailed: restoreClipboard
                ? "Paste failed because the paste event could not be posted"
                : "Copied, but paste event could not be posted"
            }
            // `updateDeliveryStatus` writes `statusMessage`, and `updateStatus()` rewrites it to
            // "Ready" on the next return to idle. A transient success line can afford that;
            // "press Cmd-V" cannot, because it is the only thing telling the owner their
            // transcript is recoverable. So the secure-input reason is persisted through the
            // one field every surface reads.
            //
            // ONLY this outcome persists, deliberately. `.deliveryNotObserved` also leaves the
            // transcript on the clipboard, but it has a documented false negative — pasting text
            // identical to the selection it replaces reads as "unchanged" — so persisting it
            // would raise a standing warning over a paste that worked. `.deliveredUnverified`
            // means "could not tell", and a standing blocked banner would over-claim it. Secure
            // input has no such path: it is measured from the window-session dictionary, and an
            // uninterrogable session yields `.unknown`, which never reaches here.
            // AFTER `updateDeliveryStatus`, not before: that call clears the delivery reason so
            // statuses which produce no outcome cannot leave a stale one behind, and this is the
            // one caller whose reason has to outlive its own status line.
            self.updateDeliveryStatus(
                message,
                kind: Self.deliveryStatusKind(for: outcome),
                pipelineGeneration: transaction.generation
            )
            // Stamped with the delivery's OWN generation, not the engine's current one: this
            // closure can run after `recordingGeneration` has advanced, and binding to the
            // current value would mark a superseded reason fresh. `updateStatus()` expires it.
            self.setBlockedReason(
                Self.isSecureInputOutcome(outcome) ? message : nil,
                for: .delivery,
                generation: transaction.generation
            )
        } settlement: { transaction, outcome in
            let pasteboard = NSPasteboard.general
            let stillOwnsChangeCount = ownedPasteboardChangeCount.map {
                pasteboard.changeCount == $0
            } ?? false
            let stillOwnsPayload = ownedPasteboardChangeCount.map {
                Self.clipboardStillOwned(pasteboard, text: transaction.text, changeCount: $0)
            } ?? false
            if Self.clipboardOwnershipWasLostAfterPasteFailure(
                outcome: outcome,
                hasOwnershipToken: ownedPasteboardChangeCount != nil,
                stillOwnsPayload: stillOwnsPayload
            ) {
                clipboardOwnershipWasLost = true
            }
            guard let previousClipboard else { return }
            let shouldRestore = Self.shouldRestorePreviousClipboard(
                outcome: outcome,
                stillOwnsPayload: stillOwnsPayload,
                stillOwnsChangeCount: stillOwnsChangeCount
            )
            if shouldRestore {
                previousClipboard.restore(to: pasteboard)
            }
        }
        guard accepted else {
            log("paste transaction rejected because another delivery is pending")
            updateDeliveryStatus(
                "Finish the previous paste before trying again",
                kind: .failure,
                pipelineGeneration: pipelineGeneration
            )
            deliveryCompleted?()
            return
        }
    }

    nonisolated static func shouldRestorePreviousClipboard(
        outcome: PasteDeliveryOutcome,
        stillOwnsPayload: Bool,
        stillOwnsChangeCount: Bool
    ) -> Bool {
        switch outcome {
        case .clipboardWriteFailed:
            stillOwnsChangeCount
        // Never restore over secure input, even when `restoreClipboard` was requested.
        // The payload writer has already run and the status tells the user to press Cmd-V.
        // Restoring would delete the exact transcript they were told to paste.
        case .secureInputActive:
            false
        case .targetUnavailable, .clipboardOwnershipLost, .eventPostFailed, .pasted,
             .deliveryNotObserved, .deliveredUnverified:
            stillOwnsPayload
        }
    }

    /// Whether an outcome ends with the transcript still sitting on the clipboard because the
    /// paste never consumed it — so re-copying it would be redundant.
    ///
    /// Exhaustive on purpose. `.secureInputActive` answers `false` here even though it *does*
    /// leave the transcript on the clipboard: it gets there because `shouldRestore` refuses to
    /// restore, not because the paste was abandoned before the clipboard was written, and
    /// `shouldCopyAfterPasteFailure` is additionally gated on `!accessibilityTrusted`, which is
    /// never the path secure input takes.
    nonisolated static func outcomeLeavesTranscriptOnClipboard(_ outcome: PasteDeliveryOutcome) -> Bool {
        switch outcome {
        case .targetUnavailable: true
        case .pasted, .deliveryNotObserved, .deliveredUnverified, .clipboardOwnershipLost,
             .clipboardWriteFailed, .eventPostFailed, .secureInputActive: false
        }
    }

    nonisolated static func clipboardOwnershipWasLostAfterPasteFailure(
        outcome: PasteDeliveryOutcome,
        hasOwnershipToken: Bool,
        stillOwnsPayload: Bool
    ) -> Bool {
        // Switched rather than compared against `.targetUnavailable` so the compiler forces a
        // decision here when an outcome is added. A `==` comparison answers `false` for every
        // new case without anyone having considered it, and this predicate decides whether the
        // engine still believes it owns the transcript — guessing wrong loses the text.
        let outcomeCanStrandThePayload: Bool
        switch outcome {
        case .targetUnavailable:
            outcomeCanStrandThePayload = true
        // Secure input cannot strand the payload: nothing else wrote to the clipboard, and the
        // transcript is deliberately kept there.
        case .pasted, .deliveryNotObserved, .deliveredUnverified, .clipboardOwnershipLost,
             .clipboardWriteFailed, .eventPostFailed, .secureInputActive:
            outcomeCanStrandThePayload = false
        }
        return outcomeCanStrandThePayload && hasOwnershipToken && !stillOwnsPayload
    }

    @discardableResult
    private nonisolated static func writeClipboard(_ text: String, to pasteboard: NSPasteboard) -> Bool {
        writeClipboardAttempt(text, to: pasteboard).verified
    }

    @discardableResult
    nonisolated static func writeClipboardPreservingOnFailure(
        _ text: String,
        to pasteboard: NSPasteboard
    ) -> Bool {
        let previousClipboard = ClipboardSnapshot(pasteboard: pasteboard)
        let result = writeClipboardAttempt(text, to: pasteboard)
        guard !result.verified else { return true }
        if pasteboard.changeCount == result.ownershipChangeCount {
            previousClipboard.restore(to: pasteboard)
        }
        return false
    }

    nonisolated static func writeClipboardAttempt(
        _ text: String,
        to pasteboard: NSPasteboard
    ) -> PasteboardWriteResult {
        let changeCountBeforeWrite = pasteboard.changeCount
        let clearedChangeCount = pasteboard.clearContents()
        guard pasteboard.setString(text, forType: .string) else {
            return PasteboardWriteResult(
                verified: false,
                ownershipChangeCount: clearedChangeCount,
                changeCountAdvanced: clearedChangeCount > changeCountBeforeWrite
            )
        }
        let writtenChangeCount = pasteboard.changeCount
        let storedText = pasteboard.string(forType: .string)
        return PasteboardWriteResult(
            verified: pasteboard.changeCount == writtenChangeCount && storedText == text,
            ownershipChangeCount: writtenChangeCount,
            changeCountAdvanced: writtenChangeCount > changeCountBeforeWrite
        )
    }

    nonisolated static func clipboardStillOwned(
        _ pasteboard: NSPasteboard,
        text: String,
        changeCount: Int
    ) -> Bool {
        pasteboard.changeCount == changeCount && pasteboard.string(forType: .string) == text
    }

    nonisolated static func pasteTargetIsReady(
        expectedPid: pid_t,
        expectedBundleIdentifier: String?,
        frontmostPid: pid_t?,
        frontmostBundleIdentifier: String?,
        accessibilityTrusted: Bool,
        expectedLaunchDate: Date? = nil,
        frontmostLaunchDate: Date? = nil,
        requiresProcessIdentity: Bool = false
    ) -> Bool {
        let processIdentityMatches = if requiresProcessIdentity {
            expectedLaunchDate != nil && frontmostLaunchDate == expectedLaunchDate
        } else {
            expectedLaunchDate == nil || frontmostLaunchDate == expectedLaunchDate
        }
        return accessibilityTrusted
            && frontmostPid == expectedPid
            && frontmostBundleIdentifier == expectedBundleIdentifier
            && processIdentityMatches
    }

    nonisolated static func shouldCopyPasteFallback(deliveryKind: PasteDeliveryKind) -> Bool {
        deliveryKind != .commandRewrite
    }

    nonisolated static func shouldCopyAfterPasteFailure(
        outcome: PasteDeliveryOutcome,
        deliveryKind: PasteDeliveryKind,
        accessibilityTrusted: Bool,
        clipboardOwnershipWasLost: Bool = false,
        completedTranscriptAlreadyOnClipboard: Bool = false
    ) -> Bool {
        // Switched for the same reason as `clipboardOwnershipWasLostAfterPasteFailure`: a `==`
        // test silently answers `false` for any outcome added later. Secure input already leaves
        // the transcript on the clipboard, so re-copying it would be redundant at best — but that
        // is a decision the compiler should make someone state, not one to inherit by accident.
        let outcomeNeedsClipboardFallback: Bool
        switch outcome {
        case .targetUnavailable:
            outcomeNeedsClipboardFallback = true
        case .pasted, .deliveryNotObserved, .deliveredUnverified, .clipboardOwnershipLost,
             .clipboardWriteFailed, .eventPostFailed, .secureInputActive:
            outcomeNeedsClipboardFallback = false
        }
        return outcomeNeedsClipboardFallback
            && !accessibilityTrusted
            && !clipboardOwnershipWasLost
            && !completedTranscriptAlreadyOnClipboard
            && shouldCopyPasteFallback(deliveryKind: deliveryKind)
    }

    nonisolated static func targetUnavailableDeliveryStatus(
        deliveryKind: PasteDeliveryKind,
        accessibilityTrusted: Bool,
        clipboardOwnershipWasLost: Bool,
        completedTranscriptAlreadyOnClipboard: Bool,
        fallbackWriteRequested: Bool,
        fallbackWriteSucceeded: Bool
    ) -> String {
        if fallbackWriteSucceeded {
            return "Copied — Accessibility permission changed"
        }
        if completedTranscriptAlreadyOnClipboard {
            return accessibilityTrusted
                ? "Copied — target app lost focus"
                : "Copied — Accessibility permission changed"
        }
        if clipboardOwnershipWasLost {
            return "Paste cancelled because the clipboard changed"
        }
        if !accessibilityTrusted && deliveryKind == .commandRewrite {
            return "Paste cancelled because Accessibility permission changed"
        }
        if fallbackWriteRequested {
            return "Transcription ready, but the clipboard could not be updated"
        }
        return "Paste cancelled because the target app lost focus"
    }

    nonisolated static func stableAccessibilityDocumentIdentifier(_ candidate: String?) -> String? {
        guard let candidate,
              !candidate.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else {
            return nil
        }
        return candidate
    }

    nonisolated static func stableAccessibilityContextIdentifier(
        documentIdentifier: String?,
        elementIdentifier: String?
    ) -> String? {
        if let documentIdentifier = stableAccessibilityDocumentIdentifier(documentIdentifier) {
            return "document:\(documentIdentifier)"
        }
        // AXIdentifier identifies a control, not the document shown in it. Editors
        // commonly reuse one control and window across tabs, so fail closed without
        // an independently document-specific AX identity.
        _ = elementIdentifier
        return nil
    }

    enum DeliveryStatusKind: Equatable, Sendable {
        case progress
        case success
        /// The pipeline finished but delivery could not be observed. Presented like a finished
        /// run — the recording is safe and the text is on the clipboard — while the message
        /// itself says the paste is unconfirmed. Never folded into `.success`: that is the
        /// false positive this state exists to avoid.
        case unverified
        case failure
    }

    nonisolated static func flowPhase(
        forDeliveryStatus message: String,
        kind: DeliveryStatusKind
    ) -> RecordingFlowPhase {
        switch kind {
        case .progress: .processing(message)
        case .success, .unverified: .ready(message)
        case .failure: .failed(message)
        }
    }

    /// Whether an outcome leaves a blocker the owner has to act on, so its explanation must
    /// outlive the delivery status rather than being overwritten with "Ready".
    ///
    /// Written as an exhaustive switch rather than `if case`, so adding a `PasteDeliveryOutcome`
    /// forces a decision here instead of silently defaulting to invisible.
    nonisolated static func isSecureInputOutcome(_ outcome: PasteDeliveryOutcome) -> Bool {
        switch outcome {
        case .secureInputActive: true
        case .pasted, .deliveryNotObserved, .deliveredUnverified, .targetUnavailable,
             .clipboardOwnershipLost, .clipboardWriteFailed, .eventPostFailed: false
        }
    }

    /// Only observed delivery is a success. An unreadable target is its own state, and both a
    /// contradicted read-back and a refused post are failures.
    nonisolated static func deliveryStatusKind(for outcome: PasteDeliveryOutcome) -> DeliveryStatusKind {
        switch outcome {
        case .pasted: .success
        case .deliveredUnverified: .unverified
        case .deliveryNotObserved, .secureInputActive, .targetUnavailable,
             .clipboardOwnershipLost, .clipboardWriteFailed, .eventPostFailed: .failure
        }
    }

    /// Pipeline-timing stage name. `paste_posted` used to be emitted for every posted
    /// keystroke, which made the timing trace read like a delivery record; the three delivery
    /// verdicts are now distinct stages.
    nonisolated static func recentPasteDeliveryStatus(for outcome: PasteDeliveryOutcome) -> RecentPasteDeliveryStatus {
        switch outcome {
        case .pasted: .confirmed
        case .deliveredUnverified: .unconfirmed
        case .deliveryNotObserved, .secureInputActive, .targetUnavailable,
             .clipboardOwnershipLost, .clipboardWriteFailed, .eventPostFailed: .notDelivered
        }
    }

    nonisolated static func pasteTraceStage(for outcome: PasteDeliveryOutcome) -> String {
        switch outcome {
        case .pasted: "paste_delivery_confirmed"
        case .deliveredUnverified: "paste_delivery_unverified"
        case .deliveryNotObserved: "paste_delivery_not_observed"
        case .secureInputActive, .targetUnavailable, .clipboardOwnershipLost,
             .clipboardWriteFailed, .eventPostFailed: "paste_failed"
        }
    }

    private func updateDeliveryStatus(
        _ message: String,
        kind: DeliveryStatusKind,
        pipelineGeneration: UInt64?
    ) {
        if let pipelineGeneration {
            guard pipelineDeliveryGate.shouldApplyStatus(
                deliveryGeneration: pipelineGeneration,
                currentGeneration: recordingGeneration,
                isRecording: isRecording,
                isTranscribing: isTranscribing
            ) else {
                log("delivery status suppressed for superseded pipeline generation=\(pipelineGeneration)")
                return
            }
        }
        statusMessage = message
        flowPhase = Self.flowPhase(forDeliveryStatus: message, kind: kind)
        // A delivery status that actually reaches the screen replaces whatever explanation was
        // there, so a persisted reason must not survive it — otherwise `updateStatus()`
        // resurfaces it on the next return to idle. This closes the two leaks that produce no
        // `PasteDeliveryOutcome` at all, and which clearing on `startRecording()` therefore
        // cannot reach: the "Finish the previous paste before trying again" rejection, and the
        // conversation route's "Answered".
        //
        // ORDERING: the secure-input caller must call this FIRST and re-set its reason after,
        // which it does. `macos-shortcut-contract.test.ts` asserts that order, because getting it
        // backwards silently reinstates the invisible-blocked bug with every test still green.
        setBlockedReason(nil, for: .delivery)
        setBlockedReason(nil, for: .pressConsumed)
    }

    private func appendUndeliveredPaste(text: String, copied: Bool, captureID: String?,
                                       pipelineGeneration: UInt64?, fallbackBundle: String? = nil) {
        let selection = pipelineGeneration.flatMap { frozenPasteTargetsByGeneration[$0] }
        let target: RecordingPasteTarget? = if case .frozen(let value) = selection { value } else { nil }
        recentPastes.insert(RecentPaste(text: text, bundleIdentifier: target?.bundleIdentifier ?? fallbackBundle,
            appName: target?.applicationName ?? fallbackBundle ?? "No target app",
            location: copied ? "Clipboard only" : "", status: copied ? "Copied; paste not delivered" : "Paste not delivered",
            verified: false, captureID: captureID, deliveryStatus: .notDelivered), at: 0)
        if recentPastes.count > 50 { recentPastes.removeLast() }
    }

    private func completeUnavailablePaste(_ text: String, deliveryKind: PasteDeliveryKind, captureID: String?,
                                          pipelineGeneration: UInt64?, fallbackBundle: String? = nil) {
        let copied = Self.shouldCopyPasteFallback(deliveryKind: deliveryKind) && pasteFallbackWriter(text)
        appendUndeliveredPaste(text: text, copied: copied, captureID: captureID,
                               pipelineGeneration: pipelineGeneration, fallbackBundle: fallbackBundle)
        log("paste target app not found")
        updateDeliveryStatus(deliveryKind == .commandRewrite
            ? "Paste cancelled because the target app is unavailable"
            : copied ? "Copied — no target app found" : "Transcription ready, but the clipboard could not be updated",
            kind: .failure, pipelineGeneration: pipelineGeneration)
    }

    private func selectedRunningPasteTarget(
        targetAppBundleIdentifier: String?,
        targetAppPid: pid_t?,
        frontmostPid: pid_t?,
        pipelineGeneration: UInt64?
    ) -> NSRunningApplication? {
        let runningApps = NSWorkspace.shared.runningApplications
        let candidates = runningApps.filter { !$0.isTerminated }.map {
            PasteTargetCandidate(
                pid: $0.processIdentifier,
                bundleIdentifier: $0.bundleIdentifier,
                isRegularApp: $0.activationPolicy == .regular,
                launchDate: $0.launchDate
            )
        }
        let selectedTarget = resolvePasteTarget(
            candidates: candidates, targetBundleIdentifier: targetAppBundleIdentifier,
            targetPid: targetAppPid, frontmostPid: frontmostPid, pipelineGeneration: pipelineGeneration
        )
        return selectedTarget.flatMap { selected in
            runningApps.first { $0.processIdentifier == selected.pid }
        }
    }

    func resolvePasteTarget(candidates: [PasteTargetCandidate], targetBundleIdentifier: String?,
                            targetPid: pid_t?, frontmostPid: pid_t?, pipelineGeneration: UInt64?) -> PasteTargetCandidate? {
        let frozen = pipelineGeneration.flatMap { frozenPasteTargetsByGeneration[$0] }
        let identity = pipelineGeneration.flatMap { pasteTargetProcessIdentityByGeneration[$0] }
        if frozen != nil {
            // No bundle-only or foreground fallback for an explicitly frozen capture.
            guard let identity, targetPid == identity.pid,
                  targetBundleIdentifier == identity.bundleIdentifier else { return nil }
        }
        return Self.selectPasteTarget(candidates: frozen == nil ? candidates : candidates.filter(\.isRegularApp),
            currentPid: ProcessInfo.processInfo.processIdentifier, targetBundleIdentifier: targetBundleIdentifier,
            targetPid: targetPid, frontmostPid: frontmostPid, requiredProcessIdentity: identity,
            requiresProcessIdentity: frozen != nil || (pipelineGeneration != nil && targetPid != nil))
    }

    nonisolated static func selectPasteTarget(
        candidates: [PasteTargetCandidate],
        currentPid: pid_t,
        targetBundleIdentifier: String?,
        targetPid: pid_t?,
        frontmostPid: pid_t? = nil,
        requiredProcessIdentity: PasteTargetProcessIdentity? = nil,
        requiresProcessIdentity: Bool = false
    ) -> PasteTargetCandidate? {
        if let targetPid {
            guard let targetBundleIdentifier else { return nil }
            let selected = candidates.first {
                $0.pid == targetPid
                    && $0.pid != currentPid
                    && $0.bundleIdentifier == targetBundleIdentifier
            }
            guard let selected else { return nil }
            if requiresProcessIdentity {
                guard let requiredProcessIdentity,
                      requiredProcessIdentity.pid == targetPid,
                      requiredProcessIdentity.bundleIdentifier == targetBundleIdentifier,
                      requiredProcessIdentity.matches(selected) else { return nil }
            } else if let requiredProcessIdentity,
                      !requiredProcessIdentity.matches(selected) {
                return nil
            }
            return selected
        }
        if let targetBundleIdentifier {
            return candidates.first {
                $0.pid != currentPid
                    && $0.isRegularApp
                    && $0.bundleIdentifier == targetBundleIdentifier
            }
        }
        return candidates.first {
            guard let frontmostPid else { return false }
            return $0.pid == frontmostPid && $0.pid != currentPid && $0.isRegularApp
        }
    }

    private nonisolated static func monotonicMilliseconds() -> UInt64 {
        UInt64(ProcessInfo.processInfo.systemUptime * 1_000)
    }

    nonisolated static func realtimePeriodicCommitIsDue(
        nowMilliseconds: UInt64,
        lastCommitMilliseconds: UInt64?
    ) -> Bool {
        guard let lastCommitMilliseconds else { return true }
        guard nowMilliseconds >= lastCommitMilliseconds else { return false }
        return nowMilliseconds - lastCommitMilliseconds >= realtimePeriodicCommitIntervalMilliseconds
    }

    nonisolated static func resolveFinalTranscript(
        cliText: String?,
        cliError: String?,
        realtimeText: String?
    ) -> (text: String?, failureStatus: String?) {
        if let cliText, !cliText.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            return (cliText, nil)
        }
        if let realtimeText, !realtimeText.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            return (realtimeText, nil)
        }
        return (nil, cliError ?? "Empty transcription")
    }

    private func log(_ message: String) {
        NativeAppLog.write(message, homePath: home)
    }
}

private final class LockedFlag: @unchecked Sendable {
    private let lock = NSLock()
    private var value = true

    func take() -> Bool {
        lock.lock()
        defer { lock.unlock() }
        guard value else { return false }
        value = false
        return true
    }
}

private struct ClipboardSnapshot {
    private let items: [[NSPasteboard.PasteboardType: Data]]

    init(pasteboard: NSPasteboard) {
        let capturedItems = pasteboard.pasteboardItems?.compactMap { item -> [NSPasteboard.PasteboardType: Data]? in
            let dataByType = item.types.reduce(into: [NSPasteboard.PasteboardType: Data]()) { result, type in
                if let data = item.data(forType: type) {
                    result[type] = data
                }
            }
            return dataByType.isEmpty ? nil : dataByType
        } ?? []
        items = capturedItems
    }

    func restore(to pasteboard: NSPasteboard) {
        pasteboard.clearContents()
        let pasteboardItems = items.map { itemData in
            let item = NSPasteboardItem()
            for (type, data) in itemData {
                item.setData(data, forType: type)
            }
            return item
        }
        pasteboard.writeObjects(pasteboardItems)
    }
}

// MARK: - CLI Runner

private final class ProcessDataCapture: @unchecked Sendable {
    private let lock = NSLock()
    private var storage = Data()
    private var finished = false

    func append(_ data: Data) {
        lock.lock()
        defer { lock.unlock() }
        guard !finished else { return }
        storage.append(data)
    }

    func finish() -> Bool {
        lock.lock()
        defer { lock.unlock() }
        guard !finished else { return false }
        finished = true
        return true
    }

    var data: Data {
        lock.lock()
        defer { lock.unlock() }
        return storage
    }
}

enum CLIRunner: Sendable {
    enum CaptureOperation: Sendable {
        case read
        case poll

        fileprivate var description: String {
            switch self {
            case .read: "reading"
            case .poll: "waiting for"
            }
        }
    }

    enum ExecutionError: Error, LocalizedError, Equatable {
        case timedOut(executable: String, seconds: TimeInterval)
        case deadlineExhausted
        case captureFailed(operation: CaptureOperation, code: Int32)

        var errorDescription: String? {
            switch self {
            case let .timedOut(executable, seconds):
                return "Command timed out after \(seconds.formatted()) seconds: \(executable)"
            case .deadlineExhausted:
                return "Command timed out: insufficient time remains to start safely."
            case let .captureFailed(operation, code):
                return "Failed to capture command output while \(operation.description): \(String(cString: strerror(code)))"
            }
        }
    }

    struct Command: Sendable {
        let executable: String
        let argumentsPrefix: [String]
    }

    struct ProcessOutput: Sendable {
        let stdout: String
        let stderr: String
        let terminationStatus: Int32
    }

    enum ProcessLifecycleEvent: Equatable, Sendable {
        case leaderExitObserved
        case processGroupSignaled(Int32)
        case leaderReaped(Int32)
    }

    typealias LeaderReaper = (
        _ processIdentifier: pid_t,
        _ lifecycleObserver: ((ProcessLifecycleEvent) -> Void)?
    ) throws -> Int32

    /// An explicit monotonic deadline can cross queue and preparation boundaries without
    /// resetting the budget. The clock is injectable for deterministic boundary tests.
    struct WallClockDeadline: Sendable {
        private let expiresAt: UInt64
        private let now: @Sendable () -> UInt64

        init(
            after seconds: TimeInterval,
            now: @escaping @Sendable () -> UInt64 = { DispatchTime.now().uptimeNanoseconds }
        ) {
            precondition(seconds.isFinite && seconds >= 0)
            let startedAt = now()
            let maximumDelay = min(UInt64(Int64.max), UInt64.max - startedAt)
            let requested = seconds * 1_000_000_000
            // Truncate fractional nanoseconds: rounding up could extend the configured
            // budget and reject its own deadline at a subsequent handoff validation.
            let delay = requested >= Double(maximumDelay)
                ? maximumDelay : UInt64(requested)
            expiresAt = startedAt + delay
            self.now = now
        }

        func remaining(reserving reserve: TimeInterval = 0) -> TimeInterval {
            let current = now()
            guard expiresAt > current else { return 0 }
            return max(0, Double(expiresAt - current) / 1_000_000_000 - reserve)
        }
    }

    private static func requireStartBudget(_ deadline: WallClockDeadline?) throws {
        if let deadline, deadline.remaining() <= wallClockCleanupReserve {
            throw ExecutionError.deadlineExhausted
        }
    }

    static func run(
        _ args: [String],
        home: String,
        timeout: TimeInterval = 120,
        totalWallClockBudget: TimeInterval? = nil,
        environment suppliedEnvironment: [String: String]? = nil,
        wallClockDeadline suppliedDeadline: WallClockDeadline? = nil,
        environmentProvider: (() throws -> [String: String])? = nil
    ) -> String {
        if let totalWallClockBudget {
            precondition(totalWallClockBudget.isFinite && totalWallClockBudget > wallClockCleanupReserve)
        }
        precondition(suppliedDeadline == nil || totalWallClockBudget != nil)
        let deadline = suppliedDeadline ?? totalWallClockBudget.map { WallClockDeadline(after: $0) }
        if let suppliedDeadline, let totalWallClockBudget {
            precondition(suppliedDeadline.remaining() <= totalWallClockBudget)
        }
        do {
            try requireStartBudget(deadline)
            let command = resolveCommand(home: home)
            let arguments = command.argumentsPrefix + args
            try requireStartBudget(deadline)
            let environment = try suppliedEnvironment ?? environmentProvider?() ?? ServiceAPIConfiguration.childEnvironment(
                base: OpenAIAPIKeyStore.childEnvironment(base: ProcessInfo.processInfo.environment.merging([
                    "PATH": "\(home)/.bun/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin"
                ]) { _, new in new }, homePath: home)
            )
            try requireStartBudget(deadline)
            let output = try runExecutable(
                command.executable,
                arguments: arguments,
                environment: environment,
                executionTimeout: timeout,
                totalWallClockBudget: totalWallClockBudget,
                wallClockDeadline: deadline
            )
            if output.terminationStatus != 0 {
                let details = output.stderr.isEmpty ? output.stdout : output.stderr
                return "ERROR: \(NativeErrorSanitizer.sanitize(details.trimmingCharacters(in: .whitespacesAndNewlines)))"
            }
            return output.stdout.isEmpty
                ? NativeErrorSanitizer.sanitize(output.stderr)
                : output.stdout
        } catch {
            return "ERROR: \(NativeErrorSanitizer.sanitize(error.localizedDescription))"
        }
    }

    static func resolveCommand(
        home: String,
        bundleURL: URL = Bundle.main.bundleURL,
        fileManager: FileManager = .default
    ) -> Command {
        let bundled = bundleURL.appendingPathComponent("Contents/Helpers/recordings")
        let isPackagedApp = bundleURL.pathExtension.caseInsensitiveCompare("app") == .orderedSame
        if isPackagedApp || fileManager.fileExists(atPath: bundled.path) {
            return Command(executable: bundled.path, argumentsPrefix: [])
        }

        // SwiftPM development and test runs do not have an app bundle. Retain an
        // explicit local fallback there; packaged apps exclusively use their helper.
        let userCLI = "\(home)/.bun/bin/recordings"
        if fileManager.fileExists(atPath: userCLI) {
            return Command(executable: userCLI, argumentsPrefix: [])
        }
        return Command(executable: "/usr/bin/env", argumentsPrefix: ["recordings"])
    }

    /// Wall-clock time reserved out of the execution window when `totalWallClockBudget` is
    /// set, so termination grace, kill grace, and pipe drain land inside the budget with
    /// scheduling margin to spare.
    static let wallClockCleanupReserve: TimeInterval = 1

    static func runExecutable(
        _ executable: String,
        arguments: [String],
        environment: [String: String]? = nil,
        executionTimeout: TimeInterval = 120,
        terminationGracePeriod: TimeInterval = 0.5,
        forceKillGracePeriod: TimeInterval = 1,
        pipeDrainTimeout: TimeInterval = 2,
        totalWallClockBudget: TimeInterval? = nil,
        wallClockDeadline suppliedDeadline: WallClockDeadline? = nil,
        beforeExecutionDeadline: (() -> Void)? = nil,
        lifecycleObserver: ((ProcessLifecycleEvent) -> Void)? = nil,
        leaderReaper: LeaderReaper? = nil,
        captureSystemCalls: PipeCaptureReader.SystemCalls = .live
    ) throws -> ProcessOutput {
        precondition(executionTimeout.isFinite && executionTimeout > 0)
        precondition(terminationGracePeriod.isFinite && terminationGracePeriod >= 0)
        precondition(forceKillGracePeriod.isFinite && forceKillGracePeriod >= 0)
        precondition(pipeDrainTimeout.isFinite && pipeDrainTimeout >= 0)
        if let totalWallClockBudget {
            precondition(totalWallClockBudget.isFinite && totalWallClockBudget > wallClockCleanupReserve)
        }

        precondition(suppliedDeadline == nil || totalWallClockBudget != nil)
        if let suppliedDeadline, let totalWallClockBudget {
            precondition(suppliedDeadline.remaining() <= totalWallClockBudget)
        }
        // A caller that prepared the command supplies its original deadline. Direct
        // executable callers begin here; neither path resets a previously spent budget.
        let wallClockDeadline = suppliedDeadline ?? totalWallClockBudget.map { WallClockDeadline(after: $0) }
        func clampedToWallClockBudget(
            _ phaseTimeout: TimeInterval,
            reserving reserve: TimeInterval = 0
        ) -> TimeInterval {
            guard let wallClockDeadline else { return phaseTimeout }
            return min(phaseTimeout, wallClockDeadline.remaining(reserving: reserve))
        }
        let contractualExecutionTimeout = totalWallClockBudget
            .map { min(executionTimeout, $0 - wallClockCleanupReserve) } ?? executionTimeout

        try requireStartBudget(wallClockDeadline)
        let stdoutReader = try PipeCaptureReader(systemCalls: captureSystemCalls)
        let stderrReader: PipeCaptureReader
        do {
            stderrReader = try PipeCaptureReader(systemCalls: captureSystemCalls)
        } catch {
            stdoutReader.closeWriteDescriptor()
            _ = finishCaptures([stdoutReader], pipeDrainTimeout: 0)
            throw error
        }
        let captureReaders = [stdoutReader, stderrReader]

        let processIdentifier: pid_t
        do {
            try requireStartBudget(wallClockDeadline)
            processIdentifier = try spawnProcessGroup(
                executable,
                arguments: arguments,
                environment: environment,
                stdoutDescriptor: stdoutReader.writeDescriptor,
                stderrDescriptor: stderrReader.writeDescriptor,
                stdoutReadDescriptor: stdoutReader.readDescriptor,
                stderrReadDescriptor: stderrReader.readDescriptor
            )
        } catch {
            stdoutReader.closeWriteDescriptor()
            stderrReader.closeWriteDescriptor()
            _ = finishCaptures(captureReaders, pipeDrainTimeout: 0)
            throw error
        }
        stdoutReader.closeWriteDescriptor()
        stderrReader.closeWriteDescriptor()

        beforeExecutionDeadline?()
        let leaderExitWasObserved: Bool
        let didTimeOut: Bool
        do {
            leaderExitWasObserved = try waitForUnreapedLeaderExit(
                processIdentifier,
                timeout: clampedToWallClockBudget(executionTimeout, reserving: wallClockCleanupReserve),
                lifecycleObserver: lifecycleObserver
            )
            didTimeOut = !leaderExitWasObserved
        } catch {
            signalProcessGroup(processIdentifier, signal: SIGKILL, lifecycleObserver: lifecycleObserver)
            reapLeaderInBackground(processIdentifier)
            _ = finishCaptures(
                captureReaders,
                pipeDrainTimeout: clampedToWallClockBudget(pipeDrainTimeout)
            )
            throw error
        }

        // Keep the direct child unreaped until every group-directed signal has
        // been sent. Its zombie reserves the process-group identifier, so a PID
        // reuse cannot redirect cleanup to an unrelated process group.
        signalProcessGroup(processIdentifier, signal: SIGTERM, lifecycleObserver: lifecycleObserver)
        var confirmedExit = leaderExitWasObserved
        if didTimeOut {
            do {
                confirmedExit = try waitForUnreapedLeaderExit(
                    processIdentifier,
                    timeout: clampedToWallClockBudget(terminationGracePeriod),
                    lifecycleObserver: lifecycleObserver
                )
            } catch {
                signalProcessGroup(processIdentifier, signal: SIGKILL, lifecycleObserver: lifecycleObserver)
                reapLeaderInBackground(processIdentifier)
                _ = finishCaptures(
                    captureReaders,
                    pipeDrainTimeout: clampedToWallClockBudget(pipeDrainTimeout)
                )
                throw error
            }
        } else {
            let drainDeadline = monotonicDispatchDeadline(
                after: clampedToWallClockBudget(terminationGracePeriod)
            )
            for reader in captureReaders {
                reader.waitUntilExited(deadline: drainDeadline)
            }
        }
        signalProcessGroup(processIdentifier, signal: SIGKILL, lifecycleObserver: lifecycleObserver)
        if !confirmedExit {
            do {
                confirmedExit = try waitForUnreapedLeaderExit(
                    processIdentifier,
                    timeout: clampedToWallClockBudget(forceKillGracePeriod),
                    lifecycleObserver: lifecycleObserver
                )
            } catch {
                reapLeaderInBackground(processIdentifier)
                _ = finishCaptures(
                    captureReaders,
                    pipeDrainTimeout: clampedToWallClockBudget(pipeDrainTimeout)
                )
                throw error
            }
        }
        let terminationStatus: Int32?
        if confirmedExit {
            do {
                terminationStatus = try leaderReaper?(
                    processIdentifier,
                    lifecycleObserver
                ) ?? reapLeader(
                    processIdentifier,
                    lifecycleObserver: lifecycleObserver
                )
            } catch {
                reapLeaderInBackground(processIdentifier)
                _ = finishCaptures(
                    captureReaders,
                    pipeDrainTimeout: clampedToWallClockBudget(pipeDrainTimeout)
                )
                throw error
            }
        } else {
            reapLeaderInBackground(processIdentifier)
            terminationStatus = nil
        }

        let captureError = finishCaptures(
            captureReaders,
            pipeDrainTimeout: clampedToWallClockBudget(pipeDrainTimeout)
        )

        if didTimeOut {
            throw ExecutionError.timedOut(executable: executable, seconds: contractualExecutionTimeout)
        }
        if let captureError {
            throw captureError
        }

        // Both readers are joined by now, so these snapshots can never observe a
        // truncated mid-append state.
        return ProcessOutput(
            stdout: String(decoding: stdoutReader.data, as: UTF8.self),
            stderr: String(decoding: stderrReader.data, as: UTF8.self),
            terminationStatus: terminationStatus ?? 1
        )
    }

    private static func spawnProcessGroup(
        _ executable: String,
        arguments: [String],
        environment: [String: String]?,
        stdoutDescriptor: Int32,
        stderrDescriptor: Int32,
        stdoutReadDescriptor: Int32,
        stderrReadDescriptor: Int32
    ) throws -> pid_t {
        var duplicatedDescriptors: [Int32] = []
        defer {
            for descriptor in duplicatedDescriptors {
                Darwin.close(descriptor)
            }
        }
        let childStdoutDescriptor = try nonStandardDescriptor(
            stdoutDescriptor,
            duplicates: &duplicatedDescriptors
        )
        let childStderrDescriptor = try nonStandardDescriptor(
            stderrDescriptor,
            duplicates: &duplicatedDescriptors
        )

        var fileActions: posix_spawn_file_actions_t?
        try checkPOSIX(posix_spawn_file_actions_init(&fileActions), operation: "initialize spawn file actions")
        defer { posix_spawn_file_actions_destroy(&fileActions) }

        try checkPOSIX(
            posix_spawn_file_actions_adddup2(&fileActions, childStdoutDescriptor, STDOUT_FILENO),
            operation: "configure command stdout"
        )
        try checkPOSIX(
            posix_spawn_file_actions_adddup2(&fileActions, childStderrDescriptor, STDERR_FILENO),
            operation: "configure command stderr"
        )
        let inheritedDescriptors = Set([
            stdoutReadDescriptor,
            stderrReadDescriptor,
            stdoutDescriptor,
            stderrDescriptor,
            childStdoutDescriptor,
            childStderrDescriptor,
        ]).filter { $0 != STDOUT_FILENO && $0 != STDERR_FILENO }
        for descriptor in inheritedDescriptors {
            try checkPOSIX(
                posix_spawn_file_actions_addclose(&fileActions, descriptor),
                operation: "close inherited command descriptor"
            )
        }

        // CLOEXEC_DEFAULT also closes stdin unless it is explicitly inherited. Keep
        // the existing stdin behavior, including an already closed/CLOEXEC stream;
        // a capture pipe that reused fd 0 must still be closed by the actions above.
        if !inheritedDescriptors.contains(STDIN_FILENO) {
            var inputFlags: Int32
            repeat {
                inputFlags = Darwin.fcntl(STDIN_FILENO, F_GETFD)
            } while inputFlags == -1 && errno == EINTR
            let inputError = errno
            if inputFlags == -1 && inputError != EBADF {
                throw NSError(
                    domain: NSPOSIXErrorDomain,
                    code: Int(inputError),
                    userInfo: [NSLocalizedDescriptionKey: "Failed to inspect command standard input"]
                )
            }
            if inputFlags >= 0 && inputFlags & FD_CLOEXEC == 0 {
                try checkPOSIX(
                    posix_spawn_file_actions_addinherit_np(&fileActions, STDIN_FILENO),
                    operation: "inherit command standard input"
                )
            }
        }

        var attributes: posix_spawnattr_t?
        try checkPOSIX(posix_spawnattr_init(&attributes), operation: "initialize spawn attributes")
        defer { posix_spawnattr_destroy(&attributes) }
        var defaultSignals = sigset_t()
        Darwin.sigemptyset(&defaultSignals)
        Darwin.sigaddset(&defaultSignals, SIGTERM)
        try checkPOSIX(
            posix_spawnattr_setsigdefault(&attributes, &defaultSignals),
            operation: "reset command termination signal"
        )
        var unblockedSignals = sigset_t()
        Darwin.sigemptyset(&unblockedSignals)
        try checkPOSIX(
            posix_spawnattr_setsigmask(&attributes, &unblockedSignals),
            operation: "unblock command signals"
        )
        // A different reader may still be between pipe() and FD_CLOEXEC setup.
        // Inherit only our explicit standard streams, never that unrelated pipe.
        let spawnFlags = POSIX_SPAWN_SETPGROUP | POSIX_SPAWN_SETSIGDEF
            | POSIX_SPAWN_SETSIGMASK | POSIX_SPAWN_CLOEXEC_DEFAULT
        try checkPOSIX(
            posix_spawnattr_setflags(&attributes, Int16(spawnFlags)),
            operation: "configure command process group"
        )
        try checkPOSIX(
            posix_spawnattr_setpgroup(&attributes, 0),
            operation: "configure command process group leader"
        )

        let environmentValues = (environment ?? ProcessInfo.processInfo.environment)
            .map { "\($0.key)=\($0.value)" }
        var processIdentifier: pid_t = 0
        let spawnResult = withMutableCStringArray([executable] + arguments) { argumentVector in
            withMutableCStringArray(environmentValues) { environmentVector in
                posix_spawn(
                    &processIdentifier,
                    executable,
                    &fileActions,
                    &attributes,
                    argumentVector,
                    environmentVector
                )
            }
        }
        try checkPOSIX(spawnResult, operation: "launch command")
        return processIdentifier
    }

    private static func nonStandardDescriptor(
        _ descriptor: Int32,
        duplicates: inout [Int32]
    ) throws -> Int32 {
        guard descriptor == STDOUT_FILENO || descriptor == STDERR_FILENO else {
            return descriptor
        }
        let duplicate = Darwin.fcntl(descriptor, F_DUPFD_CLOEXEC, 3)
        guard duplicate != -1 else {
            throw NSError(
                domain: NSPOSIXErrorDomain,
                code: Int(errno),
                userInfo: [NSLocalizedDescriptionKey: "Failed to duplicate command descriptor: \(String(cString: strerror(errno)))"]
            )
        }
        duplicates.append(duplicate)
        return duplicate
    }

    private static func withMutableCStringArray<Result>(
        _ strings: [String],
        body: (UnsafeMutablePointer<UnsafeMutablePointer<CChar>?>) throws -> Result
    ) rethrows -> Result {
        var pointers = strings.map { strdup($0) }
        pointers.append(nil)
        defer {
            for pointer in pointers where pointer != nil {
                free(pointer)
            }
        }
        return try pointers.withUnsafeMutableBufferPointer { buffer in
            try body(buffer.baseAddress!)
        }
    }

    private static func checkPOSIX(_ result: Int32, operation: String) throws {
        guard result == 0 else {
            throw NSError(
                domain: NSPOSIXErrorDomain,
                code: Int(result),
                userInfo: [NSLocalizedDescriptionKey: "Failed to \(operation): \(String(cString: strerror(result)))"]
            )
        }
    }

    private static func waitForUnreapedLeaderExit(
        _ processIdentifier: pid_t,
        timeout: TimeInterval,
        lifecycleObserver: ((ProcessLifecycleEvent) -> Void)?
    ) throws -> Bool {
        let deadline = monotonicUptimeDeadline(after: timeout)
        repeat {
            var information = siginfo_t()
            var result: Int32
            repeat {
                result = Darwin.waitid(
                    P_PID,
                    id_t(processIdentifier),
                    &information,
                    WEXITED | WNOHANG | WNOWAIT
                )
            } while result == -1 && errno == EINTR
            guard result == 0 else {
                throw NSError(
                    domain: NSPOSIXErrorDomain,
                    code: Int(errno),
                    userInfo: [NSLocalizedDescriptionKey: "Failed to observe command exit: \(String(cString: strerror(errno)))"]
                )
            }
            if information.si_pid == processIdentifier {
                lifecycleObserver?(.leaderExitObserved)
                return true
            }
            if DispatchTime.now().uptimeNanoseconds >= deadline { return false }
            usleep(10_000)
        } while true
    }

    private static func signalProcessGroup(
        _ processGroup: pid_t,
        signal: Int32,
        lifecycleObserver: ((ProcessLifecycleEvent) -> Void)?
    ) {
        lifecycleObserver?(.processGroupSignaled(signal))
        _ = Darwin.kill(-processGroup, signal)
    }

    private static func reapLeader(
        _ processIdentifier: pid_t,
        lifecycleObserver: ((ProcessLifecycleEvent) -> Void)?
    ) throws -> Int32 {
        var waitStatus: Int32 = 0
        var waitResult: pid_t
        repeat {
            waitResult = Darwin.waitpid(processIdentifier, &waitStatus, 0)
        } while waitResult == -1 && errno == EINTR
        guard waitResult == processIdentifier else {
            throw NSError(
                domain: NSPOSIXErrorDomain,
                code: Int(errno),
                userInfo: [NSLocalizedDescriptionKey: "Failed to reap command: \(String(cString: strerror(errno)))"]
            )
        }
        let terminationStatus = decode(waitStatus: waitStatus)
        lifecycleObserver?(.leaderReaped(terminationStatus))
        return terminationStatus
    }

    private static func reapLeaderInBackground(_ processIdentifier: pid_t) {
        DispatchQueue.global(qos: .utility).async {
            var waitStatus: Int32 = 0
            var waitResult: pid_t
            repeat {
                waitResult = Darwin.waitpid(processIdentifier, &waitStatus, 0)
            } while waitResult == -1 && errno == EINTR
        }
    }

    private static func decode(waitStatus: Int32) -> Int32 {
        let signal = waitStatus & 0x7f
        if signal == 0 {
            return (waitStatus >> 8) & 0xff
        }
        return 128 + signal
    }

    private static func monotonicDispatchDeadline(after timeout: TimeInterval) -> DispatchTime {
        DispatchTime(uptimeNanoseconds: monotonicUptimeDeadline(after: timeout))
    }

    private static func monotonicUptimeDeadline(after timeout: TimeInterval) -> UInt64 {
        let now = DispatchTime.now().uptimeNanoseconds
        let maximumDelay = min(UInt64(Int64.max), UInt64.max - now)
        let requestedNanoseconds = timeout * 1_000_000_000
        let nanoseconds = requestedNanoseconds >= Double(maximumDelay)
            ? maximumDelay
            : UInt64(requestedNanoseconds.rounded(.up))
        return now + nanoseconds
    }

    /// Shuts capture down deterministically. Waits up to `pipeDrainTimeout` for the
    /// readers to observe end-of-file on their own — the complete-output path — then
    /// cancels and joins whatever is still running. Both reader threads have provably
    /// exited and both pipe read ends are closed before this returns: a silent escaped
    /// descendant still holding a write end observes a widowed pipe at that point, and no
    /// snapshot of captured output can race a reader mid-append.
    private static func finishCaptures(
        _ readers: [PipeCaptureReader],
        pipeDrainTimeout: TimeInterval
    ) -> ExecutionError? {
        let deadline = monotonicDispatchDeadline(after: pipeDrainTimeout)
        for reader in readers {
            reader.waitUntilExited(deadline: deadline)
        }
        for reader in readers {
            reader.cancel()
        }
        for reader in readers {
            reader.join()
        }
        return readers.lazy.compactMap(\.terminalError).first
    }

    /// Owns one capture pipe end to end: it creates the pipe, lends the write end to the
    /// spawn, and consumes the read end on a dedicated thread that multiplexes the
    /// nonblocking pipe with a private wakeup pipe through poll(2). `cancel()` writes one
    /// wakeup byte, so the thread deterministically leaves poll even when a silent
    /// escaped descendant keeps the write end open forever without writing a byte — POSIX
    /// does not promise that replacing or closing a descriptor interrupts a read(2)
    /// already blocked on it, so the blocking-read + dup2 revocation this replaces could
    /// leave the reader thread and the process's pipe reference alive indefinitely.
    ///
    /// The runner must keep owning every reference to the read descriptor itself:
    /// `FileHandle.readabilityHandler` keeps a private duplicate of the descriptor that
    /// can survive `close()` while data is flowing, which would leave the pipe readable
    /// forever — a descendant that inherited the write end would never observe EPIPE, and
    /// the descriptor would leak in this process. Never reintroduce it here.
    final class PipeCaptureReader: @unchecked Sendable {
        struct SystemCalls: @unchecked Sendable {
            let makePipe: (_ operation: String) throws -> (read: Int32, write: Int32)
            let fcntl: (_ descriptor: Int32, _ command: Int32, _ value: Int32?) -> Int32
            let close: (_ descriptor: Int32) -> Int32
            let read: (
                _ descriptor: Int32,
                _ buffer: UnsafeMutableRawPointer?,
                _ count: Int
            ) -> Int
            let poll: (
                _ descriptors: UnsafeMutablePointer<pollfd>?,
                _ count: nfds_t,
                _ timeout: Int32
            ) -> Int32

            init(
                makePipe: @escaping (_ operation: String) throws -> (read: Int32, write: Int32) = {
                    try PipeCaptureReader.makePipe(operation: $0)
                },
                fcntl: @escaping (
                    _ descriptor: Int32,
                    _ command: Int32,
                    _ value: Int32?
                ) -> Int32 = { descriptor, command, value in
                    if let value {
                        return Darwin.fcntl(descriptor, command, value)
                    }
                    return Darwin.fcntl(descriptor, command)
                },
                close: @escaping (_ descriptor: Int32) -> Int32 = { Darwin.close($0) },
                read: @escaping (
                    _ descriptor: Int32,
                    _ buffer: UnsafeMutableRawPointer?,
                    _ count: Int
                ) -> Int = { Darwin.read($0, $1, $2) },
                poll: @escaping (
                    _ descriptors: UnsafeMutablePointer<pollfd>?,
                    _ count: nfds_t,
                    _ timeout: Int32
                ) -> Int32 = { Darwin.poll($0, $1, $2) }
            ) {
                self.makePipe = makePipe
                self.fcntl = fcntl
                self.close = close
                self.read = read
                self.poll = poll
            }

            static let live = SystemCalls()
        }

        /// Write end lent to the spawned child; the runner closes it through
        /// `closeWriteDescriptor()` once the child holds its own copies.
        let writeDescriptor: Int32
        /// Read end consumed — and eventually closed — exclusively by the reader thread.
        let readDescriptor: Int32

        private let wakeupReadDescriptor: Int32
        private let wakeupWriteDescriptor: Int32
        private let systemCalls: SystemCalls
        private let capture = ProcessDataCapture()
        private let exited = DispatchSemaphore(value: 0)
        private let lock = NSLock()
        private var cancelRequested = false
        private var writeDescriptorClosed = false
        private var wakeupDescriptorsClosed = false
        private var storedTerminalError: ExecutionError?

        /// Reads per drain burst between polls, so a flooding writer cannot starve the
        /// wakeup descriptor check.
        private static let drainReadLimit = 64
        /// Reads allowed after cancellation — comfortably above the kernel's largest pipe
        /// buffer, so an already-buffered tail is never dropped, yet `join()` stays
        /// prompt against a descendant that keeps writing.
        private static let cancelledDrainReadLimit = 16

        init(systemCalls: SystemCalls = .live) throws {
            let dataPipe = try systemCalls.makePipe("create capture pipe")
            let wakeupPipe: (read: Int32, write: Int32)
            do {
                wakeupPipe = try systemCalls.makePipe("create capture wakeup pipe")
            } catch {
                _ = systemCalls.close(dataPipe.read)
                _ = systemCalls.close(dataPipe.write)
                throw error
            }

            let descriptors = [dataPipe.read, dataPipe.write, wakeupPipe.read, wakeupPipe.write]
            var setupSucceeded = false
            defer {
                if !setupSucceeded {
                    for descriptor in descriptors {
                        _ = systemCalls.close(descriptor)
                    }
                }
            }

            for descriptor in descriptors {
                let descriptorFlags = try Self.checkedFcntl(
                    descriptor,
                    command: F_GETFD,
                    operation: "read capture descriptor flags",
                    systemCalls: systemCalls
                )
                _ = try Self.checkedFcntl(
                    descriptor,
                    command: F_SETFD,
                    value: descriptorFlags | FD_CLOEXEC,
                    operation: "protect capture descriptor from inheritance",
                    systemCalls: systemCalls
                )
            }
            let readFlags = try Self.checkedFcntl(
                dataPipe.read,
                command: F_GETFL,
                operation: "read capture pipe status flags",
                systemCalls: systemCalls
            )
            _ = try Self.checkedFcntl(
                dataPipe.read,
                command: F_SETFL,
                value: readFlags | O_NONBLOCK,
                operation: "make capture pipe nonblocking",
                systemCalls: systemCalls
            )

            readDescriptor = dataPipe.read
            writeDescriptor = dataPipe.write
            wakeupReadDescriptor = wakeupPipe.read
            wakeupWriteDescriptor = wakeupPipe.write
            self.systemCalls = systemCalls
            setupSucceeded = true
            Thread.detachNewThread { [self] in consumePipe() }
        }

        deinit {
            // The reader thread retains this object until it has closed the read end.
            // Callers must still close/cancel/join; this only releases any remaining
            // owner-side descriptors after the reader has already exited.
            if !writeDescriptorClosed { _ = systemCalls.close(writeDescriptor) }
            if !wakeupDescriptorsClosed {
                _ = systemCalls.close(wakeupReadDescriptor)
                _ = systemCalls.close(wakeupWriteDescriptor)
            }
        }

        /// Everything captured so far; stable and complete once `join()` has returned.
        var data: Data { capture.data }

        /// A terminal capture failure, stable once `join()` has returned. Cancellation
        /// and ordinary end-of-file are not failures.
        var terminalError: ExecutionError? {
            lock.lock()
            defer { lock.unlock() }
            return storedTerminalError
        }

        func closeWriteDescriptor() {
            lock.lock()
            defer { lock.unlock() }
            guard !writeDescriptorClosed else { return }
            writeDescriptorClosed = true
            _ = systemCalls.close(writeDescriptor)
        }

        /// Waits until `deadline` for the reader thread to exit on its own — that is,
        /// for end-of-file once every write end is closed. Returns whether it has.
        @discardableResult
        func waitUntilExited(deadline: DispatchTime) -> Bool {
            guard exited.wait(timeout: deadline) == .success else { return false }
            exited.signal()
            return true
        }

        /// Wakes the reader thread out of poll(2) even when the capture pipe never
        /// becomes readable again. Idempotent; never blocks.
        func cancel() {
            lock.lock()
            defer { lock.unlock() }
            guard !cancelRequested, !wakeupDescriptorsClosed else { return }
            cancelRequested = true
            var wakeupByte: UInt8 = 1
            var result: Int
            repeat {
                result = Darwin.write(wakeupWriteDescriptor, &wakeupByte, 1)
            } while result == -1 && errno == EINTR
        }

        /// Blocks until the reader thread has provably exited and closed the pipe read
        /// end, then releases the wakeup pipe. Callers must `cancel()` first whenever the
        /// pipe may never reach end-of-file; the wakeup then bounds this wait to thread
        /// scheduling plus one final drain burst. Idempotent.
        func join() {
            exited.wait()
            exited.signal()
            lock.lock()
            defer { lock.unlock() }
            guard !wakeupDescriptorsClosed else { return }
            wakeupDescriptorsClosed = true
            _ = systemCalls.close(wakeupReadDescriptor)
            _ = systemCalls.close(wakeupWriteDescriptor)
        }

        private func consumePipe() {
            Thread.current.name = "CLIRunner.PipeCaptureReader"
            var buffer = [UInt8](repeating: 0, count: 65_536)
            var cancelled = false
            readLoop: while true {
                var reads = 0
                var sawEndOfFile = false
                var sawFailure = false
                let readLimit = cancelled ? Self.cancelledDrainReadLimit : Self.drainReadLimit
                while reads < readLimit {
                    let count = buffer.withUnsafeMutableBytes {
                        systemCalls.read(readDescriptor, $0.baseAddress, $0.count)
                    }
                    if count > 0 {
                        capture.append(Data(bytes: buffer, count: count))
                        reads += 1
                        continue
                    }
                    if count == 0 {
                        sawEndOfFile = true
                    } else if errno == EINTR {
                        continue
                    } else if errno != EAGAIN {
                        storeTerminalError(operation: .read, code: errno)
                        sawFailure = true
                    }
                    break
                }
                if sawEndOfFile || sawFailure || cancelled { break readLoop }
                var descriptors = [
                    pollfd(fd: readDescriptor, events: Int16(POLLIN), revents: 0),
                    pollfd(fd: wakeupReadDescriptor, events: Int16(POLLIN), revents: 0),
                ]
                let events = systemCalls.poll(&descriptors, 2, -1)
                if events == -1 {
                    if errno == EINTR { continue readLoop }
                    storeTerminalError(operation: .poll, code: errno)
                    break readLoop
                }
                if descriptors[0].revents & Int16(POLLNVAL) != 0 {
                    storeTerminalError(operation: .poll, code: EBADF)
                    break readLoop
                }
                if descriptors[0].revents & Int16(POLLERR) != 0 {
                    storeTerminalError(operation: .poll, code: EIO)
                    break readLoop
                }
                if descriptors[1].revents & Int16(POLLNVAL) != 0 {
                    storeTerminalError(operation: .poll, code: EBADF)
                    break readLoop
                }
                if descriptors[1].revents & Int16(POLLERR) != 0 {
                    storeTerminalError(operation: .poll, code: EIO)
                    break readLoop
                }
                if descriptors[1].revents != 0 {
                    // One final bounded drain of already-buffered data, then exit.
                    cancelled = true
                }
            }
            _ = capture.finish()
            _ = systemCalls.close(readDescriptor)
            exited.signal()
        }

        private func storeTerminalError(operation: CaptureOperation, code: Int32) {
            lock.lock()
            defer { lock.unlock() }
            guard storedTerminalError == nil else { return }
            storedTerminalError = .captureFailed(operation: operation, code: code)
        }

        private static func makePipe(operation: String) throws -> (read: Int32, write: Int32) {
            var ends: [Int32] = [0, 0]
            guard Darwin.pipe(&ends) == 0 else {
                throw NSError(
                    domain: NSPOSIXErrorDomain,
                    code: Int(errno),
                    userInfo: [NSLocalizedDescriptionKey: "Failed to \(operation): \(String(cString: strerror(errno)))"]
                )
            }
            return (ends[0], ends[1])
        }

        private static func checkedFcntl(
            _ descriptor: Int32,
            command: Int32,
            value: Int32? = nil,
            operation: String,
            systemCalls: SystemCalls
        ) throws -> Int32 {
            var result: Int32
            repeat {
                result = systemCalls.fcntl(descriptor, command, value)
            } while result == -1 && errno == EINTR
            guard result != -1 else {
                let errorNumber = errno
                throw NSError(
                    domain: NSPOSIXErrorDomain,
                    code: Int(errorNumber),
                    userInfo: [
                        NSLocalizedDescriptionKey:
                            "Failed to \(operation): \(String(cString: strerror(errorNumber)))"
                    ]
                )
            }
            return result
        }
    }

    static func parseError(_ output: String, serviceAPI: Bool = false) -> String? {
        let trimmed = output.trimmingCharacters(in: .whitespacesAndNewlines)
        guard trimmed.hasPrefix("ERROR:") else { return nil }
        let message = NativeErrorSanitizer.sanitize(
            trimmed.dropFirst("ERROR:".count).trimmingCharacters(in: .whitespacesAndNewlines)
        )
        let lowercased = message.lowercased()
        if lowercased.contains("401") || lowercased.contains("incorrect api key")
            || lowercased.contains("invalid_api_key") || lowercased.contains("invalid or expired") {
            if serviceAPI { return "Recordings API authentication failed — check the API connection in Settings" }
            return "OpenAI API key invalid or expired — update it in Recordings Settings"
        }
        if lowercased.contains("429") || lowercased.contains("exceeded your current quota")
            || lowercased.contains("insufficient_quota") || lowercased.contains("quota exceeded") {
            if serviceAPI { return "Recordings API request limit reached — try again later" }
            return "OpenAI quota exceeded — check the OpenAI account billing"
        }
        if message.contains("OpenAI API key not configured") {
            return "OpenAI API key not configured on this Mac"
        }
        if message.isEmpty {
            return "Transcription failed"
        }
        return String(message.prefix(120))
    }

    /// The raw (pre-enhancement) transcript from a CLI JSON envelope. Intent decisions must
    /// run on this, never on `processed_text`.
    static func parseRawTranscript(_ output: String) -> String? {
        guard let s = output.range(of: "{"), let e = output.range(of: "}", options: .backwards),
              s.lowerBound < e.upperBound else { return nil }
        let json = String(output[s.lowerBound..<e.upperBound])
        guard let data = json.data(using: .utf8),
              let obj = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let raw = obj["raw_text"] as? String,
              !raw.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else { return nil }
        return raw
    }

    static func parseJSON(_ output: String) -> String? {
        if let s = output.range(of: "{"), let e = output.range(of: "}", options: .backwards),
           s.lowerBound < e.upperBound {
            let json = String(output[s.lowerBound..<e.upperBound])
            if let data = json.data(using: .utf8),
               let obj = try? JSONSerialization.jsonObject(with: data) as? [String: Any] {
                if let t = obj["processed_text"] as? String, !t.isEmpty { return t }
                if let t = obj["raw_text"] as? String, !t.isEmpty { return t }
            }
        }
        return output.components(separatedBy: "\n")
            .map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }
            .first { !$0.isEmpty && !$0.hasPrefix("{") && !$0.contains("Transcribing") && !$0.hasPrefix("Saved") && !$0.hasPrefix("ERROR:") }
    }
}
