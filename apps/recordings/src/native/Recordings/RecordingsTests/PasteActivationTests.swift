import Foundation
import Testing
@testable import RecordingsLib

@MainActor
private final class PasteActivationClock {
    var now: TimeInterval = 0
    var scheduled: [(TimeInterval, PasteTransactionCoordinator.ScheduledOperation)] = []

    func schedule(_ delay: TimeInterval, _ operation: @escaping PasteTransactionCoordinator.ScheduledOperation) {
        scheduled.append((now + delay, operation))
    }

    func advance(to end: TimeInterval) {
        while let first = scheduled.indices.min(by: { scheduled[$0].0 < scheduled[$1].0 }),
              scheduled[first].0 <= end {
            let (time, operation) = scheduled.remove(at: first)
            now = time
            operation()
        }
        now = max(now, end)
    }
}

@MainActor
private final class PasteActivationFixture {
    let clock = PasteActivationClock()
    let expected = PasteApplicationObservation(pid: 42, bundleIdentifier: "fixture.target",
                                               launchDate: Date(timeIntervalSince1970: 123))
    var live: PasteApplicationObservation?
    var frontmost: PasteApplicationObservation?
    var trusted = true
    var currentGeneration: UInt64 = 1
    var isRecording = false
    var recorderIsActive = true
    var activationAccepted = true
    var selectionMatches = true
    var activations = 0
    var yields = 0
    var cooperativeRequests: [Bool] = []
    var preparations = 0
    var writes = 0
    var posts = 0
    var fallbackCopies = 0
    var cancelledCompletions = 0
    var reports: [PasteActivationReport] = []
    var outcomes: [PasteDeliveryOutcome] = []
    var settlements: [PasteDeliveryOutcome] = []
    var onPrepare: PasteTransactionCoordinator.ScheduledOperation = {}
    var onWrite: PasteTransactionCoordinator.ScheduledOperation = {}
    var onCompletion: PasteTransactionCoordinator.ScheduledOperation = {}

    init() { live = expected }

    lazy var coordinator = PasteTransactionCoordinator(
        schedule: { self.clock.schedule($0, $1) },
        writeAndVerify: { _ in
            self.writes += 1
            self.onWrite()
            return PasteboardWriteResult(verified: true, ownershipChangeCount: self.writes)
        },
        postPaste: { self.posts += 1; return .posted },
        now: { self.clock.now }
    )

    func readiness() -> PasteActivationReadiness {
        PasteActivation.readiness(expected: expected, live: live, frontmost: frontmost,
            accessibilityTrusted: trusted,
            cancelled: RecordingEngine.shouldAbandonDelivery(pipelineGeneration: 1,
                currentGeneration: currentGeneration, isRecording: isRecording),
            requiresProcessIdentity: true)
    }

    func submit() -> Bool {
        coordinator.submit(text: "fictional transcript", generation: 1, delay: 0,
            settlementDelay: 0.6,
            activation: PasteActivation(
                request: {
                    PasteActivation.requestOnce(recorderIsActive: self.recorderIsActive,
                        yield: { self.yields += 1 },
                        activate: { cooperative in
                            self.activations += 1
                            self.cooperativeRequests.append(cooperative)
                            return self.activationAccepted
                        })
                },
                readiness: { self.readiness() },
                report: { self.reports.append($0) }),
            targetIsReady: { self.readiness() == .ready && self.selectionMatches },
            prepare: { self.preparations += 1; self.onPrepare() },
            verify: { .confirmedByFocusedValue },
            completion: { transaction, outcome in
                self.outcomes.append(outcome)
                if PasteActivation.abandonsFallback(outcome: outcome, generation: transaction.generation,
                    currentGeneration: self.currentGeneration, isRecording: self.isRecording) {
                    self.cancelledCompletions += 1
                    return
                }
                if case .targetUnavailable = outcome { self.fallbackCopies += 1 }
                self.onCompletion()
            },
            settlement: { _, outcome in self.settlements.append(outcome) })
    }
}

struct PasteActivationTests {
    @Test("a target that becomes ready after 500 ms still receives exactly one paste")
    @MainActor
    func delayedReadiness() {
        let clock = PasteActivationClock()
        var preparations = 0
        var writes = 0
        var posts = 0
        var outcomes: [PasteDeliveryOutcome] = []
        let coordinator = PasteTransactionCoordinator(
            schedule: { clock.schedule($0, $1) },
            writeAndVerify: { _ in
                writes += 1
                return PasteboardWriteResult(verified: true, ownershipChangeCount: 1)
            },
            postPaste: { posts += 1; return .posted },
            now: { clock.now }
        )
        let accepted = coordinator.submit(
            text: "fictional payload", generation: 1, delay: 0.5,
            activation: PasteActivation(request: { true }, readiness: {
                clock.now >= 0.75 ? .ready : .waitingForFocus
            }),
            targetIsReady: { clock.now >= 0.75 },
            prepare: { preparations += 1 },
            verify: { .confirmedByFocusedValue },
            completion: { _, outcome in outcomes.append(outcome) }
        )
        #expect(accepted)
        clock.advance(to: 0.5)
        #expect(coordinator.hasPendingTransaction)
        #expect(preparations == 0 && writes == 0 && posts == 0)
        #expect(outcomes.isEmpty)
        clock.advance(to: 0.9)
        #expect(preparations == 1 && writes == 1 && posts == 1)
        #expect(outcomes == [.pasted])
        #expect(!coordinator.hasPendingTransaction)
    }

    @Test("already-frontmost target takes the short path without activation or yielding")
    @MainActor
    func alreadyFrontmost() {
        let fixture = PasteActivationFixture()
        fixture.frontmost = fixture.expected
        let accepted = fixture.submit()
        #expect(accepted)
        fixture.clock.advance(to: 0.049)
        #expect(fixture.preparations == 0 && fixture.writes == 0)
        fixture.clock.advance(to: 0.05)
        #expect(fixture.activations == 0 && fixture.yields == 0)
        #expect(fixture.posts == 1 && fixture.outcomes == [.pasted])
        #expect(fixture.reports.first?.attempt == .alreadyFrontmost)
        #expect(fixture.reports.first?.elapsed == 0.05)
        #expect(!fixture.coordinator.hasPendingTransaction, "confirmed delivery retains immediate settlement")
    }

    @Test("one cooperative activation waits for exact-process focus", arguments: [true, false])
    @MainActor
    func cooperativeActivation(recorderIsActive: Bool) {
        let fixture = PasteActivationFixture()
        fixture.recorderIsActive = recorderIsActive
        let accepted = fixture.submit()
        #expect(accepted)
        fixture.clock.advance(to: 0.7)
        #expect(fixture.preparations == 0 && fixture.writes == 0 && fixture.posts == 0)
        fixture.frontmost = fixture.expected
        fixture.clock.advance(to: 0.8)
        #expect(fixture.activations == 1)
        #expect(fixture.yields == (recorderIsActive ? 1 : 0))
        #expect(fixture.cooperativeRequests == [recorderIsActive])
        #expect(fixture.preparations == 1 && fixture.writes == 1 && fixture.posts == 1)
        #expect(fixture.outcomes == [.pasted] && fixture.settlements == [.pasted])
        #expect(fixture.reports.count == 1 && fixture.reports.first?.attempt == .accepted)
    }

    @Test("accepted activation that never becomes ready times out without preparation or posting")
    @MainActor
    func neverReady() {
        let fixture = PasteActivationFixture()
        let accepted = fixture.submit()
        #expect(accepted)
        fixture.clock.advance(to: 1.49)
        #expect(fixture.coordinator.hasPendingTransaction && fixture.outcomes.isEmpty)
        fixture.clock.advance(to: 1.5)
        #expect(!fixture.coordinator.hasPendingTransaction)
        #expect(fixture.activations == 1 && fixture.yields == 1)
        #expect(fixture.preparations == 0 && fixture.writes == 0 && fixture.posts == 0)
        #expect(fixture.outcomes == [.targetUnavailable])
        #expect(fixture.reports.first?.failure == .timedOut)
        #expect(fixture.reports.first?.elapsed == 1.5)
        fixture.frontmost = fixture.expected
        fixture.clock.advance(to: 2)
        #expect(fixture.posts == 0 && fixture.outcomes.count == 1)
    }

    @Test("rejected activation fails once without a readiness retry or clipboard access")
    @MainActor
    func rejectedActivation() {
        let fixture = PasteActivationFixture()
        fixture.activationAccepted = false
        let accepted = fixture.submit()
        #expect(accepted)
        #expect(fixture.activations == 1 && fixture.yields == 1)
        #expect(fixture.clock.scheduled.isEmpty)
        #expect(fixture.preparations == 0 && fixture.writes == 0 && fixture.posts == 0)
        #expect(fixture.outcomes == [.targetUnavailable])
        #expect(fixture.reports.first?.attempt == .rejected)
        #expect(fixture.reports.first?.failure == .activationRejected)
        #expect(fixture.fallbackCopies == 1, "current delivery retains its existing clipboard fallback policy")
    }

    @Test("invalid initial process and trust never request activation", arguments: ["terminated", "pid", "bundle", "birth", "permission", "cancelled"])
    @MainActor
    func invalidBeforeActivation(change: String) {
        let fixture = PasteActivationFixture()
        switch change {
        case "terminated": fixture.live?.isTerminated = true
        case "pid": fixture.live?.pid = 43
        case "bundle": fixture.live?.bundleIdentifier = "fixture.replacement"
        case "birth": fixture.live?.launchDate = Date(timeIntervalSince1970: 456)
        case "permission": fixture.trusted = false
        default: fixture.currentGeneration = 2
        }
        let accepted = fixture.submit()
        #expect(accepted)
        #expect(fixture.activations == 0 && fixture.yields == 0)
        #expect(fixture.preparations == 0 && fixture.writes == 0 && fixture.posts == 0)
        #expect(fixture.outcomes == [.targetUnavailable])
        #expect(fixture.reports.first?.attempt == .notAttempted)
        #expect(fixture.clock.scheduled.isEmpty)
    }

    @Test("process, permission, and generation drift terminate the activation wait", arguments: ["terminated", "pid", "bundle", "birth", "policy", "permission", "cancelled", "recording"])
    @MainActor
    func driftWhileWaiting(change: String) {
        let fixture = PasteActivationFixture()
        let accepted = fixture.submit()
        #expect(accepted)
        fixture.clock.advance(to: 0.6)
        switch change {
        case "terminated": fixture.live = nil
        case "pid": fixture.live?.pid = 43
        case "bundle": fixture.live?.bundleIdentifier = "fixture.replacement"
        case "birth": fixture.live?.launchDate = Date(timeIntervalSince1970: 456)
        case "policy": fixture.live?.isRegular = false
        case "permission": fixture.trusted = false
        case "cancelled": fixture.currentGeneration = 2
        default: fixture.isRecording = true
        }
        fixture.frontmost = fixture.expected
        fixture.clock.advance(to: 0.7)
        #expect(fixture.activations == 1)
        #expect(fixture.preparations == 0 && fixture.writes == 0 && fixture.posts == 0)
        #expect(fixture.outcomes == [.targetUnavailable] && fixture.settlements == [.targetUnavailable])
        #expect(fixture.reports.count == 1 && fixture.reports.first?.failure != nil)
        #expect(!fixture.coordinator.hasPendingTransaction)
    }

    @Test("focus, selection, trust, and cancellation are rechecked after preparation", arguments: ["focus", "selection", "permission", "cancelled", "birth"])
    @MainActor
    func driftAfterPreparation(change: String) {
        let fixture = PasteActivationFixture()
        fixture.frontmost = fixture.expected
        fixture.onPrepare = {
            switch change {
            case "focus": fixture.frontmost = nil
            case "selection": fixture.selectionMatches = false
            case "permission": fixture.trusted = false
            case "cancelled": fixture.currentGeneration = 2
            default: fixture.live?.launchDate = Date(timeIntervalSince1970: 456)
            }
        }
        let accepted = fixture.submit()
        #expect(accepted)
        fixture.clock.advance(to: 0.1)
        #expect(fixture.preparations == 1 && fixture.writes == 0 && fixture.posts == 0)
        #expect(fixture.outcomes == [.targetUnavailable])
    }

    @Test("drift after payload write still prevents the one paste event", arguments: ["focus", "permission", "cancelled", "birth"])
    @MainActor
    func driftAfterWrite(change: String) {
        let fixture = PasteActivationFixture()
        fixture.frontmost = fixture.expected
        fixture.onWrite = {
            switch change {
            case "focus": fixture.frontmost = nil
            case "permission": fixture.trusted = false
            case "cancelled": fixture.currentGeneration = 2
            default: fixture.live?.launchDate = Date(timeIntervalSince1970: 456)
            }
        }
        let accepted = fixture.submit()
        #expect(accepted)
        fixture.clock.advance(to: 0.1)
        #expect(fixture.preparations == 1 && fixture.writes == 1 && fixture.posts == 0)
        #expect(fixture.outcomes == [.targetUnavailable] && fixture.settlements == [.targetUnavailable])
    }

    @Test("admission and stale poll callbacks cannot activate or deliver a second transaction")
    @MainActor
    func admissionAndStaleCallbacks() throws {
        let fixture = PasteActivationFixture()
        let accepted = fixture.submit()
        #expect(accepted)
        let stale = try #require(fixture.clock.scheduled.first?.1)
        let blocked = fixture.submit()
        #expect(!blocked && fixture.activations == 1)
        fixture.clock.advance(to: 0.05)
        let outstanding = fixture.clock.scheduled.count
        stale()
        #expect(fixture.clock.scheduled.count == outstanding, "duplicate callbacks must not multiply polling")
        fixture.frontmost = fixture.expected
        var admittedDuringCompletion: Bool?
        fixture.onCompletion = { admittedDuringCompletion = fixture.submit() }
        fixture.clock.advance(to: 0.1)
        #expect(admittedDuringCompletion == false)
        #expect(fixture.posts == 1 && fixture.outcomes == [.pasted])
        fixture.onCompletion = {}
        let second = fixture.submit()
        #expect(second)
        stale()
        fixture.clock.advance(to: 0.2)
        #expect(fixture.posts == 2 && fixture.activations == 1)
        #expect(fixture.outcomes == [.pasted, .pasted])
    }

    @Test("a delayed scheduler cannot deliver after the activation deadline")
    @MainActor
    func delayedCallbackPastDeadline() throws {
        let fixture = PasteActivationFixture()
        let accepted = fixture.submit()
        #expect(accepted)
        let delayed = try #require(fixture.clock.scheduled.first?.1)
        fixture.clock.scheduled.removeAll()
        fixture.clock.now = 2
        fixture.frontmost = fixture.expected
        delayed()
        #expect(fixture.preparations == 0 && fixture.writes == 0 && fixture.posts == 0)
        #expect(fixture.reports.first?.failure == .timedOut)
        #expect(fixture.outcomes == [.targetUnavailable])
    }

    @Test("cancelled generation completes without fallback clipboard copying", arguments: [false, true])
    @MainActor
    func cancelledGenerationDoesNotCopy(afterPreparation: Bool) {
        let fixture = PasteActivationFixture()
        if afterPreparation {
            fixture.frontmost = fixture.expected
            fixture.onPrepare = { fixture.currentGeneration = 2 }
        }
        let accepted = fixture.submit()
        #expect(accepted)
        if !afterPreparation { fixture.currentGeneration = 2 }
        fixture.clock.advance(to: 0.1)
        #expect(fixture.cancelledCompletions == 1 && fixture.fallbackCopies == 0)
        #expect(fixture.writes == 0 && fixture.posts == 0)
        #expect(fixture.outcomes == [.targetUnavailable])
        #expect(!fixture.coordinator.hasPendingTransaction)
    }

    @Test("time spent checking readiness counts toward the activation deadline")
    @MainActor
    func readinessCheckExceedsDeadline() {
        let clock = PasteActivationClock()
        var checks = 0
        var writes = 0
        var outcomes: [PasteDeliveryOutcome] = []
        let coordinator = PasteTransactionCoordinator(schedule: { clock.schedule($0, $1) },
            writeAndVerify: { _ in writes += 1; return PasteboardWriteResult(verified: true, ownershipChangeCount: 1) },
            postPaste: { .posted }, now: { clock.now })
        let accepted = coordinator.submit(text: "fictional", generation: 1, delay: 0,
            activation: PasteActivation(request: { true }, readiness: {
                checks += 1
                if checks == 1 { return .waitingForFocus }
                clock.now = 2
                return .ready
            }),
            completion: { _, outcome in outcomes.append(outcome) })
        #expect(accepted)
        clock.advance(to: 0.05)
        #expect(writes == 0 && outcomes == [.targetUnavailable])
        #expect(!coordinator.hasPendingTransaction)
    }

    @Test("a slow initial readiness check never issues a late activation request")
    @MainActor
    func initialReadinessExceedsDeadline() {
        let clock = PasteActivationClock()
        var activations = 0
        var yields = 0
        var writes = 0
        var posts = 0
        var reports: [PasteActivationReport] = []
        let coordinator = PasteTransactionCoordinator(schedule: { clock.schedule($0, $1) },
            writeAndVerify: { _ in writes += 1; return PasteboardWriteResult(verified: true, ownershipChangeCount: 1) },
            postPaste: { posts += 1; return .posted }, now: { clock.now })
        let accepted = coordinator.submit(text: "fictional", generation: 1, delay: 0,
            activation: PasteActivation(request: {
                PasteActivation.requestOnce(recorderIsActive: true,
                    yield: { yields += 1 }, activate: { _ in activations += 1; return true })
            }, readiness: { clock.now = 2; return .waitingForFocus }, report: { reports.append($0) }),
            completion: { _, _ in })
        #expect(accepted)
        #expect(activations == 0 && yields == 0 && writes == 0 && posts == 0)
        #expect(reports.count == 1 && reports.first?.failure == .timedOut)
        #expect(reports.first?.attempt == .notAttempted)
        #expect(clock.scheduled.isEmpty && !coordinator.hasPendingTransaction)
    }
}
